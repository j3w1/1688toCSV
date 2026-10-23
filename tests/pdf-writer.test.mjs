import test from 'node:test'
import assert from 'node:assert/strict'
import { createPdf, rgbImage, pdfText } from '../src/pdf-writer.js'

const latin1 = (bytes) => Buffer.from(bytes).toString('latin1')

test('draft PDFs visibly mark every produced page while final output retains its exact original content', () => {
  for (const draft of [false, true]) {
    const pdf = createPdf({ title: 'Synthetic carton marks', draft })
    pdf.page().text('CE26090101', 10, 20)
    pdf.page().text('CE26090102', 10, 20)
    const bytes = latin1(pdf.build())
    assert.match(bytes, /\/Count 2/)
    assert.match(bytes, /\(CE26090101\) Tj/)
    assert.match(bytes, /\(CE26090102\) Tj/)
    assert.equal(
      (bytes.match(/\(DRAFT - UNSEALED \/ UNVERIFIED\) Tj/g) || []).length,
      draft ? 2 : 0
    )
    assert.match(
      bytes,
      draft
        ? /\/Title \(DRAFT - Synthetic carton marks\)/
        : /\/Title \(Synthetic carton marks\)/
    )
  }
})

test('PDF metadata preserves Spanish accents and Chinese titles using UTF-16BE strings', () => {
  for (const title of ['CE 标签', 'Calibración CE']) {
    const pdf = createPdf({ title })
    pdf.page()
    const value = /\/Title <feff([0-9a-f]+)>/.exec(latin1(pdf.build()))?.[1]
    assert.ok(value, title)
    assert.equal(
      value
        .match(/.{4}/g)
        .map((unit) => String.fromCharCode(Number.parseInt(unit, 16)))
        .join(''),
      title
    )
  }
})

test('an A4 PDF has exact page size, a valid cross-reference table and placed images', async () => {
  const pdf = createPdf({ title: 'CE labels (test)' })
  const image = await rgbImage({
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 0]),
  })
  const name = pdf.addImage(image)
  pdf
    .page()
    .image(name, { xMm: 5, yMm: 8.5, widthMm: 40, heightMm: 20 })
    .image(
      name,
      { xMm: 50, yMm: 8.5, widthMm: 20, heightMm: 40 },
      { rotate: true }
    )
    .line(5, 2, 5, 4, { dash: [0.5, 1] })
    .circle(10, 10, 1)
    .text('10 mm (print at 100%)', 5, 295)
  pdf.page().text('Page 2', 105, 290, { align: 'center' })
  const bytes = pdf.build()
  const text = latin1(bytes)
  assert.match(text, /^%PDF-1\.4\n%/)
  assert.match(text, /\/Count 2/)
  assert.match(text, /\/MediaBox \[0 0 595\.276 841\.89\]/)
  assert.match(text, /\/PrintScaling \/None/)
  assert.match(text, /q 113\.386 0 0 56\.693 14\.173 761\.102 cm \/Im1 Do Q/)
  assert.match(text, /q 0 113\.386 -56\.693 0 198\.425 704\.409 cm \/Im1 Do Q/)
  assert.match(text, /\(10 mm \\\(print at 100%\\\)\) Tj/)
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1])
  assert.equal(text.slice(start, start + 4), 'xref')
  const entries = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)]
  assert.ok(entries.length >= 8)
  for (const [index, entry] of entries.entries())
    assert.equal(
      text.slice(
        Number(entry[1]),
        Number(entry[1]) + `${index + 1} 0 obj`.length
      ),
      `${index + 1} 0 obj`
    )
})

test('RGB images are flattened onto white and captions stay ASCII-safe', async () => {
  const image = await rgbImage({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 0]),
  })
  const stream = new Blob([image.bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
  const rgb = new Uint8Array(await new Response(stream).arrayBuffer())
  assert.deepEqual([...rgb], [255, 255, 255])
  assert.equal(
    pdfText('Carton 1 of 3 · 装箱 (x)\\'),
    'Carton 1 of 3 \\(x\\)\\\\'
  )
})

test('100 image pages reference only their used artwork and retain repeated placements', async () => {
  const pdf = createPdf()
  const image = await rgbImage({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255]),
  })
  for (let index = 0; index < 100; index++) {
    const name = pdf.addImage(image)
    const page = pdf
      .page()
      .image(name, { xMm: 5, yMm: 5, widthMm: 10, heightMm: 10 })
    if (index === 0)
      page.image(name, { xMm: 20, yMm: 5, widthMm: 10, heightMm: 10 })
  }
  pdf.page().text('No image', 5, 5)
  const text = latin1(pdf.build())
  const resources = [...text.matchAll(/\/XObject << ([^\n]*?) >>/g)]
  assert.equal(resources.length, 101)
  assert.equal((text.match(/\/Subtype \/Image/g) || []).length, 100)
  assert.equal((text.match(/\/Im\d+ \d+ 0 R/g) || []).length, 100)
  assert.equal((text.match(/\/Im\d+ Do Q/g) || []).length, 101)
  for (let index = 0; index < 100; index++)
    assert.match(resources[index][1], new RegExp(`^/Im${index + 1} \\d+ 0 R$`))
  assert.equal(resources[100][1], '')
  assert.match(text, /\/Producer \(1688toPL\)/)
})

test('dash lengths are millimetres converted to points, like coordinates', () => {
  const pdf = createPdf()
  pdf.page().line(10, 10, 20, 10, { dash: [0.6, 1.6] })
  const text = latin1(pdf.build())
  assert.match(text, /\[1\.701 4\.535\] 0 d/)
})
