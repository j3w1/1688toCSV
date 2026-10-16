import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createActivityTracker,
  activitySummary,
  ACTIVITY_READ_KEY,
} from '../src/activity-state.js'

const job = (extra = {}) => ({
  id: 'synthetic-job',
  state: 'running',
  completed: 2,
  total: 10,
  failed: 0,
  ...extra,
})
test('activity distinguishes ongoing imports and unread completed events without notifying on every poll', () => {
  const saved = new Map(),
    storage = {
      getItem: (key) => saved.get(key),
      setItem: (key, value) => saved.set(key, value),
    }
  const tracker = createActivityTracker(storage)
  assert.deepEqual(tracker.summary([job()]), { running: 1, unread: 1 })
  tracker.markRead([job()])
  assert.deepEqual(
    tracker.summary([job({ completed: 7, updatedAt: 'later' })]),
    { running: 1, unread: 0 }
  )
  assert.deepEqual(
    tracker.summary([job({ state: 'completed', completed: 10 })]),
    { running: 0, unread: 1 }
  )
  tracker.markRead([job({ state: 'completed', completed: 10 })])
  assert.deepEqual(
    createActivityTracker(storage).summary([
      job({ state: 'completed', completed: 10 }),
    ]),
    { running: 0, unread: 0 }
  )
  assert.ok(saved.get(ACTIVITY_READ_KEY))
})
test('new failure checkpoints become unread, dismissed jobs stay quiet, and reading does not alter jobs', () => {
  const tracker = createActivityTracker({
      getItem: () => null,
      setItem: () => {},
    }),
    jobs = [job()],
    before = structuredClone(jobs)
  tracker.markRead(jobs)
  assert.deepEqual(
    tracker.summary([job({ failed: 1, error: 'Synthetic amount mismatch' })]),
    { running: 1, unread: 1 }
  )
  assert.deepEqual(
    activitySummary([job({ state: 'paused', dismissedAt: 'now' })]),
    { running: 0, unread: 0 }
  )
  assert.deepEqual(jobs, before)
})
test('blocked preference storage retains session read state and external updates can be reloaded', () => {
  const tracker = createActivityTracker({
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  })
  tracker.markRead([job()])
  tracker.reload()
  assert.equal(tracker.summary([job()]).unread, 0)
  const saved = new Map(),
    storage = {
      getItem: (key) => saved.get(key),
      setItem: (key, value) => saved.set(key, value),
    },
    first = createActivityTracker(storage),
    second = createActivityTracker(storage)
  first.markRead([job()])
  second.reload()
  assert.equal(second.summary([job()]).unread, 0)
})
