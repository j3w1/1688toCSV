// The workspace status line an automation agent reads: one state at a time,
// most urgent first, with a stable data-status value.

export const STATUSES = Object.freeze([
  'importing',
  'needs-sign-in',
  'export-finished',
  'idle',
])

export function workspaceStatus({ jobs = [], lastExport = null } = {}) {
  const running = jobs.find((job) => job.state === 'running')
  if (running) return { status: 'importing', job: running }
  const attention = jobs.find(
    (job) => job.state === 'paused' && job.attention && !job.dismissedAt
  )
  if (attention)
    return {
      status:
        attention.attention.kind === 'visible-reader'
          ? 'needs-visible-tab'
          : 'needs-sign-in',
      job: attention,
    }
  if (lastExport?.files?.length)
    return {
      status: 'export-finished',
      files: lastExport.files,
      at: lastExport.at,
    }
  return { status: 'idle' }
}
