export const ORDER_CHARGE_MESSAGES = {
  'External costs are shared by product value. Use Linked payments for payments already recorded in an order.':
    {
      es: 'Los costos externos se distribuyen por valor de producto. Usa Pagos vinculados para pagos ya registrados en un pedido.',
      zh: '外部费用按商品金额分摊。订单中已记录的付款请使用“关联付款”。',
    },
  Unloading: { es: 'Descarga', zh: '卸货' },
  'Local delivery': { es: 'Entrega local', zh: '本地配送' },
  'Confirm the marked whole-order total before importing': {
    es: 'Confirma el total del pedido marcado antes de importar',
    zh: '导入前请确认已标记的整单总金额',
  },
  'Spreadsheet control total does not reconcile with its source rows': {
    es: 'El total de control del Excel no coincide con las filas originales',
    zh: '表格核对总额与原始行金额不一致',
  },
  'Unit price with charges': {
    es: 'Precio unitario con costos',
    zh: '含附加费用单价',
  },
  'Amount with charges': { es: 'Importe con costos', zh: '含附加费用金额' },
  'Added cost': { es: 'Costo añadido', zh: '分摊费用' },
  'Additional charge reasons': {
    es: 'Motivos de los costos adicionales',
    zh: '附加费用说明',
  },
  'Additional order costs': {
    es: 'Costos adicionales del pedido',
    zh: '整单附加费用',
  },
  'Includes ¥{0} of additional order charges. The source unit price stays unchanged.':
    {
      es: 'Incluye ¥{0} de costos adicionales del pedido. El precio unitario original se conserva.',
      zh: '包含 ¥{0} 的整单附加费用。原始单价保持不变。',
    },
  'Additional charges': { es: 'Costos adicionales', zh: '附加费用' },
  'Add charge': { es: 'Añadir costo', zh: '添加费用' },
  'Save charges': { es: 'Guardar costos', zh: '保存费用' },
  'Add order-wide costs such as unloading or label printing. Source prices stay unchanged; the extra cost is shared by product value.':
    {
      es: 'Añade costos para todo el pedido, como descarga o impresión de etiquetas. Los precios originales se conservan; el costo extra se distribuye por el valor de los productos.',
      zh: '添加整单卸货费、标签打印费等费用。保留原始价格，额外费用按商品金额分摊。',
    },
  'Add a reason and the total extra cost for this order.': {
    es: 'Indica el motivo y el costo extra total de este pedido.',
    zh: '填写本订单额外费用的原因和总金额。',
  },
  'Save these costs without replacing any source prices or quantities.': {
    es: 'Guarda estos costos sin sustituir los precios ni las cantidades originales.',
    zh: '保存附加费用，不替换原始价格或数量。',
  },
  Reason: { es: 'Motivo', zh: '原因' },
  'Amount · CNY': { es: 'Importe · CNY', zh: '金额 · 人民币' },
  Actions: { es: 'Acciones', zh: '操作' },
  'No additional charges.': {
    es: 'Sin costos adicionales.',
    zh: '暂无附加费用。',
  },
  'Complete the charge amounts to preview their effect.': {
    es: 'Completa los importes para ver su efecto.',
    zh: '填写费用金额以预览变化。',
  },
  'Order total': { es: 'Total del pedido', zh: '订单总额' },
  'Unit prices show the added cost; exact row totals are used for reconciliation. Product discounts remain unchanged.':
    {
      es: 'Los precios unitarios incluyen el costo extra; la comprobación usa los importes exactos de cada fila. Los descuentos no cambian.',
      zh: '单价显示分摊后的费用；核对使用每行的精确金额。商品折扣保持不变。',
    },
  'Unit price': { es: 'Precio unitario', zh: '单价' },
  'Row amount': { es: 'Importe de la fila', zh: '行金额' },
  'Remove charge': { es: 'Quitar costo', zh: '删除费用' },
  'Remove this extra cost from the draft. Save charges to apply the change.': {
    es: 'Quita este costo del borrador. Guarda los costos para aplicar el cambio.',
    zh: '从草稿中删除此费用。保存费用后生效。',
  },
  'Explain the reason for each additional charge': {
    es: 'Indica el motivo de cada costo adicional',
    zh: '请说明每项附加费用的原因',
  },
  'Additional charge amounts must be positive': {
    es: 'Los costos adicionales deben ser positivos',
    zh: '附加费用金额必须大于零',
  },
  'Enter a positive amount with at most two decimal places.': {
    es: 'Introduce un importe positivo con un máximo de dos decimales.',
    zh: '请输入正数金额，最多保留两位小数。',
  },
  'Additional charges cannot be allocated to an order with zero quantity': {
    es: 'No se pueden distribuir costos en un pedido con cantidad cero',
    zh: '无法将附加费用分摊到数量为零的订单',
  },
  'Product net amounts cannot be negative': {
    es: 'Los importes netos de los productos no pueden ser negativos',
    zh: '商品净额不能为负数',
  },
  'Additional charges require an update timestamp': {
    es: 'Los costos adicionales necesitan una fecha de actualización',
    zh: '附加费用需要更新时间',
  },
  'Backup conflict: additional charges have the same timestamp': {
    es: 'Conflicto en el respaldo: los costos adicionales tienen la misma fecha de actualización',
    zh: '备份冲突：附加费用的更新时间相同',
  },
}
