import { startLibrary } from '../src/library.js'
import { createDemoRecords } from './library-fixture.js'
import { openDatabase } from '../src/database.js'

const records = createDemoRecords(document)
const repository = await openDatabase()
for (const record of records) await repository.saveSnapshot(record.snapshot)
document.querySelector('.local-label').textContent = 'Demo · synthetic orders'
await startLibrary(async (message) => {
  let data
  if (message.type === 'LIBRARY_QUERY') data = { orders: records, jobs: [] }
  else if (message.type === 'JOBS_QUERY') data = { jobs: [] }
  else if (message.type === 'IMAGE_GET') data = message.url
  else if (message.type === 'LIBRARY_HISTORY') data = []
  else if (message.type === 'LIBRARY_NOTES') {
    const record = records.find(
      (record) => record.snapshot.orderId === message.orderId
    )
    record.notes = message.notes
    record.tags = message.tags
    data = record
  } else
    return {
      ok: false,
      error:
        'This is a synthetic preview. Use the installed extension for this action.',
    }
  return { ok: true, data }
}, repository)
