export const CARTON_MESSAGES = {
  Reviewed: { zh: '已确认', es: 'Revisado' },
  'Carton count unknown. Enter the actual count manually.': {
    zh: '箱数未知，请手动输入实际箱数。',
    es: 'Cantidad de cajas desconocida. Indica la cantidad real manualmente.',
  },
  Unknown: { zh: '未知', es: 'Desconocido' },
  'Pcs/box': { zh: '每箱件数', es: 'Pzas/caja' },
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
  'Units packed inside one full carton. Leave blank if unknown. Saves automatically; leftovers need packing review. This does not change the ordered quantity.':
    {
      zh: '一个整箱内的商品件数。不确定时留空。自动保存；余量需要确认装箱方式。不会更改订购数量。',
      es: 'Unidades dentro de una caja completa. Déjalo vacío si no lo sabes. Se guarda automáticamente; los sobrantes requieren revisión. No cambia la cantidad pedida.',
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
