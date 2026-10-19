import test from 'node:test'
import assert from 'node:assert/strict'
import { canvasPage } from '../src/print-canvas.js'
import { createPdf, POINTS_PER_MM } from '../src/pdf-writer.js'
import { drawOps } from '../src/print-layout.js'

function recordingContext() {
  const calls = []
  const context = new Proxy(
    { calls },
    {
      get: (target, name) =>
        name === 'calls' ? calls : (...args) => calls.push([name, ...args]),
      set: (target, name, value) => {
        calls.push([`set:${String(name)}`, value])
        return true
      },
    }
  )
  return context
}

test('the preview and the PDF place captions and dashes with the same millimetre geometry', () => {
  const k = 3
  const ops = [
    {
      type: 'text',
      value: 'CE labels - page 1 of 2 - print at 100% (Actual size)',
      x: 105,
      y: 293,
      size: 5,
      gray: 0.5,
      align: 'center',
    },
    {
      type: 'text',
      value: 'Right edge',
      x: 200,
      y: 20,
      size: 8,
      gray: 0.2,
      align: 'right',
    },
    {
      type: 'line',
      x1: 10,
      y1: 10,
      x2: 60,
      y2: 10,
      gray: 0.8,
      widthPt: 0.2,
      dash: [0.6, 1.6],
    },
  ]
  const context = recordingContext()
  drawOps(canvasPage(context, k), ops, () => null)
  const canvasTexts = context.calls.filter(([name]) => name === 'fillText')
  const canvasDash = context.calls.find(([name]) => name === 'setLineDash')[1]

  const pdf = createPdf()
  drawOps(pdf.page(), ops, () => null)
  const content = Buffer.from(pdf.build()).toString('latin1')
  const pdfLefts = [...content.matchAll(/ ([\d.]+) [\d.]+ Td \(/g)].map(
    (match) => Number(match[1]) / POINTS_PER_MM
  )
  const pdfDash = content
    .match(/\[([\d.]+) ([\d.]+)\] 0 d/)
    .slice(1)
    .map((value) => Number(value) / POINTS_PER_MM)

  assert.equal(canvasTexts.length, 2)
  for (const [index, [, , x]] of canvasTexts.entries())
    assert.ok(
      Math.abs(x / k - pdfLefts[index]) < 0.001,
      `caption ${index}: ${x / k} vs ${pdfLefts[index]}`
    )
  // Both draw left-aligned from that edge; the canvas never re-aligns by its own metrics.
  assert.ok(
    context.calls.some(
      ([name, value]) => name === 'set:textAlign' && value === 'left'
    )
  )
  assert.ok(
    !context.calls.some(
      ([name, value]) => name === 'set:textAlign' && value !== 'left'
    )
  )
  for (const [index, value] of canvasDash.entries())
    assert.ok(Math.abs(value / k - [0.6, 1.6][index]) < 1e-9)
  for (const [index, value] of pdfDash.entries())
    assert.ok(Math.abs(value - [0.6, 1.6][index]) < 0.001)
  // The canvas prints the same ASCII text the PDF prints.
  assert.equal(
    canvasTexts[0][1],
    'CE labels - page 1 of 2 - print at 100% (Actual size)'
  )
})
