export const ACTIVITY_READ_KEY = '1688-workspace-activity-read'

// Progress counters and polling timestamps are not new notifications. A new
// job, state transition, or changed failure checkpoint is worth reviewing.
export function activityFingerprint(job) {
  const failed = job.orders?.length
    ? job.orders.filter((order) => order.state === 'failed').length
    : job.failed || 0
  return JSON.stringify([job.state, failed, job.error || ''])
}

export function activitySummary(jobs, seen = {}) {
  const visible = jobs.filter(
    (job) => !job.dismissedAt || job.state === 'running'
  )
  return {
    running: visible.filter((job) => job.state === 'running').length,
    unread: visible.filter((job) => seen[job.id] !== activityFingerprint(job))
      .length,
  }
}

export function createActivityTracker(storage) {
  if (!storage) {
    try {
      storage = globalThis.localStorage
    } catch {}
  }
  let seen = {}
  function reload() {
    try {
      const value = JSON.parse(storage?.getItem(ACTIVITY_READ_KEY) || '{}')
      seen =
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([id, entry]) => id && typeof entry === 'string')
                .slice(-500)
            )
          : {}
    } catch {
      /* Keep the current session's read state if storage is blocked. */
    }
  }
  reload()
  return {
    reload,
    summary: (jobs) => activitySummary(jobs, seen),
    markRead(jobs) {
      let changed = false
      for (const job of jobs.filter(
        (job) => !job.dismissedAt || job.state === 'running'
      )) {
        const fingerprint = activityFingerprint(job)
        if (seen[job.id] !== fingerprint) {
          seen[job.id] = fingerprint
          changed = true
        }
      }
      if (!changed) return
      seen = Object.fromEntries(Object.entries(seen).slice(-500))
      try {
        storage?.setItem(ACTIVITY_READ_KEY, JSON.stringify(seen))
      } catch {}
    },
  }
}
