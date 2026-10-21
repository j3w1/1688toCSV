import { centsToMoney, moneyToCents } from './money.js'

const presets = { lighting: 'Lighting', rotation: 'Rotation' }
const normalizeName = (name) =>
  name.normalize('NFKC').trim().toLocaleLowerCase('en')

/** Existing boolean features retain their meaning and never invent a paid cost. */
export function productFeatures(value = {}) {
  return Object.entries(value).flatMap(([key, feature]) =>
    feature === false
      ? []
      : [
          {
            key,
            ...(feature === true
              ? { name: presets[key], unitCost: '0.00', included: true }
              : feature),
          },
        ]
  )
}

export function validateProductFeatures(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Product features must be an object')
  const names = new Set()
  return Object.fromEntries(
    Object.entries(value).map(([key, feature]) => {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key))
        throw new Error('Product feature ID is invalid')
      if (typeof feature === 'boolean' && Object.hasOwn(presets, key)) {
        if (feature) {
          const name = normalizeName(presets[key])
          if (names.has(name))
            throw new Error('Product feature names must be unique')
          names.add(name)
        }
        return [key, feature]
      }
      if (
        !feature ||
        typeof feature !== 'object' ||
        Array.isArray(feature) ||
        Object.keys(feature).some(
          (field) => !['name', 'unitCost', 'included'].includes(field)
        )
      )
        throw new Error('Product feature is invalid')
      const name = typeof feature.name === 'string' ? feature.name.trim() : ''
      if (!name || name.length > 120)
        throw new Error('Enter a product feature name')
      if (names.has(normalizeName(name)))
        throw new Error('Product feature names must be unique')
      names.add(normalizeName(name))
      if (
        typeof feature.unitCost !== 'string' ||
        moneyToCents(feature.unitCost) < 0n
      )
        throw new Error('Feature cost must be a non-negative amount')
      if (typeof feature.included !== 'boolean')
        throw new Error('Choose whether the feature cost is already recorded')
      return [
        key,
        {
          name,
          unitCost: centsToMoney(moneyToCents(feature.unitCost)),
          included: feature.included,
        },
      ]
    })
  )
}

/** Source purchases may have different costs while describing the same product. */
export const featureSignature = (value) =>
  productFeatures(value)
    .map((feature) => normalizeName(feature.name))
    .sort()

export const featureUnitCost = (value) =>
  productFeatures(value).reduce(
    (sum, feature) =>
      sum + (feature.included ? 0n : moneyToCents(feature.unitCost)),
    0n
  )

export const hasProductFeatureCosts = (record) =>
  Object.values(record.productWorkflow || {}).some(
    (workflow) => featureUnitCost(workflow.features) > 0n
  )
