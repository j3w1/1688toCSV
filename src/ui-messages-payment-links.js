export const PAYMENT_LINK_MESSAGES = {
  'This order has no known store identity. Other orders cannot be linked by store name alone; only its own fee rows are available.':
    {
      es: 'Este pedido no tiene una identidad de tienda conocida. El nombre por sí solo no permite vincular otros pedidos; solo están disponibles sus propias filas de costo.',
      zh: '本订单没有已知店铺标识，不能仅凭店名关联其他订单；只能使用当前订单的费用行。',
    },
  'No other recorded order shares this store and account. You can still use an individual fee row from this order.':
    {
      es: 'No hay otro pedido registrado de esta tienda y cuenta. Puedes usar una fila de costo de este pedido.',
      zh: '同一店铺及账户没有其他已记录订单。仍可使用当前订单中的单独费用行。',
    },
  'This order · individual fee rows': {
    es: 'Este pedido · filas de costo individuales',
    zh: '当前订单 · 单独费用行',
  },
  'Only orders from this store and account are shown. Use a whole payment or choose an individual fee row.':
    {
      es: 'Solo se muestran pedidos de esta tienda y cuenta. Usa un pago completo o elige una fila de costo.',
      zh: '仅显示本店及本账户的订单。可使用整笔付款或选择单独费用行。',
    },
  'No orders match this search. Clear it to see this store’s recorded orders.':
    {
      es: 'Ningún pedido coincide. Borra la búsqueda para ver los pedidos registrados de esta tienda.',
      zh: '没有匹配的订单。清空搜索可查看本店已记录的订单。',
    },
  'No recorded source orders belong to this store and account.': {
    es: 'No hay pedidos originales registrados de esta tienda y cuenta.',
    zh: '本店及本账户暂无已记录的来源订单。',
  },
  'Choose a source order above to see its recorded payment and fee rows.': {
    es: 'Elige un pedido arriba para ver su pago registrado y sus filas de costo.',
    zh: '请先选择上方来源订单，查看已记录的付款及费用行。',
  },
  'This order has no fee row with other eligible goods to receive its cost. Import another payment order from this store, or add an external cost in Additional charges.':
    {
      es: 'Este pedido no tiene una fila de costo con otros productos aptos para recibirla. Importa otro pedido de pago de esta tienda o registra un costo externo en Costos adicionales.',
      zh: '本订单没有可向其他适用商品分摊的费用行。请导入本店另一笔付款订单，或在“附加费用”中添加外部费用。',
    },
  'This source has no positive recorded payment or fee amount to link.': {
    es: 'Este pedido no tiene un pago ni costo registrado mayor que cero para vincular.',
    zh: '此来源没有可关联的正数付款或费用金额。',
  },
  'Recorded source {0} · payable {1} · shipping {2}': {
    es: 'Importe original {0} · total {1} · envío {2}',
    zh: '原始金额 {0} · 应付 {1} · 运费 {2}',
  },
  'Payment skip ownership is invalid': {
    es: 'El registro de omisiones de este pago no es válido',
    zh: '付款关联的跳过装箱记录无效',
  },
  'Linked payments': { es: 'Pagos vinculados', zh: '关联付款' },
  'No linked payments': { es: 'Sin pagos vinculados', zh: '暂无关联付款' },
  'Review linked payments': {
    es: 'Revisar pagos vinculados',
    zh: '核对关联付款',
  },
  'Source payment needs review': {
    es: 'Revisar el pago original',
    zh: '原始付款需要核对',
  },
  'Attributed linked cost': {
    es: 'Costo vinculado distribuido',
    zh: '关联费用分摊',
  },
  'Linked cost': { es: 'Costo vinculado', zh: '关联费用' },
  'Linked cost reasons': {
    es: 'Motivos del costo vinculado',
    zh: '关联费用说明',
  },
  'Product features': { es: 'Características del producto', zh: '商品功能' },
  'Source payables stay unchanged. This redistributes recorded cost and does not add another payment.':
    {
      es: 'Los importes originales por pagar se conservan. Se distribuye un costo ya registrado sin añadir otro pago.',
      zh: '原始应付金额保持不变。此操作分摊已记录的费用，不增加一笔付款。',
    },
  'No goods cost changes in this draft.': {
    es: 'Este borrador no cambia el costo de los productos.',
    zh: '此草稿未改变商品成本。',
  },
  'Linked payment source rows will be skipped in packing. Removing a link restores only skips authored by that link when no later edit replaced them.':
    {
      es: 'Las filas del pago vinculado se omitirán del empaque. Al quitar el vínculo, solo se deshacen las omisiones creadas por este si no hubo cambios posteriores.',
      zh: '关联付款的原始行将跳过装箱。取消关联仅恢复由本关联设置且未被后续编辑覆盖的跳过状态。',
    },
  'Existing payment source': {
    es: 'Pago original registrado',
    zh: '已记录的付款来源',
  },
  'Choose source order': { es: 'Elige el pedido original', zh: '选择原始订单' },
  'Search this store’s orders': {
    es: 'Buscar pedidos de esta tienda',
    zh: '搜索本店订单',
  },
  'Search existing orders from this store. Choose this order to use one of its fee rows.':
    {
      es: 'Busca pedidos registrados de esta tienda. Elige este pedido para usar una de sus filas de costo.',
      zh: '搜索本店已记录的订单。选择当前订单即可使用其中的费用行。',
    },
  'This existing link is kept for review. New payment sources must belong to this store.':
    {
      es: 'Este vínculo registrado se conserva para revisar. Los nuevos pagos originales deben pertenecer a esta tienda.',
      zh: '保留此已有关联以供核对。新增付款来源必须属于本店。',
    },
  'Choose a payment source from the same known store and account': {
    es: 'Elige un pago original de la misma tienda identificada y cuenta',
    zh: '请选择同一已识别店铺和账户的付款来源',
  },
  'Whole existing payment, including shipping': {
    es: 'Todo el pago registrado, incluido el envío',
    zh: '整笔已记录付款，含运费',
  },
  'All eligible goods': {
    es: 'Todos los productos aptos',
    zh: '全部可分摊商品',
  },
  'Selected goods': { es: 'Productos elegidos', zh: '所选商品' },
  'Source order': { es: 'Pedido original', zh: '原始订单' },
  'Payment or fee row': { es: 'Pago o fila de costo', zh: '付款或费用行' },
  'Recorded amount to attribute · CNY': {
    es: 'Importe registrado a distribuir · CNY',
    zh: '分摊已记录金额 · 人民币',
  },
  'Receiving goods': {
    es: 'Productos que reciben el costo',
    zh: '接收费用的商品',
  },
  'Recorded source amount ¥{0} · source payable ¥{1} · source shipping ¥{2}': {
    es: 'Importe original ¥{0} · total original ¥{1} · envío original ¥{2}',
    zh: '原始金额 ¥{0} · 原始应付 ¥{1} · 原始运费 ¥{2}',
  },
  'Review source amount': {
    es: 'Revisar el importe original',
    zh: '核对原始金额',
  },
  'Remove link': { es: 'Quitar vínculo', zh: '取消关联' },
  'Link existing payment': {
    es: 'Vincular pago registrado',
    zh: '关联已记录付款',
  },
  'Link an already recorded payment or fee to its original goods. Keep manually entered additional charges separate.':
    {
      es: 'Vincula un pago o costo ya registrado a sus productos originales. Los costos adicionales introducidos a mano se guardan por separado.',
      zh: '将已记录的付款或费用关联至原始商品。手动输入的附加费用单独保存。',
    },
  'I reviewed the source payment, receiving goods, costs and packing exclusions.':
    {
      es: 'Revisé el pago original, los productos, los costos y las omisiones de empaque.',
      zh: '我已核对原始付款、接收商品、费用及跳过装箱的行。',
    },
  'Save reviewed links': {
    es: 'Guardar vínculos revisados',
    zh: '保存已核对关联',
  },
  'Payment links require valid order, product and link IDs': {
    es: 'Los vínculos necesitan identificadores válidos de pedido, producto y vínculo',
    zh: '付款关联需要有效的订单、商品及关联编号',
  },
  'Payment links require a review timestamp': {
    es: 'Los vínculos necesitan una fecha de revisión',
    zh: '付款关联需要核对时间',
  },
  'Payment link amounts must use exact cents': {
    es: 'Los importes vinculados deben ser positivos y tener como máximo dos decimales',
    zh: '关联付款金额必须为正数且精确到分',
  },
  'Payment link amounts must be positive': {
    es: 'Los importes vinculados deben ser positivos',
    zh: '关联付款金额必须大于零',
  },
  'Choose eligible goods for this payment link': {
    es: 'Elige productos aptos para este pago',
    zh: '请为此付款关联选择可分摊商品',
  },
  'Payment links cannot repeat a product': {
    es: 'Los vínculos no pueden repetir productos',
    zh: '付款关联不能重复选择商品',
  },
  'Payment links must be an array': {
    es: 'Los pagos vinculados deben ser una lista',
    zh: '付款关联必须为列表',
  },
  'Payment links must contain reviewed payments': {
    es: 'Los vínculos deben contener pagos revisados',
    zh: '付款关联必须包含已核对的付款',
  },
  'This payment source is already linked to this order': {
    es: 'Este pago original ya está vinculado al pedido',
    zh: '此付款来源已关联至本订单',
  },
  'Explain the reason for each linked payment': {
    es: 'Indica el motivo de cada pago vinculado',
    zh: '请说明每笔关联付款的原因',
  },
  'Review the existing source amount before linking': {
    es: 'Revisa el importe original antes de vincularlo',
    zh: '关联前请核对已记录的原始金额',
  },
  'Linked amounts exceed the existing source payment': {
    es: 'Los importes vinculados superan el pago original registrado',
    zh: '关联金额超过已记录的原始付款',
  },
  'Backup conflict: payment links have the same timestamp': {
    es: 'Conflicto en la copia: los pagos vinculados tienen la misma fecha',
    zh: '备份冲突：付款关联的更新时间相同',
  },
  'The linked payment source product was not found': {
    es: 'No se encontró la fila original del pago vinculado',
    zh: '找不到关联付款的原始商品行',
  },
  'The linked payment source order was not found in this account': {
    es: 'No se encontró el pedido original del pago en esta cuenta',
    zh: '在本账户中找不到关联付款的原始订单',
  },
  'Review changes to the linked source payment': {
    es: 'Revisa los cambios del pago original vinculado',
    zh: '请核对关联原始付款的变更',
  },
  'Payment links need the complete source orders': {
    es: 'Los vínculos necesitan los pedidos originales completos',
    zh: '付款关联需要完整的原始订单',
  },
  'Payment links need unique source orders': {
    es: 'Los vínculos necesitan pedidos originales sin duplicados',
    zh: '付款关联需要唯一的原始订单',
  },
  'Payment link IDs must be unique in this account': {
    es: 'Los identificadores de vínculo deben ser únicos en esta cuenta',
    zh: '付款关联编号在本账户中必须唯一',
  },
  'An order cannot link its whole payment to itself': {
    es: 'Un pedido no puede vincularse todo su propio pago',
    zh: '订单不能将自身整笔付款关联给自己',
  },
  'Link either the whole payment or its fee rows, not both': {
    es: 'Vincula el pago completo o sus filas de costo; no ambos',
    zh: '请选择关联整笔付款或其中的费用行，不能同时关联',
  },
  'Payment links cannot create a cycle': {
    es: 'Los pagos vinculados no pueden formar un ciclo',
    zh: '付款关联不能形成循环',
  },
  'Payment links need the order repository context': {
    es: 'Los pagos vinculados necesitan el repositorio de pedidos',
    zh: '付款关联需要订单数据库环境',
  },
  'Payment links changed while this review was open': {
    es: 'Los vínculos cambiaron mientras la revisión estaba abierta',
    zh: '核对期间付款关联已被修改',
  },
  'The source payment changed while this review was open': {
    es: 'El pago original cambió mientras la revisión estaba abierta',
    zh: '核对期间原始付款已被修改',
  },
  'The payment link was not found': {
    es: 'No se encontró el pago vinculado',
    zh: '找不到付款关联',
  },
  'Choose an existing payment source order': {
    es: 'Elige un pedido de pago ya registrado',
    zh: '请选择已记录的付款来源订单',
  },
  'Confirm the payment review before saving': {
    es: 'Confirma la revisión del pago antes de guardar',
    zh: '保存前请确认付款核对',
  },
}
