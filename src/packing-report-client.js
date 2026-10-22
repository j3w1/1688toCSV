const cancelled = () =>
  new DOMException('Packing report cancelled', 'AbortError')

/** Retain caller bytes: only a copy is transferred to the disposable local worker. */
export async function runPackingReportAsync({
  operation,
  input,
  generation,
  signal,
} = {}) {
  if (signal?.aborted) throw cancelled()
  if (!Number.isSafeInteger(generation) || generation < 0)
    throw new Error('Report generation required')
  const worker = new Worker('packing-report-worker.js')
  try {
    return await new Promise((resolve, reject) => {
      let settled = false
      const finish = (action, value) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        action(value)
      }
      const abort = () => finish(reject, cancelled())
      signal?.addEventListener('abort', abort, { once: true })
      worker.addEventListener(
        'message',
        ({ data }) => {
          if (data.generation !== generation) {
            finish(reject, cancelled())
            return
          }
          if (data.error) finish(reject, new Error(data.error))
          else finish(resolve, { generation, result: data.result })
        },
        { once: true }
      )
      worker.addEventListener(
        'error',
        () => finish(reject, new Error('Packing report worker failed.')),
        { once: true }
      )
      worker.addEventListener(
        'messageerror',
        () =>
          finish(
            reject,
            new Error('Packing report result could not be decoded.')
          ),
        { once: true }
      )
      const payload = { ...input },
        transfers = []
      if (input?.buffer instanceof ArrayBuffer) {
        payload.buffer = input.buffer.slice(0)
        transfers.push(payload.buffer)
      }
      try {
        worker.postMessage({ operation, input: payload, generation }, transfers)
      } catch (error) {
        finish(reject, error)
      }
    })
  } finally {
    worker.terminate()
  }
}

/** One controller per intake. Cancel on source/sheet/order change or dialog disposal. */
export function createPackingReportClient() {
  let generation = 0,
    controller = null
  const cancel = () => {
    generation++
    controller?.abort()
    controller = null
  }
  return {
    cancel,
    get generation() {
      return generation
    },
    async run({ operation, input, signal } = {}) {
      cancel()
      const current = generation,
        active = new AbortController()
      controller = active
      const abort = () => active.abort()
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) active.abort()
      try {
        const result = await runPackingReportAsync({
          operation,
          input,
          generation: current,
          signal: active.signal,
        })
        if (generation !== current) throw cancelled()
        return result
      } finally {
        signal?.removeEventListener('abort', abort)
        if (controller === active) controller = null
      }
    },
  }
}
