const SCHEMA = '1688-order-library-change/v1'
const validStores = (stores) =>
  Array.isArray(stores) &&
  stores.length > 0 &&
  stores.length <= 32 &&
  stores.every(
    (store) =>
      typeof store === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(store)
  )

/** Advisory local invalidation only. Revisions and transactions remain authority. */
export function createLibraryChanges(databaseName = '1688-order-library') {
  const listeners = new Set()
  let channel,
    closed = false,
    sequence = 0
  const closeChannel = () => {
    channel?.close()
    channel = undefined
  }
  const ensure = () => {
    if (closed || channel || typeof globalThis.BroadcastChannel !== 'function')
      return channel
    try {
      channel = new BroadcastChannel(
        `1688-order-library:changes:v1:${databaseName}`
      )
      channel.onmessage = ({ data }) => {
        if (
          data?.schema !== SCHEMA ||
          !Number.isSafeInteger(data.sequence) ||
          data.sequence < 1 ||
          !validStores(data.stores) ||
          Object.keys(data).some(
            (key) => !['schema', 'sequence', 'stores'].includes(key)
          )
        )
          return
        const change = Object.freeze({
          schema: SCHEMA,
          sequence: data.sequence,
          stores: Object.freeze([...data.stores]),
        })
        for (const listener of listeners) {
          try {
            Promise.resolve(listener(change)).catch(() => {})
          } catch {}
        }
      }
    } catch {
      channel = undefined
    }
    return channel
  }
  const dispose = () => {
    if (closed) return
    closed = true
    listeners.clear()
    closeChannel()
    globalThis.removeEventListener?.('pagehide', dispose)
  }
  globalThis.addEventListener?.('pagehide', dispose, { once: true })
  return {
    publish(stores) {
      if (closed) return
      const names = [...new Set(stores)]
      if (!validStores(names)) return
      const target = ensure()
      if (!target) return
      try {
        target.postMessage({
          schema: SCHEMA,
          sequence: ++sequence,
          stores: names,
        })
      } catch {}
    },
    subscribe(listener) {
      if (closed) throw new Error('Library change subscription is closed')
      if (typeof listener !== 'function')
        throw new TypeError('Use a library change listener')
      listeners.add(listener)
      ensure()
      return () => {
        listeners.delete(listener)
        if (!listeners.size) closeChannel()
      }
    },
    close: dispose,
  }
}

/** For an extension page which observes the library without opening a connection. */
export function subscribeLibraryChanges(
  listener,
  { databaseName = '1688-order-library' } = {}
) {
  const changes = createLibraryChanges(databaseName)
  const unsubscribe = changes.subscribe(listener)
  return () => {
    unsubscribe()
    changes.close()
  }
}
