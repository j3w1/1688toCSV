import test from 'node:test'
import assert from 'node:assert/strict'
import {
  discardPreparationProducts,
  preparationProducts,
} from '../src/preparation-removal.js'
import {
  allocatePreparation,
  createPreparation,
  packingCheckpoint,
  validatePreparation,
} from '../src/packing-model.js'

function fixture() {
  const source = {
    accountId: 'local',
    orderId: '100000000000000001',
    sellerName: 'Synthetic removal',
    sellerMemberLogin: 'synthetic-removal',
    items: [
      {
        entryId: '1',
        title: 'Cup',
        description: 'Cup red',
        skuProperties: [{ label: '颜色', value: '红色' }],
      },
      {
        entryId: '2',
        title: 'Cup',
        description: 'Cup blue',
        skuProperties: [{ label: '颜色', value: '蓝色' }],
      },
      { entryId: '3', title: 'Box', description: 'Box', skuProperties: [] },
    ],
  }
  const baseline = allocatePreparation(
    createPreparation(source, '2026-10'),
    [],
    []
  ).preparation
  baseline.defaultPacking = packingCheckpoint(baseline)
  return baseline
}

test('new products return to unassigned without retaining session edits in defaults', () => {
  const current = fixture()
  const untouched = structuredClone(current)
  const result = discardPreparationProducts(current, undefined, ['1', '2'])
  assert.deepEqual([...preparationProducts(result).keys()], ['3'])
  assert.deepEqual(
    [...preparationProducts(result.defaultPacking).keys()],
    ['3']
  )
  assert.deepEqual(current, untouched)
})

test('partial discard restores shared fields and only removed variant edits, retaining sibling material and code endings', () => {
  const baseline = fixture()
  const current = structuredClone(baseline)
  current.groups[0].baseCode = 'CE26109901'
  current.groups[0].category = 'changed shared category'
  current.groups[0].variants[0].material = 'discard this'
  current.groups[0].variants[1].material = 'keep sibling material'
  current.groups[0].variants[1].variantSuffix = 'Z'
  const other = structuredClone(current.groups[1])
  const result = discardPreparationProducts(current, baseline, ['1'])
  validatePreparation(result)
  assert.equal(result.groups[0].baseCode, baseline.groups[0].baseCode)
  assert.equal(result.groups[0].category, baseline.groups[0].category)
  assert.equal(
    result.groups[0].variants[0].material,
    baseline.groups[0].variants[0].material
  )
  assert.equal(result.groups[0].variants[1].material, 'keep sibling material')
  assert.equal(result.groups[0].variants[1].variantSuffix, 'Z')
  assert.deepEqual(result.groups[1], other)
})

test('discard follows source identities across a merged group and restores original boundaries without discarding unrelated variant material', () => {
  const baseline = fixture()
  const current = structuredClone(baseline)
  const [cup, box] = current.groups
  box.variants[0].material = 'keep box material'
  box.variants[0].variantSuffix = 'C'
  cup.variants.push(...box.variants)
  current.groups = [cup]
  const result = discardPreparationProducts(current, baseline, ['1'])
  validatePreparation(result)
  assert.deepEqual(
    result.groups.map((group) => group.id),
    baseline.groups.map((group) => group.id)
  )
  assert.equal(result.groups[1].variants[0].material, 'keep box material')
  assert.deepEqual([...preparationProducts(result).keys()].sort(), [
    '1',
    '2',
    '3',
  ])
})

test('discarding an existing product does not resurrect a sibling previously removed in the same session', () => {
  const baseline = fixture()
  const current = structuredClone(baseline)
  current.groups[0].variants.splice(1, 1)
  const result = discardPreparationProducts(current, baseline, ['1'])
  validatePreparation(result)
  assert.deepEqual([...preparationProducts(result).keys()], ['1', '3'])
})

test('partial shared-source discard preserves material values belonging to remaining rows', () => {
  const baseline = fixture()
  baseline.groups[0].variants[0].entryIds.push('4')
  baseline.defaultPacking = packingCheckpoint(baseline)
  const current = structuredClone(baseline)
  current.groups[0].variants[0].material = 'changed all'
  current.groups[0].variants[0].materialSource = 'manual'
  const result = discardPreparationProducts(current, baseline, ['1'])
  validatePreparation(result)
  assert.equal(
    result.groups[0].variants[0].materialOverrides['4'].value,
    'changed all'
  )
  assert.notEqual(result.groups[0].variants[0].material, 'changed all')
})
