export const REPEAT_PRODUCT_MESSAGES = {
  'Shared store identity requires a shared product': {
    zh: '共用店铺身份必须对应共用商品',
    es: 'La identidad de tienda compartida requiere un producto compartido',
  },
  'Shared products require a shared identity for every variant': {
    zh: '共用商品的每个款式都必须有共用身份',
    es: 'Cada variante de un producto compartido necesita una identidad compartida',
  },
  'A base reservation cannot own a shared variant': {
    zh: '基础编码预留不能拥有共用款式身份',
    es: 'Una reserva de código base no puede tener una variante compartida',
  },
  'Shared code reservation requires its source members': {
    zh: '共用编码预留必须包含来源成员',
    es: 'La reserva de código compartido requiere sus miembros originales',
  },
  'Shared code reservation contains duplicate members': {
    zh: '共用编码预留包含重复成员',
    es: 'La reserva de código compartido contiene miembros duplicados',
  },
  'Shared code reservation is missing its primary source member': {
    zh: '共用编码预留缺少主要来源成员',
    es: 'Falta el miembro original principal en la reserva de código compartido',
  },
  'Shared code members require a shared product identity': {
    zh: '共用编码成员必须具有共用商品身份',
    es: 'Los miembros del código compartido requieren una identidad de producto compartido',
  },
  'Packing backup dependencies must be an array': {
    zh: '装箱备份的依赖记录必须是列表',
    es: 'Las dependencias de la copia de empaque deben ser una lista',
  },
  'Packing backup contains an invalid financial dependency': {
    zh: '装箱备份包含无效的财务来源依赖',
    es: 'La copia de empaque contiene una dependencia financiera no válida',
  },
  'Packing backup contains an unrelated or duplicate financial dependency': {
    zh: '装箱备份包含无关或重复的财务来源依赖',
    es: 'La copia de empaque contiene una dependencia financiera ajena o duplicada',
  },
  'Packing backup is missing a financial source dependency': {
    zh: '装箱备份缺少财务来源依赖记录',
    es: 'Falta una dependencia financiera original en la copia de empaque',
  },
  'Shared repeat purchases must have matching product features.': {
    zh: '共用编码的复购商品必须具有相同的商品特征。',
    es: 'Las compras repetidas compartidas deben coincidir en sus características de producto.',
  },
  'Unlink this repeat purchase before changing its product features.': {
    zh: '请先解除复购关联，再更改商品特征。',
    es: 'Desvincule esta compra repetida antes de cambiar sus características de producto.',
  },
  'Feature added cost': {
    zh: '特征附加费用',
    es: 'Coste añadido por características',
  },
  'Feature cost details': {
    zh: '特征费用明细',
    es: 'Detalle de costes por características',
  },
  'per piece': { zh: '每件', es: 'por pieza' },
  'Loading…': { zh: '正在加载…', es: 'Cargando…' },
  'Combined quantity': { zh: '合计数量', es: 'Cantidad combinada' },
  'Link repeat purchase': {
    zh: '关联复购商品',
    es: 'Vincular compra repetida',
  },
  'Unlink repeat purchase': {
    zh: '解除复购关联',
    es: 'Desvincular compra repetida',
  },
  'Linked repeat purchase': {
    zh: '已关联的复购商品',
    es: 'Compra repetida vinculada',
  },
  'Original product and code': {
    zh: '原商品与编码',
    es: 'Producto y código originales',
  },
  'Choose an existing product': {
    zh: '选择已有商品',
    es: 'Elegir un producto existente',
  },
  'Use the original codes': {
    zh: '使用原商品编码',
    es: 'Usar los códigos originales',
  },
  'Unlink and assign code': {
    zh: '解除关联并分配编码',
    es: 'Desvincular y asignar código',
  },
  'I checked the variants, sizes and features.': {
    zh: '我已核对款式、尺寸和特征。',
    es: 'He comprobado las variantes, tallas y características.',
  },
  'Combined label quantity: {0}': {
    zh: '标签合计数量：{0}',
    es: 'Cantidad total para etiquetas: {0}',
  },
  'Source row {0} · Quantity {1} · Unit price {2}': {
    zh: '来源行 {0} · 数量 {1} · 单价 {2}',
    es: 'Fila original {0} · Cantidad {1} · Precio unitario {2}',
  },
  'Choose the original product from this store and packing month. Review every source row, variant, size and feature before sharing its codes. Purchase prices and quantities stay separate.':
    {
      zh: '选择同一店铺、同一装箱月份的原商品。共用编码前，请逐项核对来源行、款式、尺寸和特征。各次采购的价格与数量分别保留。',
      es: 'Elija el producto original de esta tienda y mes de empaque. Revise cada fila, variante, talla y característica antes de compartir sus códigos. Los precios y cantidades de cada compra se conservan por separado.',
    },
  'This purchase will receive a different free product code. The other linked purchases keep their codes and source records.':
    {
      zh: '此次采购将分配另一个可用商品编码。其他已关联采购保留原编码和来源记录。',
      es: 'Esta compra recibirá otro código de producto disponible. Las demás compras vinculadas conservarán sus códigos y registros originales.',
    },
  'No matching complete product from this store and packing month is available. Prepare the original purchase and check its variants and sizes first.':
    {
      zh: '没有同一店铺、同一装箱月份且完全匹配的商品。请先准备原采购商品，并核对其款式和尺寸。',
      es: 'No hay un producto completo que coincida en esta tienda y mes de empaque. Prepare la compra original y compruebe primero sus variantes y tallas.',
    },
  'This product shares reviewed codes with another purchase. Click to review and unlink it.':
    {
      zh: '此商品经核对后与另一笔采购共用编码。点击可查看并解除关联。',
      es: 'Este producto comparte códigos revisados con otra compra. Haga clic para revisar y desvincularlo.',
    },
  'Link this complete product to a matching purchase from the same store and packing month. Review first; source orders and costs stay separate.':
    {
      zh: '将整个商品关联至同一店铺、同一装箱月份的匹配采购。先核对；来源订单和费用分别保留。',
      es: 'Vincule el producto completo con una compra coincidente de la misma tienda y mes de empaque. Revise primero; los pedidos y costes originales se conservan por separado.',
    },
  'Unlink this repeat purchase before changing its shared codes, variants, size handling or label names.':
    {
      zh: '请先解除复购关联，再更改共用编码、款式、尺寸处理或标签名称。',
      es: 'Desvincule esta compra repetida antes de cambiar sus códigos compartidos, variantes, tratamiento de tallas o nombres de etiquetas.',
    },
  'The repeat purchase product is no longer available. Reopen it and try again.':
    {
      zh: '该复购商品已不可用。请重新打开后重试。',
      es: 'El producto de la compra repetida ya no está disponible. Ábralo de nuevo e inténtelo otra vez.',
    },
  'Review the complete current product group before linking a repeat purchase.':
    {
      zh: '关联复购前，请核对完整的当前商品组。',
      es: 'Revise el grupo completo y actual antes de vincular una compra repetida.',
    },
  'Assign product codes and resolve every size before linking a repeat purchase.':
    {
      zh: '请先分配商品编码并处理所有尺寸，再关联复购。',
      es: 'Asigne los códigos y resuelva todas las tallas antes de vincular una compra repetida.',
    },
  'The complete products must have matching variants, sizes and features.': {
    zh: '完整商品的款式、尺寸和特征必须一致。',
    es: 'Los productos completos deben coincidir en variantes, tallas y características.',
  },
  'These variants are ambiguous. Review their source details before linking.': {
    zh: '这些款式无法明确匹配。关联前请核对来源明细。',
    es: 'Estas variantes son ambiguas. Revise sus datos originales antes de vincularlas.',
  },
  'Choose a product from another purchase order.': {
    zh: '请选择另一笔采购订单的商品。',
    es: 'Elija un producto de otro pedido de compra.',
  },
  'Repeat purchases must belong to the same known store and buyer account.': {
    zh: '复购必须属于同一已确认店铺和买家账户。',
    es: 'Las compras repetidas deben pertenecer a la misma tienda identificada y cuenta de comprador.',
  },
  'Repeat purchases must use the same packing month.': {
    zh: '复购必须使用同一装箱月份。',
    es: 'Las compras repetidas deben usar el mismo mes de empaque.',
  },
  'Unlink this repeat purchase before linking it to another product.': {
    zh: '关联到其他商品前，请先解除此复购关联。',
    es: 'Desvincule esta compra repetida antes de vincularla con otro producto.',
  },
  'This product is not linked to another purchase.': {
    zh: '此商品尚未关联其他采购。',
    es: 'Este producto no está vinculado con otra compra.',
  },
  'Review the repeat purchase changes before applying them.': {
    zh: '应用前请核对复购变更。',
    es: 'Revise los cambios de la compra repetida antes de aplicarlos.',
  },
  'Shared product identity does not match its source store.': {
    zh: '共用商品身份与来源店铺不符。',
    es: 'La identidad del producto compartido no coincide con su tienda original.',
  },
  'Shared product identity has inconsistent store, packing month or product codes':
    {
      zh: '共用商品身份的店铺、装箱月份或商品编码不一致',
      es: 'La identidad del producto compartido tiene una tienda, mes de empaque o códigos incoherentes',
    },
  'Shared variant identity has inconsistent barcode endings': {
    zh: '共用款式身份的条码后缀不一致',
    es: 'La identidad de variante compartida tiene sufijos de código de barras incoherentes',
  },
  'Shared code reservation does not match its current source members.': {
    zh: '共用编码预留与当前来源成员不符。',
    es: 'La reserva de código compartido no coincide con sus miembros originales actuales.',
  },
  'A purchase may contain only one group for each shared product identity.': {
    zh: '每笔采购对每个共用商品身份只能包含一个组。',
    es: 'Una compra solo puede contener un grupo por cada identidad de producto compartido.',
  },
  'Shared products require distinct, resolved shared variant identities.': {
    zh: '共用商品必须具有不同且已确认的共用款式身份。',
    es: 'Los productos compartidos requieren identidades de variante distintas y resueltas.',
  },
}
