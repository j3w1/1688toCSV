import { pngImage, copyTable } from './clipboard.js'
import { message } from './i18n.js'
import { yieldUI } from './ui.js'
import {
  openImageCopyDialog,
  imageBatchPlans,
  ImageBatchTooLarge,
} from './image-copy-dialog.js'

export function copySourceImages(rows, { loadImage, imagesOnly, headers }) {
  const frozen = rows.map((row) =>
    Object.fromEntries(
      ['thumbnail', 'description', 'price', 'quantity', 'discount'].map(
        (key) => [key, row[key]]
      )
    )
  )
  return openImageCopyDialog({
    title: imagesOnly ? 'Product photos' : 'Excel cells',
    count: frozen.length,
    plan: () => imageBatchPlans(frozen.length, 20),
    prepare: async ({ start, end }, { signal, onProgress }) => {
      const selected = frozen.slice(start, end)
      const originals = new Map()
      const images = []
      let bytes = 0
      for (const [index, row] of selected.entries()) {
        signal.throwIfAborted()
        onProgress(
          message('Preparing {0} of {1}', { 0: index + 1, 1: selected.length })
        )
        if (!originals.has(row.thumbnail)) {
          const source = await loadImage(row.thumbnail)
          signal.throwIfAborted()
          originals.set(row.thumbnail, await pngImage(source))
        }
        signal.throwIfAborted()
        const image = originals.get(row.thumbnail)
        // Clipboard HTML embeds repeated photos once for every source row.
        bytes += image.length * 2
        if (bytes > 32 * 1024 * 1024)
          throw new ImageBatchTooLarge(
            'This photo exceeds the clipboard memory budget. Copy its values separately.'
          )
        images.push(image)
        await yieldUI()
      }
      return {
        images: images.map((url, index) => ({
          url,
          label: selected[index].description?.split('\n')[0],
        })),
        payload: { selected, images },
      }
    },
    write: ({ selected, images }) =>
      copyTable(selected, { images, imagesOnly, headers }),
  })
}
