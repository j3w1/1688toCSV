export const GROUPING_MESSAGES = {
  'Select a variant containing multiple source rows.': {
    zh: '请选择包含多个原始订单行的合并款式。',
    es: 'Selecciona una variante que contenga varias filas originales.',
  },
  'Select at least two product groups to merge.': {
    zh: '请至少选择两个商品组进行合并。',
    es: 'Selecciona al menos dos grupos de productos para unirlos.',
  },
  'These groups include products outside this packing selection. Select all their products in Orders before changing their grouping.':
    {
      zh: '这些组包含当前装箱范围外的商品。请先在订单页面选择各组的全部商品，再修改分组。',
      es: 'Estos grupos incluyen productos fuera de la selección de embalaje. Selecciona todos sus productos en Pedidos antes de cambiar su agrupación.',
    },
  'Groups from different packing months cannot be merged. Move the selected products to the same packing month first.':
    {
      zh: '不能合并不同装箱月份的组。请先将所选商品移到同一装箱月份。',
      es: 'No se pueden unir grupos de distintos meses de embalaje. Mueve primero los productos seleccionados al mismo mes.',
    },
  'Selection tools': { zh: '选择工具', es: 'Herramientas de selección' },
  Grouping: { zh: '分组', es: 'Agrupar' },
  'Selected product grouping': {
    zh: '所选商品分组',
    es: 'Agrupar productos seleccionados',
  },
  'Selected products': { zh: '所选商品', es: 'Productos seleccionados' },
  Backup: { zh: '备份', es: 'Respaldo' },
  'Share within groups': {
    zh: '组内共用条码',
    es: 'Compartir dentro de cada grupo',
  },
  'Separate barcodes': { zh: '拆分条码', es: 'Separar códigos de barras' },
  'Merge product groups': { zh: '合并商品组', es: 'Unir grupos de productos' },
  'Select products first.': {
    zh: '请先选择商品。',
    es: 'Selecciona productos primero.',
  },
  'Select at least two variants in a product group to share a barcode.': {
    zh: '请在同一商品组内选择至少两个款式以共用条码。',
    es: 'Selecciona al menos dos variantes dentro de un grupo para compartir un código de barras.',
  },
  'Select some, but not all, variants in each group to move them into new products.':
    {
      zh: '请在每组中选择部分款式，将其移到新的商品组。不要选择整组。',
      es: 'Selecciona solo parte de las variantes de cada grupo para moverlas a nuevos productos.',
    },
  'Merge groups from one order at a time. Groups from different orders cannot share a product code.':
    {
      zh: '每次只能合并一个订单内的商品组。不同订单不能共用商品代码。',
      es: 'Une grupos de un solo pedido a la vez. Los grupos de distintos pedidos no pueden compartir un código de producto.',
    },
  'Select every product in each group before merging product groups.': {
    zh: '合并商品组前，请选择各组的全部商品。',
    es: 'Selecciona todos los productos de cada grupo antes de unir los grupos.',
  },
  'Select every displayed packing product across all pages. Ctrl+A does the same outside text fields.':
    {
      zh: '选择当前装箱范围中所有页面的商品。在文本框外按 Ctrl+A 也可全选。',
      es: 'Selecciona los productos mostrados del embalaje en todas las páginas. Ctrl+A hace lo mismo fuera de los campos de texto.',
    },
  'Clear the packing selection without changing any products. Ctrl+D does the same outside text fields.':
    {
      zh: '取消装箱商品的选择，不修改商品。在文本框外按 Ctrl+D 也可取消选择。',
      es: 'Quita la selección sin modificar productos. Ctrl+D hace lo mismo fuera de los campos de texto.',
    },
  'Change grouping for selected products. Review affected photos and codes before applying. Orders are never merged together.':
    {
      zh: '更改所选商品的分组。应用前可查看受影响的图片和代码。不同订单始终保持独立。',
      es: 'Cambia la agrupación de los productos seleccionados. Revisa sus fotos y códigos antes de aplicar. Los pedidos nunca se unen.',
    },
  'Give the selected variants one barcode per product group. Groups with one selected variant stay unchanged; different groups and orders stay separate.':
    {
      zh: '每个商品组内的所选款式共用一个条码。仅选一个款式的组不变；不同商品组和订单保持独立。',
      es: 'Comparte un código de barras por grupo entre las variantes seleccionadas. Los grupos con una sola variante seleccionada no cambian; los grupos y pedidos permanecen separados.',
    },
  'Split every selected combined variant into one barcode per original source row, independently in each product group.':
    {
      zh: '将所选的合并款式按原始订单行拆分为独立条码，各商品组分别处理。',
      es: 'Separa cada variante combinada seleccionada en un código de barras por fila original, de forma independiente en cada grupo.',
    },
  'Move selected variants into a new product group within each source order. Select only part of each source group.':
    {
      zh: '将所选款式移到各原始订单内的新商品组。每个原组仅选择部分款式。',
      es: 'Mueve las variantes seleccionadas a un nuevo grupo dentro de su pedido original. Selecciona solo parte de cada grupo.',
    },
  'Merge complete selected product groups from one order and packing month. Their variants keep separate barcodes.':
    {
      zh: '合并同一订单和装箱月份中的完整所选商品组。各款式保留独立条码。',
      es: 'Une los grupos completos seleccionados de un mismo pedido y mes de embalaje. Sus variantes mantienen códigos de barras separados.',
    },
  'Selected variants share one barcode within each affected group. Different groups and orders remain separate. Original prices, quantities and previous code reservations are kept.':
    {
      zh: '每个受影响组中的所选款式共用一个条码。不同商品组和订单保持独立。保留原始价格、数量及旧代码的归属。',
      es: 'Las variantes seleccionadas comparten un código de barras dentro de cada grupo afectado. Los grupos y pedidos permanecen separados. Se conservan precios, cantidades y reservas de códigos anteriores.',
    },
  'Each selected combined variant becomes one barcode per original source row. New endings respect existing code reservations. Other variants stay unchanged.':
    {
      zh: '所选合并款式按原始订单行拆分为独立条码。新后缀避开已保留的代码。其他款式不变。',
      es: 'Cada variante combinada seleccionada recibe un código de barras por fila original. Los sufijos nuevos respetan los códigos reservados. Las demás variantes no cambian.',
    },
  'Selected variants move into a new product group within each source order. Unselected variants keep their product code. Old issued codes remain reserved.':
    {
      zh: '所选款式移到各原始订单内的新商品组。未选款式保留商品代码。旧代码仍保留原归属。',
      es: 'Las variantes seleccionadas pasan a un nuevo grupo dentro de su pedido original. Las variantes no seleccionadas conservan su código de producto. Los códigos anteriores siguen reservados.',
    },
  'Selected groups in this order share the first product code and carton mark. Barcode endings may change to stay unique. Old issued codes remain reserved.':
    {
      zh: '本订单的所选组共用第一个商品代码和唛头。条码后缀可能调整以保持唯一。旧代码仍保留原归属。',
      es: 'Los grupos seleccionados de este pedido comparten el primer código de producto y marca de caja. Los sufijos pueden cambiar para seguir siendo únicos. Los códigos anteriores siguen reservados.',
    },
}
