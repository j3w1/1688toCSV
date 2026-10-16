/** Serialize writes, coalesce typing, and retain a failed/newer draft until retried. */
export function createAnnotationAutosave({
  initial,
  write,
  onState = () => {},
  delay = 350,
}) {
  let latest = structuredClone(initial),
    saved = JSON.stringify(initial),
    timer,
    running
  const dirty = () => JSON.stringify(latest) !== saved
  async function flush() {
    clearTimeout(timer)
    if (running) {
      await running
      return dirty() ? flush() : undefined
    }
    if (!dirty()) {
      onState('saved')
      return
    }
    const work = (async () => {
      while (dirty()) {
        const value = structuredClone(latest),
          signature = JSON.stringify(value)
        onState('saving')
        try {
          await write(value)
          saved = signature
        } catch (error) {
          onState('error', error)
          throw error
        }
      }
      onState('saved')
    })()
    running = work
    try {
      await work
    } finally {
      if (running === work) running = null
    }
  }
  return {
    flush,
    // A pending write can still replace the saved value even when the user has
    // already reverted to it. Keep exit protection until that write is settled.
    dirty: () => Boolean(running) || dirty(),
    update(value) {
      latest = structuredClone(value)
      clearTimeout(timer)
      onState('pending')
      timer = setTimeout(() => {
        void flush().catch(() => {})
      }, delay)
    },
  }
}
