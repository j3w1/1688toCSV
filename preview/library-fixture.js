// Synthetic products only; shared by screenshots and browser integration tests.
export function createDemoRecords(document) {
  function picture(kind, tone) {
    const c = document.createElement('canvas')
    c.width = 96
    c.height = 96
    const x = c.getContext('2d')
    x.fillStyle = '#f5efe3'
    x.fillRect(0, 0, 96, 96)
    x.fillStyle = tone
    if (kind === 'candle') {
      x.fillRect(29, 34, 38, 42)
      x.fillStyle = '#eebf66'
      x.beginPath()
      x.ellipse(48, 24, 5, 9, 0, 0, 7)
      x.fill()
      x.fillStyle = '#f5ddaa'
      x.fillRect(34, 48, 28, 15)
    } else if (kind === 'bottle') {
      x.fillRect(34, 28, 29, 49)
      x.fillStyle = '#494c36'
      x.fillRect(39, 18, 19, 12)
      x.fillStyle = '#f2e7cc'
      x.fillRect(38, 40, 21, 22)
    } else if (kind === 'bag') {
      x.fillRect(25, 34, 47, 44)
      x.lineWidth = 5
      x.strokeStyle = tone
      x.beginPath()
      x.arc(48, 35, 13, Math.PI, 0)
      x.stroke()
      x.strokeStyle = '#ffffff66'
      x.lineWidth = 1
      x.strokeRect(31, 42, 35, 29)
    } else {
      x.fillRect(20, 39, 56, 34)
      x.fillStyle = '#857257'
      x.fillRect(17, 34, 62, 8)
      x.fillStyle = '#d8cba9'
      x.fillRect(39, 49, 19, 7)
    }
    return c.toDataURL('image/png')
  }
  const products = [
    [
      'Scented soy candle · warm amber\n香型：琥珀木香 · 货号：SC-104',
      '12.50',
      '40',
      '10.00',
      picture('candle', '#be7043'),
    ],
    [
      'Glass diffuser · cedar & fig\n香型：雪松无花果 · 容量：120ml',
      '18.90',
      '24',
      '12.00',
      picture('bottle', '#c6a873'),
    ],
    [
      'Cotton storage basket · natural\n颜色：原色 · 尺寸：中号',
      '8.20',
      '80',
      '16.40',
      picture('box', '#c9ae7e'),
    ],
    [
      'Everyday canvas tote · olive\n颜色：橄榄绿 · 尺码：均码',
      '16.00',
      '36',
      '14.40',
      picture('bag', '#7e8961'),
    ],
    [
      'Scented soy candle · soft linen\n香型：柔软亚麻 · 货号：SC-108',
      '12.50',
      '40',
      '10.00',
      picture('candle', '#d9b891'),
    ],
    [
      'Glass diffuser · white tea\n香型：白茶 · 容量：120ml',
      '18.90',
      '24',
      '12.00',
      picture('bottle', '#a4b58c'),
    ],
    [
      'Lidded keepsake box · walnut\n颜色：胡桃木 · 尺寸：小号',
      '9.80',
      '50',
      '9.80',
      picture('box', '#a27c55'),
    ],
    [
      'Everyday canvas tote · charcoal\n颜色：炭灰色 · 尺码：均码',
      '16.00',
      '36',
      '14.40',
      picture('bag', '#6e7771'),
    ],
  ]
  return [products.slice(0, 3), products.slice(3, 6), products.slice(6)].map(
    (group, index) => {
      const items = group.map((product, i) => ({
        entryId: `9000000000000000${index}${i}`,
        description: product[0],
        price: product[1],
        quantity: product[2],
        sourceDiscount: product[3],
        allocatedDiscount: '0.00',
        discount: product[3],
        thumbnail: product[4],
      }))
      const gross = items.reduce(
        (sum, item) =>
          sum + Math.round(Number(item.price) * 100) * Number(item.quantity),
        0
      )
      const discount = items.reduce(
        (sum, item) => sum + Math.round(Number(item.discount) * 100),
        0
      )
      const orderId = `90000000000000000${3 - index}`
      const observedAt = `2026-10-13T0${9 - index}:30:00.000Z`
      return {
        snapshot: {
          schemaVersion: 1,
          accountId: 'local',
          orderId,
          sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
          sellerName: [
            '栖木家居 · Habitat Studio',
            '青禾日用 · Greenfield',
            '简物工厂 · Simple Goods',
          ][index],
          status: index === 0 ? '待发货' : '交易成功',
          observedAt,
          purchasedAt: [
            '2026-10-12T10:15:00+08:00',
            '2026-10-08T14:20:00+08:00',
            '2026-09-25T09:30:00+08:00',
          ][index],
          items,
          totals: {
            goodsGross: (gross / 100).toFixed(2),
            shipping: '0.00',
            sourceDiscount: (discount / 100).toFixed(2),
            orderAdjustment: '0.00',
            goodsNet: ((gross - discount) / 100).toFixed(2),
            payable: ((gross - discount) / 100).toFixed(2),
          },
        },
        revision: index === 0 ? 2 : 1,
        changedAt: observedAt,
        lastCheckedAt: observedAt,
        notes: '',
        tags: [],
        changedEntryIds: index === 0 ? [items[0].entryId] : [],
        removedEntryIds: [],
      }
    }
  )
}
