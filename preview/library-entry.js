import { startLibrary } from '../src/library.js'
import { createDemoRecords } from './library-fixture.js'
import { openDatabase } from '../src/database.js'
import { loadThumbnail } from '../src/images.js'

const records = createDemoRecords(document)
const repository = await openDatabase()
for (const record of records) {
  for (const item of record.snapshot.items) {
    item.title = item.description.startsWith('Scented')
      ? '合成香薰蜡烛'
      : item.description.startsWith('Glass')
        ? '合成无火香薰'
        : item.description.startsWith('Cotton')
          ? '合成棉绳收纳篮'
          : item.description.startsWith('Everyday')
            ? '合成帆布包'
            : '合成木质收纳盒'
    item.skuProperties = item.description
      .split('\n')[1]
      .split(' · ')
      .map((raw) => {
        const [label, ...value] = raw.split('：')
        return { label, value: value.join('：'), raw }
      })
      .filter((property) => property.label !== '货号')
  }
  await repository.saveSnapshot(record.snapshot)
}
document.querySelector('.local-label').textContent = 'Demo · synthetic orders'
await startLibrary(async (message) => {
  let data
  if (message.type === 'LIBRARY_QUERY')
    data = { orders: await repository.listOrders(), jobs: [] }
  else if (message.type === 'JOBS_QUERY') data = { jobs: [] }
  else if (message.type === 'IMAGE_GET')
    data = await loadThumbnail(message.url, repository)
  else if (message.type === 'LIBRARY_HISTORY') data = []
  else if (message.type === 'LIBRARY_NOTES') {
    data = await repository.setNotes(message.orderId, {
      notes: message.notes,
      tags: message.tags,
    })
  } else
    return {
      ok: false,
      error:
        'This is a synthetic preview. Use the installed extension for this action.',
    }
  return { ok: true, data }
}, repository)
