import test from 'node:test'
import assert from 'node:assert/strict'
import {
  productFeatures,
  validateProductFeatures,
  featureUnitCost,
  featureSignature,
} from '../src/product-features.js'
import {
  validateOperationsMetadata,
  operationsIndicators,
  mergeWorkflowPatch,
} from '../src/operations-workflow.js'

test('custom feature costs preserve legacy switches and never charge already recorded features twice', () => {
  const features = validateProductFeatures({
    lighting: true,
    rotation: false,
    waterproof: { name: ' Waterproof ', unitCost: '1.20', included: false },
    engraving: { name: 'Engraving', unitCost: '2.50', included: true },
  })
  assert.equal(features.lighting, true)
  assert.equal(features.rotation, false)
  assert.equal(featureUnitCost(features), 120n)
  assert.deepEqual(featureSignature(features), [
    'engraving',
    'lighting',
    'waterproof',
  ])
  assert.deepEqual(
    productFeatures(features).map((item) => item.name),
    ['Lighting', 'Waterproof', 'Engraving']
  )
  assert.deepEqual(
    featureSignature({
      otherKey: { name: 'WATERPROOF', unitCost: '9.99', included: true },
    }),
    featureSignature({ waterproof: features.waterproof })
  )
})

test('feature costs, names and payment treatment survive the workflow backup contract', () => {
  const features = {
      custom: {
        name: '声控 / Sound sensor',
        unitCost: '0.50',
        included: false,
      },
      lighting: true,
    },
    value = validateOperationsMetadata({
      productWorkflow: { 1: { features } },
      productWorkflowUpdatedAt: '2026-10-21T00:00:00.000Z',
    })
  assert.deepEqual(value.productWorkflow['1'].features, features)
  assert.deepEqual(
    mergeWorkflowPatch(value.productWorkflow['1'], {
      delay: { status: 'none' },
    }).features,
    features
  )
  const indicators = operationsIndicators(
    { productWorkflow: value.productWorkflow },
    { entryId: '1' }
  )
  assert.equal(
    indicators.find((item) => item.kind === 'custom').params.cost,
    '0.50'
  )
  assert.equal(
    indicators.find((item) => item.kind === 'custom').params.treatment,
    'Additional cost'
  )
  assert.equal(
    indicators.find((item) => item.kind === 'lighting').params.treatment,
    'Already recorded'
  )
})

test('malformed or duplicate feature definitions cannot enter a saved workflow', () => {
  for (const features of [
    { custom: true },
    { a: { name: '', unitCost: '1', included: false } },
    { a: { name: 'Coating', unitCost: '-1', included: false } },
    { a: { name: 'Coating', unitCost: '1.001', included: false } },
    { a: { name: 'Coating', unitCost: '1' } },
    { a: { name: 'Coating', unitCost: '1', included: false, hiddenCost: '2' } },
    {
      lighting: true,
      a: { name: ' LIGHTING ', unitCost: '1', included: false },
    },
    {
      a: { name: 'Coating', unitCost: '1', included: true },
      b: { name: 'COATING', unitCost: '1', included: false },
    },
  ])
    assert.throws(() => validateProductFeatures(features))
})
