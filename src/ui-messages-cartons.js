export const CARTON_MESSAGES = {
  '{0} · {1}': { zh: '{0} · {1}', es: '{0} · {1}' },
  '{0} calculated cartons': {
    zh: '计算箱数：{0}',
    es: '{0} cajas calculadas',
  },
  '{0} full cartons + {1} loose units': {
    zh: '{0} 个整箱 + {1} 件散货',
    es: '{0} cajas completas + {1} unidades sueltas',
  },
  '{0} calculated cartons · {1} recorded cartons': {
    zh: '计算箱数：{0} · 已记录箱数：{1}',
    es: '{0} cajas calculadas · {1} cajas registradas',
  },
  '{0} recorded cartons': {
    zh: '已记录箱数：{0}',
    es: '{0} cajas registradas',
  },
  'Recorded cartons': { zh: '已记录纸箱', es: 'Cajas registradas' },
  'Pieces per full carton. Calculates cartons automatically; recorded cartons stay unchanged.':
    {
      zh: '每个整箱的件数。自动计算箱数，不更改已记录的纸箱。',
      es: 'Unidades por caja completa. Calcula las cajas sin cambiar las registradas.',
    },
  'Edit Pcs/box in Orders': {
    zh: '在订单中编辑每箱件数',
    es: 'Editar unidades por caja en Pedidos',
  },
  'Edit in Orders. Packing changes save first.': {
    zh: '前往订单编辑，先保存装箱更改。',
    es: 'Edita en Pedidos. Primero se guardan los cambios de empaque.',
  },
  'Source product unavailable in Orders.': {
    zh: '订单中已找不到原始商品。',
    es: 'Producto original no disponible en Pedidos.',
  },
  Planned: { zh: '计划', es: 'Previstas' },
  Loaded: { zh: '装柜', es: 'Cargadas' },
  'Received boxes': { zh: '实收箱数', es: 'Cajas recibidas' },
  'Loaded boxes': { zh: '装柜箱数', es: 'Cajas cargadas' },
  'Shared boxes': { zh: '共用箱数', es: 'Cajas compartidas' },
  'Confirmed boxes must be a nonnegative whole number': {
    zh: '确认箱数必须为非负整数',
    es: 'Las cajas confirmadas deben ser un número entero no negativo',
  },
  'Confirmed boxes received for this packing month. Blank means unknown; zero means none. Shared supplier rows are counted once. Saves automatically.':
    {
      zh: '本装箱月份确认收到的箱数。空白表示未知，0 表示没有。共用供应商行仅计一次。自动保存。',
      es: 'Cajas recibidas confirmadas para este mes de empaque. En blanco: desconocido; cero: ninguna. Las filas compartidas del proveedor se cuentan una vez. Se guarda automáticamente.',
    },
  'Confirmed boxes loaded into the container for this packing month. Blank means unknown; zero means none. Shared supplier rows are counted once. Saves automatically.':
    {
      zh: '本装箱月份确认装柜的箱数。空白表示未知，0 表示没有。共用供应商行仅计一次。自动保存。',
      es: 'Cajas cargadas en el contenedor para este mes de empaque. En blanco: desconocido; cero: ninguna. Las filas compartidas se cuentan una vez. Se guarda automáticamente.',
    },
  'These variants share one supplier row. Edit its carton counts once.': {
    zh: '这些规格共用一个供应商行，只需填写一次箱数。',
    es: 'Estas variantes comparten una fila del proveedor. Edita sus cajas una sola vez.',
  },
  'Include every variant of this supplier row in the same packing month to confirm its boxes.':
    {
      zh: '请将此供应商行的所有规格加入同一个装箱月份，再确认箱数。',
      es: 'Incluye todas las variantes de esta fila del proveedor en el mismo mes de empaque para confirmar sus cajas.',
    },
  'Preparing packing workbook…': {
    zh: '正在生成装箱 Excel…',
    es: 'Preparando el Excel de empaque…',
  },
  'Export every product in this packing list with photos, costs and planned, received and loaded boxes. Selection does not limit the export.':
    {
      zh: '导出本装箱单的所有商品，包含图片、费用和计划、实收、装柜箱数。勾选范围不影响导出。',
      es: 'Exporta todos los productos de esta lista con fotos, costos y cajas previstas, recibidas y cargadas. La selección no limita la exportación.',
    },
  Reviewed: { zh: '已确认', es: 'Revisado' },
  'Carton count unknown. Enter the actual count manually.': {
    zh: '箱数未知，请手动输入实际箱数。',
    es: 'Cantidad de cajas desconocida. Indica la cantidad real manualmente.',
  },
  Unknown: { zh: '未知', es: 'Desconocido' },
  'Pcs/box': { zh: '每箱件数', es: 'Pzas/caja' },
  '/box': { zh: '/箱', es: '/ctn' },
  'kg/box': { zh: '千克/箱', es: 'kg/caja' },
  'm³/box': { zh: '立方米/箱', es: 'm³/caja' },
  'Carton measurements changed in another tab. Reload before saving your edits.':
    {
      zh: '纸箱测量数据已在另一个标签页中更改。请重新加载后再保存编辑。',
      es: 'Las medidas de la caja cambiaron en otra pestaña. Recarga antes de guardar tus cambios.',
    },
  'Calculated from {0} × {1} × {2} cm. Editing CBM replaces these dimensions with the entered volume per carton.':
    {
      zh: '根据 {0} × {1} × {2} 厘米计算。编辑体积将以输入的每箱体积替换这些尺寸。',
      es: 'Calculado a partir de {0} × {1} × {2} cm. Editar el volumen sustituye estas dimensiones por el volumen indicado por caja.',
    },
  'Weight must be a nonnegative decimal in kg': {
    zh: '重量必须是大于或等于零的千克数值',
    es: 'El peso debe ser un decimal no negativo en kg',
  },
  'Volume must be a nonnegative decimal in m³': {
    zh: '体积必须是大于或等于零的立方米数值',
    es: 'El volumen debe ser un decimal no negativo en m³',
  },
  'Weight of one carton in kg. Leave blank if unknown. Decimals may use a dot or comma. Saves automatically.':
    {
      zh: '每箱重量，单位为千克。不确定时留空。小数可以使用点或逗号。自动保存。',
      es: 'Peso de una caja en kg. Déjalo vacío si no lo sabes. Los decimales admiten punto o coma. Se guarda automáticamente.',
    },
  'Volume of one carton in m³. Leave blank if unknown. Decimals may use a dot or comma. Saves automatically.':
    {
      zh: '每箱体积，单位为立方米。不确定时留空。小数可以使用点或逗号。自动保存。',
      es: 'Volumen de una caja en m³. Déjalo vacío si no lo sabes. Los decimales admiten punto o coma. Se guarda automáticamente.',
    },
  'Copy Pcs/box': {
    zh: '复制每箱件数',
    es: 'Copiar unidades por caja',
  },
  'Carton count unknown': {
    zh: '箱数未知',
    es: 'Cantidad de cajas desconocida',
  },
  'Pcs/box must be a positive whole number': {
    zh: '每箱件数必须为正整数',
    es: 'Las unidades por caja deben ser un número entero positivo',
  },
  '{0} full cartons': { zh: '{0} 个整箱', es: '{0} cajas completas' },
  '{0} full cartons + {1} loose units · Review packing': {
    zh: '{0} 个整箱 + {1} 件余量 · 请确认装箱',
    es: '{0} cajas completas + {1} unidades sueltas · Revisar empaque',
  },
  'Units per full carton. Blank: unknown. Saves automatically; review loose units.':
    {
      zh: '每个整箱的件数。留空表示未知，自动保存；余量需确认。',
      es: 'Unidades por caja completa. En blanco: desconocido. Guardado automático; revisa los sobrantes.',
    },
  'Pcs/box: {0} · {1}': {
    zh: '每箱件数：{0} · {1}',
    es: 'Pzas/caja: {0} · {1}',
  },
  'Carton count reviewed': { zh: '箱数已确认', es: 'Cantidad revisada' },
  'Carton count reviewed for {0}': {
    zh: '{0} 的箱数已确认',
    es: 'Cantidad de cajas revisada para {0}',
  },
  'Confirm the actual carton count, including any partial or mixed cartons. Loose units are never silently assigned to another box.':
    {
      zh: '确认实际箱数，包括零散箱或混装箱。系统不会自动将余量分配到其他箱子。',
      es: 'Confirma la cantidad real de cajas, incluidas las parciales o mixtas. Las unidades sueltas nunca se asignan automáticamente a otra caja.',
    },
  'Review loose units and enter the actual carton count. Confirm each affected product before exporting.':
    {
      zh: '请确认余量并输入实际箱数。导出前需确认每个受影响的商品。',
      es: 'Revisa las unidades sueltas e indica la cantidad real de cajas. Confirma cada producto afectado antes de exportar.',
    },
  'Calculated cartons: {0}': {
    zh: '计算箱数：{0}',
    es: 'Cajas calculadas: {0}',
  },
  '{0}: {1} cartons entered, {2} calculated from Pcs/box.': {
    zh: '{0}：输入了 {1} 箱，根据每箱件数计算为 {2} 箱。',
    es: '{0}: se indicaron {1} cajas; se calcularon {2} según las unidades por caja.',
  },
  'Copy size': { zh: '复制尺寸', es: 'Copiar tamaño' },
  'Copy price': { zh: '复制单价', es: 'Copiar precio' },
  'Copy quantity': { zh: '复制数量', es: 'Copiar cantidad' },
}
