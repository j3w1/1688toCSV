import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPreparation,
  validatePreparation,
  packingCheckpoint,
  restoreDefaultPacking,
  planSelectedPreparations,
  variantMaterial,
  setVariantMaterial,
  refreshPreparationMaterials,
  mergeVariantMaterials,
} from '../src/packing-model.js'
import {
  selectPackingPreparation,
  mergePackingPreparation,
} from '../src/packing-backup.js'

function fixture() {
  const snapshot = {
    accountId: 'local',
    orderId: '1001',
    sellerName: 'Synthetic seller',
    items: ['玻璃', '不锈钢'].map((material, index) => ({
      entryId: String(index + 1),
      title: '合成容器',
      description: `合成容器\n材质：${material}`,
      skuProperties: [{ label: '材质', value: material }],
    })),
  }
  return {
    snapshot,
    preparation: refreshPreparationMaterials(
      createPreparation(snapshot, '2026-10'),
      snapshot
    ),
  }
}

test('material suggestions populate variants while manual edits and explicit clears survive preparing again', () => {
  const { snapshot, preparation } = fixture()
  const [first, second] = preparation.groups[0].variants
  assert.equal(variantMaterial(first).value, '玻璃')
  assert.equal(variantMaterial(second).value, '不锈钢')
  setVariantMaterial(first, 'Custom metal')
  setVariantMaterial(second, '')
  const refreshed = refreshPreparationMaterials(preparation, snapshot)
  assert.deepEqual(
    refreshed.groups[0].variants.map((variant) => variantMaterial(variant)),
    [
      { value: 'Custom metal', source: 'manual' },
      { value: '', source: 'manual' },
    ]
  )
  assert.deepEqual(
    validatePreparation(JSON.parse(JSON.stringify(refreshed))).groups,
    refreshed.groups
  )
})

test('source material updates replace suggestions but not authored values', () => {
  const { snapshot, preparation } = fixture()
  snapshot.items[0].skuProperties[0].value = '陶瓷'
  snapshot.items[0].description = '合成容器\n材质：陶瓷'
  assert.equal(
    variantMaterial(
      refreshPreparationMaterials(preparation, snapshot).groups[0].variants[0]
    ).value,
    '陶瓷'
  )
})

test('material edits survive restoring default grouping and partial moves', () => {
  const { snapshot, preparation } = fixture()
  const group = preparation.groups[0]
  const target = structuredClone(group.variants[0])
  target.entryIds = ['1', '2']
  mergeVariantMaterials(target, group.variants)
  group.variants = [target]
  preparation.defaultPacking = packingCheckpoint(preparation)
  group.variants = target.entryIds.map((id, index) => ({
    ...structuredClone(target),
    id: `split${index}`,
    entryIds: [id],
  }))
  setVariantMaterial(group.variants[0], 'Cotton')
  setVariantMaterial(group.variants[1], 'Linen')
  const restored = restoreDefaultPacking(preparation)
  assert.equal(restored.groups[0].variants.length, 1)
  const restoredVariant = restored.groups[0].variants[0]
  assert.equal(variantMaterial(restoredVariant, '1').value, 'Cotton')
  assert.equal(variantMaterial(restoredVariant, '2').value, 'Linen')
  const [moved] = planSelectedPreparations(
    [{ snapshot, preparation: restored, entryIds: ['2'] }],
    '2026-12'
  ).preparations
  const all = moved.groups.flatMap((group) =>
    group.variants.flatMap((variant) =>
      variant.entryIds.map((id) => [id, variantMaterial(variant, id).value])
    )
  )
  assert.deepEqual(
    new Map(all),
    new Map([
      ['1', 'Cotton'],
      ['2', 'Linen'],
    ])
  )
})

test('selected packing backups contain only selected material authoring and restore without changing other materials', () => {
  const { preparation } = fixture()
  const group = preparation.groups[0],
    target = structuredClone(group.variants[0])
  target.entryIds = ['1', '2']
  mergeVariantMaterials(target, group.variants)
  group.variants = [target]
  setVariantMaterial(target, 'Private first material', ['1'])
  setVariantMaterial(target, 'Selected second material', ['2'])
  preparation.updatedAt = '2026-10-01T00:00:00Z'
  preparation.defaultPacking = packingCheckpoint(preparation)
  const selected = selectPackingPreparation(preparation, ['2'])
  assert.equal(
    JSON.stringify(selected).includes('Private first material'),
    false
  )
  assert.equal(
    variantMaterial(selected.groups[0].variants[0], '2').value,
    'Selected second material'
  )
  setVariantMaterial(selected.groups[0].variants[0], 'New second material')
  selected.updatedAt = '2026-10-02T00:00:00Z'
  const restored = mergePackingPreparation(preparation, selected, ['2'])
  const next = restored.groups[0].variants[0]
  assert.equal(variantMaterial(next, '1').value, 'Private first material')
  assert.equal(variantMaterial(next, '2').value, 'New second material')
})

test('invalid material provenance fails validation rather than silently becoming a suggestion', () => {
  const { preparation } = fixture()
  preparation.groups[0].variants[0].materialSource = 'unknown'
  assert.throws(() => validatePreparation(preparation), /Material source/)
})
