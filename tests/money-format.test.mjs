import test from 'node:test'
import assert from 'node:assert/strict'
import { formatCny } from '../src/money-format.js'

test('CNY display groups exact large values and retains fractional unit prices', () => {
  assert.equal(
    formatCny('9007199254740993123.45', 'en-US'),
    '¥9,007,199,254,740,993,123.45'
  )
  assert.equal(formatCny('12345.67', 'es-ES'), '¥12.345,67')
  assert.equal(formatCny('12345.67', 'zh-CN'), '¥12,345.67')
  assert.equal(formatCny('-1234.5', 'en-US'), '−¥1,234.50')
  assert.equal(formatCny('−12.00', 'en-US'), '−¥12.00')
  assert.equal(formatCny('+12', 'en-US'), '+¥12.00')
  assert.equal(formatCny('0.00625', 'en-US'), '¥0.00625')
})
