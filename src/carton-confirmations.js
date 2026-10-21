import { packingMonth } from './packing-model.js'

/** Blank is unknown; zero is a confirmed absence of cartons. */
export function normalizeCartonConfirmation(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string' && !value.trim()) return null
  const invalid = () => {
    throw new Error('Confirmed boxes must be a nonnegative whole number')
  }
  if (!['number', 'string'].includes(typeof value)) return invalid()
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return invalid()
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) return invalid()
  return count
}

export function cartonConfirmationField(value) {
  if (!['received', 'loaded'].includes(value))
    throw new Error('Choose received or loaded boxes')
  return value
}

/** A split supplier row remains one physical carton batch within its purchase. */
export function cartonBatchForItem(record, entryId) {
  const snapshot = record?.snapshot
  const item = snapshot?.items.find((item) => item.entryId === entryId)
  if (!item) throw new Error('Product was not found in this order')
  const shared = snapshot.sourceType === 'spreadsheet' && item.sourceRow
  const members = shared
    ? snapshot.items.filter((entry) => entry.sourceRow === item.sourceRow)
    : [item]
  return {
    entryId: members[0].entryId,
    entryIds: members.map((entry) => entry.entryId),
    ...(shared ? { sourceRow: item.sourceRow } : {}),
  }
}

/** Keep complete membership explicit; a partial variant is not another batch. */
export function cartonBatchesForItems(record, entryIds) {
  const selected = new Set(entryIds)
  const batches = new Map()
  for (const entryId of selected) {
    const batch = cartonBatchForItem(record, entryId)
    if (!batches.has(batch.entryId))
      batches.set(batch.entryId, {
        ...batch,
        complete: batch.entryIds.every((id) => selected.has(id)),
      })
  }
  return [...batches.values()]
}

export function cartonConfirmationForItem(record, entryId, month) {
  packingMonth(month)
  const batch = cartonBatchForItem(record, entryId)
  return record.cartonConfirmations?.[batch.entryId]?.[month] || {}
}

/** Preserve other months and the other independent confirmation. */
export function editCartonConfirmation(record, entryId, month, field, value) {
  packingMonth(month)
  cartonConfirmationField(field)
  const count = normalizeCartonConfirmation(value)
  const batch = cartonBatchForItem(record, entryId)
  const confirmations = { ...record.cartonConfirmations }
  const months = { ...confirmations[batch.entryId] }
  const counts = { ...months[month] }
  if (count === null) delete counts[field]
  else counts[field] = count
  if (Object.keys(counts).length) months[month] = counts
  else delete months[month]
  if (Object.keys(months).length) confirmations[batch.entryId] = months
  else delete confirmations[batch.entryId]
  return { entryId: batch.entryId, cartonConfirmations: confirmations }
}

/** Backups contain canonical batch owners and numeric confirmations only. */
function validateBatchOwner(record, entryId, sourceSnapshots) {
  if (!/^[1-9]\d*$/.test(entryId))
    throw new Error(
      'Carton confirmation entry ID must be a full decimal ID string'
    )
  const source = [record.snapshot, ...sourceSnapshots].find((snapshot) =>
    snapshot.items?.some((item) => item.entryId === entryId)
  )
  if (!source)
    throw new Error(
      'Carton confirmation product is missing from source evidence'
    )
  const batch = cartonBatchForItem({ snapshot: source }, entryId)
  if (batch.entryId !== entryId)
    throw new Error(
      'Carton confirmations must use the shared carton batch owner'
    )
}

export function validateCartonConfirmations(
  value,
  record,
  sourceSnapshots = []
) {
  const object = (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Carton confirmations must be objects')
    return input
  }
  return Object.fromEntries(
    Object.entries(object(value)).map(([entryId, months]) => {
      validateBatchOwner(record, entryId, sourceSnapshots)
      const entries = Object.entries(object(months)).map(([month, counts]) => {
        packingMonth(month)
        const fields = Object.entries(object(counts)).map(([field, count]) => {
          cartonConfirmationField(field)
          if (
            typeof count !== 'number' ||
            normalizeCartonConfirmation(count) === null
          )
            throw new Error(
              'Confirmed boxes must be a nonnegative whole number'
            )
          return [field, count]
        })
        if (!fields.length)
          throw new Error('Empty carton confirmation months must be removed')
        return [month, Object.fromEntries(fields)]
      })
      if (!entries.length)
        throw new Error('Empty carton confirmation batches must be removed')
      return [entryId, Object.fromEntries(entries)]
    })
  )
}

/** Each batch/month has its own clock, including authored clears. */
export function validateCartonConfirmationMetadata(
  input,
  record,
  sourceSnapshots = []
) {
  const result = {}
  if (input.cartonConfirmations !== undefined)
    result.cartonConfirmations = validateCartonConfirmations(
      input.cartonConfirmations,
      record,
      sourceSnapshots
    )
  if (input.cartonConfirmationClocks !== undefined) {
    const clocks = input.cartonConfirmationClocks
    if (!clocks || typeof clocks !== 'object' || Array.isArray(clocks))
      throw new Error('Carton confirmation clocks must be an object')
    result.cartonConfirmationClocks = Object.fromEntries(
      Object.entries(clocks).map(([entryId, months]) => {
        validateBatchOwner(record, entryId, sourceSnapshots)
        if (!months || typeof months !== 'object' || Array.isArray(months))
          throw new Error('Carton confirmation month clocks must be an object')
        return [
          entryId,
          Object.fromEntries(
            Object.entries(months).map(([month, timestamp]) => {
              packingMonth(month)
              if (
                typeof timestamp !== 'string' ||
                !Number.isFinite(Date.parse(timestamp))
              )
                throw new Error(
                  'Carton confirmation clock must be a valid timestamp'
                )
              return [month, new Date(timestamp).toISOString()]
            })
          ),
        ]
      })
    )
  }
  for (const [entryId, months] of Object.entries(
    result.cartonConfirmations || {}
  ))
    for (const month of Object.keys(months))
      if (!result.cartonConfirmationClocks?.[entryId]?.[month])
        throw new Error('Carton confirmations require a month update timestamp')
  return result
}

/** A shipment restore observes only the batch/month clocks it actually contains. */
export function mergeCartonConfirmations(previous, incoming, next = previous) {
  const values = structuredClone(previous.cartonConfirmations || {})
  const clocks = structuredClone(previous.cartonConfirmationClocks || {})
  let changed = false
  for (const [entryId, months] of Object.entries(
    incoming.cartonConfirmationClocks || {}
  ))
    for (const [month, timestamp] of Object.entries(months)) {
      const existing = clocks[entryId]?.[month] || ''
      const incomingCounts = incoming.cartonConfirmations?.[entryId]?.[month]
      const previousCounts = values[entryId]?.[month]
      if (
        timestamp === existing &&
        ['received', 'loaded'].some(
          (field) => incomingCounts?.[field] !== previousCounts?.[field]
        )
      )
        throw new Error(
          'Backup conflict: carton confirmations have the same month timestamp'
        )
      if (timestamp <= existing) continue
      if (incomingCounts)
        values[entryId] = {
          ...values[entryId],
          [month]: structuredClone(incomingCounts),
        }
      else if (values[entryId]) {
        delete values[entryId][month]
        if (!Object.keys(values[entryId]).length) delete values[entryId]
      }
      clocks[entryId] = { ...clocks[entryId], [month]: timestamp }
      changed = true
    }
  return changed
    ? { ...next, cartonConfirmations: values, cartonConfirmationClocks: clocks }
    : next
}
