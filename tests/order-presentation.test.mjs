import test from 'node:test'
import assert from 'node:assert/strict'
import { presentOrderStatus } from '../src/order-presentation.js'

test('known source statuses get distinct readable display labels; unknowns remain intact', () => {
  assert.deepEqual(presentOrderStatus('交易成功'), {
    label: 'Completed',
    tone: 'success',
  })
  assert.deepEqual(presentOrderStatus('交易已成功'), {
    label: 'Completed',
    tone: 'success',
  })
  assert.deepEqual(presentOrderStatus('等待买家付款'), {
    label: 'Awaiting payment',
    tone: 'warning',
  })
  assert.deepEqual(presentOrderStatus('买家已付款，等待卖家发货'), {
    label: 'Awaiting shipment',
    tone: 'info',
  })
  assert.deepEqual(presentOrderStatus('卖家已发货，等待买家确认收货'), {
    label: 'Awaiting delivery',
    tone: 'info',
  })
  assert.deepEqual(presentOrderStatus('交易关闭'), {
    label: 'Closed',
    tone: 'muted',
  })
  assert.deepEqual(presentOrderStatus('交易成功（特殊状态）'), {
    label: '交易成功（特殊状态）',
    tone: 'muted',
  })
})
