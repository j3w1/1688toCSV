import {
  latestStoreWorkflow,
  mergeStoreWorkflow,
  mergeWorkflowPatch,
  productWorkflowClock,
  reviewOperationsMigration,
  validateOrderWorkflow,
  validateProductWorkflow,
  validateStoreWorkflow,
} from './operations-workflow.js'
import { assertSharedProductFeatureEdit } from './repeat-products.js'

const key = (record) =>
  JSON.stringify([
    record.snapshot.accountId || 'local',
    record.snapshot.orderId,
  ])
const equal = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {})
const own = (value, field) => Object.hasOwn(value || {}, field)
const stale = () =>
  new Error('Workflow changed in another tab. Reopen it before saving.')

function checkClock(actual, expected) {
  if (expected !== undefined && actual !== expected) throw stale()
}

function putValue(record, field, value, timestamp) {
  const result = { ...record, [`${field}UpdatedAt`]: timestamp }
  if (Object.keys(value).length) result[field] = value
  else delete result[field]
  return result
}

/** Uses the database's existing transaction runner; all authored changes stay atomic. */
export function createOperationsRepository({
  read,
  write,
  requested,
  nextEditTimestamp,
  storeIdentity,
  sameStoreOrders,
  syncTagCatalogs,
  packingPreferencesFor,
}) {
  async function groupFor(tx, record) {
    const identity = storeIdentity(record.snapshot)
    if (!identity) return [record]
    const records = sameStoreOrders
      ? await sameStoreOrders(tx, record)
      : await requested(tx.objectStore('orders').getAll())
    return records.filter(
      (entry) =>
        entry.snapshot.accountId === record.snapshot.accountId &&
        storeIdentity(entry.snapshot) === identity
    )
  }

  async function load(tx, orderId, accountId) {
    const record = await requested(
      tx.objectStore('orders').get([accountId, orderId])
    )
    if (!record) throw new Error('Order was not found')
    return record
  }

  async function save(tx, orderId, changes, options) {
    const { accountId = 'local' } = options,
      store = tx.objectStore('orders')
    let order = await load(tx, orderId, accountId)
    const group = own(changes, 'store') ? await groupFor(tx, order) : [],
      latest = latestStoreWorkflow(group)
    if (own(changes, 'store'))
      checkClock(
        latest.storeWorkflowUpdatedAt || '',
        options.expectedStoreClock
      )
    if (own(changes, 'order'))
      checkClock(order.orderWorkflowUpdatedAt || '', options.expectedOrderClock)
    if (own(changes, 'product')) {
      const { entryId } = changes.product
      if (
        !order.snapshot.items.some((item) => item.entryId === entryId) &&
        !own(order.productWorkflow, entryId)
      )
        throw new Error('Product was not found in this order')
      checkClock(
        productWorkflowClock(order, entryId),
        options.expectedProductClock
      )
      const productWorkflow = { ...order.productWorkflow },
        value = validateProductWorkflow(changes.product.value)
      if (Object.keys(value).length) productWorkflow[entryId] = value
      else delete productWorkflow[entryId]
      assertSharedProductFeatureEdit(
        order,
        { ...order, productWorkflow },
        await requested(tx.objectStore('preparations').getAll())
      )
    }
    if (own(changes, 'store')) {
      const value = validateStoreWorkflow(changes.store)
      if (
        !equal(latest.storeWorkflow, value) ||
        !latest.storeWorkflowUpdatedAt
      ) {
        const timestamp = nextEditTimestamp(latest.storeWorkflowUpdatedAt)
        for (const entry of group) {
          const result = putValue(entry, 'storeWorkflow', value, timestamp)
          store.put(result)
          if (key(entry) === key(order)) order = result
        }
      } else {
        order = mergeStoreWorkflow(order, latest)
      }
    }
    if (own(changes, 'order')) {
      const value = validateOrderWorkflow(changes.order)
      if (!equal(order.orderWorkflow, value) || !order.orderWorkflowUpdatedAt) {
        order = putValue(
          order,
          'orderWorkflow',
          value,
          nextEditTimestamp(order.orderWorkflowUpdatedAt)
        )
        store.put(order)
      }
    }
    if (own(changes, 'product')) {
      const { entryId } = changes.product,
        value = validateProductWorkflow(changes.product.value)
      if (
        !equal(order.productWorkflow?.[entryId], value) ||
        !productWorkflowClock(order, entryId)
      ) {
        const productWorkflow = { ...order.productWorkflow },
          previous = [
            order.productWorkflowUpdatedAt || '',
            ...Object.values(order.productWorkflowPartialClocks || {}),
          ]
            .sort()
            .at(-1)
        if (Object.keys(value).length) productWorkflow[entryId] = value
        else delete productWorkflow[entryId]
        order = {
          ...order,
          productWorkflow,
          productWorkflowPartialClocks: {
            ...order.productWorkflowPartialClocks,
            [entryId]: nextEditTimestamp(previous),
          },
        }
        store.put(order)
      }
    }
    return order
  }

  return {
    async getOperationsWorkflow(orderId, { accountId = 'local' } = {}) {
      return read(['orders'], async (tx) => {
        const record = await load(tx, orderId, accountId)
        return mergeStoreWorkflow(
          record,
          latestStoreWorkflow(await groupFor(tx, record))
        )
      })
    },
    async setStoreWorkflow(
      orderId,
      value,
      { accountId = 'local', expectedClock } = {}
    ) {
      const valid = validateStoreWorkflow(value)
      return write(['orders'], (tx) =>
        save(
          tx,
          orderId,
          { store: valid },
          { accountId, expectedStoreClock: expectedClock }
        )
      )
    },
    async setOrderWorkflow(
      orderId,
      value,
      { accountId = 'local', expectedClock } = {}
    ) {
      const valid = validateOrderWorkflow(value)
      return write(['orders'], (tx) =>
        save(
          tx,
          orderId,
          { order: valid },
          { accountId, expectedOrderClock: expectedClock }
        )
      )
    },
    async setProductWorkflow(
      orderId,
      entryId,
      value,
      { accountId = 'local', expectedClock } = {}
    ) {
      const valid = validateProductWorkflow(value)
      return write(['orders', 'preparations'], (tx) =>
        save(
          tx,
          orderId,
          { product: { entryId, value: valid } },
          { accountId, expectedProductClock: expectedClock }
        )
      )
    },
    async setOperationsWorkflow(orderId, changes, options = {}) {
      const valid = {}
      if (own(changes, 'store'))
        valid.store = validateStoreWorkflow(changes.store)
      if (own(changes, 'order'))
        valid.order = validateOrderWorkflow(changes.order)
      if (own(changes, 'product'))
        valid.product = {
          entryId: changes.product.entryId,
          value: validateProductWorkflow(changes.product.value),
        }
      return write(['orders', 'preparations'], (tx) =>
        save(tx, orderId, valid, options)
      )
    },
    async applyOperationsMigration(review, { confirmed = false } = {}) {
      if (!confirmed)
        throw new Error('Review and confirm the workflow migration first')
      if (!Array.isArray(review?.items) || !review.items.length)
        throw new Error('Choose at least one tag to migrate')
      const stores = [
        'orders',
        'preparations',
        ...(syncTagCatalogs && packingPreferencesFor
          ? ['packingPreferences']
          : []),
      ]
      return write(stores, async (tx) => {
        const store = tx.objectStore('orders'),
          records = await requested(store.getAll()),
          fresh = new Map(
            reviewOperationsMigration(records).items.map((item) => [
              item.id,
              item,
            ])
          ),
          selected = [],
          seen = new Set()
        for (const item of review.items) {
          const current = fresh.get(item.id)
          if (
            !current ||
            JSON.stringify(current) !== JSON.stringify(item) ||
            seen.has(item.id)
          )
            throw stale()
          if (current.conflict)
            throw new Error(
              'A migrated tag conflicts with an existing workflow value'
            )
          seen.add(item.id)
          selected.push(current)
        }
        const prepared = new Map(
            records.map((record) => [key(record), structuredClone(record)])
          ),
          touched = new Set(),
          workflowEdits = new Map()
        const edit = (record, target, patch, tag, entryId) => {
          const id = key(record),
            field = `${target}Workflow`,
            editKey = JSON.stringify([target, id, entryId || '']),
            previous = workflowEdits.get(editKey),
            next = prepared.get(id)
          if (previous && patchesConflict(previous.patch, patch))
            throw new Error('Selected tags propose conflicting workflow values')
          workflowEdits.set(editKey, {
            record: next,
            target,
            entryId,
            patch: mergeWorkflowPatch(previous?.patch, patch),
          })
          if (target === 'product')
            next.productWorkflow = {
              ...next.productWorkflow,
              [entryId]: mergeWorkflowPatch(
                next.productWorkflow?.[entryId],
                patch,
                tag
              ),
            }
          else next[field] = mergeWorkflowPatch(next[field], patch, tag)
          touched.add(id)
        }
        // Store changes use the most recent shared value and update every known same-account identity.
        const seeded = new Set()
        for (const item of selected) {
          const source = prepared.get(
            JSON.stringify([item.accountId, item.orderId])
          )
          if (item.target === 'store') {
            const group = records.filter(
                (entry) =>
                  entry.snapshot.accountId === item.accountId &&
                  (storeIdentity(source.snapshot)
                    ? storeIdentity(entry.snapshot) ===
                      storeIdentity(source.snapshot)
                    : key(entry) === key(source))
              ),
              latest = latestStoreWorkflow(group)
            if (patchesConflict(latest.storeWorkflow, item.patch))
              throw new Error(
                'A migrated tag conflicts with an existing workflow value'
              )
            for (const entry of group) {
              const next = prepared.get(key(entry))
              if (!seeded.has(key(entry))) {
                if (latest.storeWorkflow)
                  next.storeWorkflow = structuredClone(latest.storeWorkflow)
                else delete next.storeWorkflow
                seeded.add(key(entry))
              }
              edit(next, 'store', item.patch, item.tag)
            }
          } else edit(source, item.target, item.patch, item.tag, item.entryId)
          if (item.entryId) {
            source.productTags = {
              ...source.productTags,
              [item.entryId]: source.productTags[item.entryId].filter(
                (tag) => tag !== item.tag
              ),
            }
            if (!source.productTags[item.entryId].length)
              delete source.productTags[item.entryId]
          } else source.tags = source.tags.filter((tag) => tag !== item.tag)
          touched.add(key(source))
        }
        const maxClock = records
            .flatMap((record) => [
              record.storeWorkflowUpdatedAt || '',
              record.orderWorkflowUpdatedAt || '',
              record.productWorkflowUpdatedAt || '',
              ...Object.values(record.productWorkflowPartialClocks || {}),
              record.productTagsUpdatedAt || '',
              ...Object.values(record.productTagsPartialClocks || {}),
            ])
            .sort()
            .at(-1),
          timestamp = nextEditTimestamp(maxClock)
        for (const { record, target, entryId } of workflowEdits.values()) {
          if (target === 'product')
            record.productWorkflowPartialClocks = {
              ...record.productWorkflowPartialClocks,
              [entryId]: timestamp,
            }
          else record[`${target}WorkflowUpdatedAt`] = timestamp
        }
        for (const item of selected)
          if (item.entryId) {
            const record = prepared.get(
              JSON.stringify([item.accountId, item.orderId])
            )
            record.productTagsPartialClocks = {
              ...record.productTagsPartialClocks,
              [item.entryId]: timestamp,
            }
          }
        const previousRecords = [],
          preparations = await requested(
            tx.objectStore('preparations').getAll()
          )
        for (const id of touched) {
          const record = prepared.get(id)
          if (record.storeWorkflow)
            record.storeWorkflow = validateStoreWorkflow(record.storeWorkflow)
          if (record.orderWorkflow)
            record.orderWorkflow = validateOrderWorkflow(record.orderWorkflow)
          for (const [entryId, value] of Object.entries(
            record.productWorkflow || {}
          ))
            record.productWorkflow[entryId] = validateProductWorkflow(value)
          const previous = records.find((entry) => key(entry) === id)
          assertSharedProductFeatureEdit(previous, record, preparations)
          previousRecords.push(previous)
        }
        for (const id of touched) store.put(prepared.get(id))
        if (syncTagCatalogs && packingPreferencesFor)
          await syncTagCatalogs(tx, await packingPreferencesFor(tx), {
            previousRecords,
            touch: true,
          })
        return {
          migrated: selected.length,
          orders: [...touched].map((id) => prepared.get(id)),
        }
      })
    },
  }
}

function patchesConflict(previous = {}, incoming = {}) {
  return Object.entries(incoming).some(([field, value]) => {
    if (!own(previous, field)) return false
    if (value && typeof value === 'object' && !Array.isArray(value))
      return patchesConflict(previous[field], value)
    return previous[field] !== value
  })
}
