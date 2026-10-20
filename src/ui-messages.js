import { PACKING_MESSAGES } from './ui-messages-packing.js'
import { HELP_MESSAGES } from './ui-messages-help.js'
import { VALIDATION_MESSAGES } from './ui-messages-validation.js'
import { EXCEL_MESSAGES } from './ui-messages-excel.js'
import { MATERIAL_MESSAGES } from './ui-messages-materials.js'
import { COPY_ACTION_MESSAGES } from './ui-messages-copy-actions.js'
import { ERROR_MESSAGES } from './ui-messages-errors.js'
import { APPEARANCE_MESSAGES } from './ui-messages-appearance.js'
import { ACTIVITY_MESSAGES } from './ui-messages-activity.js'
import { ORDER_TAG_MESSAGES } from './ui-messages-order-tags.js'
import { ACTION_HELP_MESSAGES } from './ui-messages-action-help.js'
import { GROUPING_MESSAGES } from './ui-messages-grouping.js'
import { REVIEW_MESSAGES } from './ui-messages-review.js'
import { EXCLUSION_MESSAGES } from './ui-messages-exclusions.js'
import { SHELL_MESSAGES } from './ui-messages-shell.js'
import { PRINT_MESSAGES } from './ui-messages-print.js'

// Explicit interface messages only; original seller, product and label values are never translated.
export const UI_MESSAGES = {
  'The underline identifies the four-digit product number. CE and year/month stay together; code values are unchanged.':
    {
      zh: '下划线标出四位商品编号。CE 与年月保持相连；编码值不变。',
      es: 'El subrayado identifica el número de producto de cuatro cifras. CE y el año/mes permanecen unidos; el valor del código no cambia.',
    },
  'Shortcut outside text fields': {
    zh: '非文本输入时的快捷键',
    es: 'Atajo fuera de los campos de texto',
  },
  ...EXCLUSION_MESSAGES,
  ...SHELL_MESSAGES,
  ...PRINT_MESSAGES,
  ...REVIEW_MESSAGES,
  Sizes: { zh: '尺寸', es: 'Tallas' },
  'Size handling': { zh: '尺寸处理', es: 'Tratamiento de tallas' },
  'Automatic sizes': { zh: '自动识别尺寸', es: 'Tallas automáticas' },
  'No size difference': { zh: '无尺寸差异', es: 'Sin diferencia de talla' },
  'Change size handling?': {
    zh: '更改尺寸处理方式？',
    es: '¿Cambiar el tratamiento de tallas?',
  },
  'Apply size handling': {
    zh: '应用尺寸处理',
    es: 'Aplicar tratamiento de tallas',
  },
  'Restore default size handling': {
    zh: '恢复默认尺寸处理',
    es: 'Restaurar tratamiento de tallas',
  },
  '{0}–{1} of {2} products': {
    zh: '第 {0}–{1} 项，共 {2} 件商品',
    es: '{0}–{1} de {2} productos',
  },
  'These variants have no size difference. Remove only their size endings and keep their variant letters, source descriptions and other products unchanged. This choice is remembered for this product.':
    {
      zh: '这些款式没有尺寸差异。仅移除其尺寸后缀，保留款式字母、原始描述和其他商品。此设置将为该商品保存。',
      es: 'Estas variantes no tienen diferencia de talla. Se quitarán solo sus sufijos de talla; se conservarán las letras de variante, las descripciones originales y los demás productos. La elección se guardará para este producto.',
    },
  'Use automatic size recognition for this product again. Blank size endings will be checked against its source descriptions; unclear sizes remain for review.':
    {
      zh: '重新对此商品使用自动尺寸识别。将根据原始描述检查空白尺寸后缀；不明确的尺寸仍需确认。',
      es: 'Vuelve a reconocer las tallas automáticamente en este producto. Se comprobarán los sufijos vacíos con las descripciones originales; las tallas ambiguas quedarán pendientes de revisión.',
    },
  'Select all products in this group in Orders before changing its size handling.':
    {
      zh: '请先在订单中选择此组的全部商品，再更改尺寸处理方式。',
      es: 'Selecciona todos los productos de este grupo en Pedidos antes de cambiar sus tallas.',
    },
  'Use No size difference when the seller used a size field for colors or styles. Variant letters remain distinct; automatic size recognition stays active for other products. Entering a size ending switches this product back to Automatic sizes and keeps your typed ending.':
    {
      zh: '当卖家在尺寸字段中填写颜色或款式时，选择“无尺寸差异”。保留不同的款式字母；其他商品仍使用自动尺寸识别。输入尺寸后缀会将此商品切回“自动识别尺寸”，并保留您输入的后缀。',
      es: 'Usa Sin diferencia de talla cuando el vendedor escribió colores o estilos en el campo de talla. Las letras de variante seguirán siendo distintas y los demás productos mantendrán el reconocimiento automático. Al escribir un sufijo de talla, este producto vuelve a Tallas automáticas y conserva el sufijo que escribiste.',
    },
  ...GROUPING_MESSAGES,
  'Review size suggestions': {
    zh: '确认尺寸建议',
    es: 'Revisar tallas sugeridas',
  },
  'Apply these size codes': {
    zh: '应用这些尺寸代码',
    es: 'Aplicar estas tallas',
  },
  'Unit price ¥{price} · Suggested size {size}': {
    zh: '单价 ¥{price} · 建议尺寸 {size}',
    es: 'Precio unitario ¥{price} · Talla sugerida {size}',
  },
  'Price is only a clue. These matching variants have no reliable measurements. Confirm that the cheaper one is smaller (S) and the more expensive one is larger (L). Only the two size endings shown below will change.':
    {
      zh: '价格仅供参考。这两个相似款式没有可靠的尺寸数据。请确认价格较低的是小号（S），价格较高的是大号（L）。仅修改下方显示的两个尺寸后缀。',
      es: 'El precio es solo una pista. Estas variantes similares no tienen medidas fiables. Confirma que la más barata es pequeña (S) y la más cara es grande (L). Solo cambiarán los dos sufijos de talla mostrados.',
    },
  'Compare the two prices and photos before assigning S and L. Price alone does not prove size.':
    {
      zh: '分配 S 和 L 前，请比较两个价格和图片。价格本身不能确定尺寸。',
      es: 'Compara ambos precios y fotos antes de asignar S y L. El precio por sí solo no demuestra el tamaño.',
    },
  'Search suggestions': { zh: '搜索建议', es: 'Sugerencias de búsqueda' },
  ...APPEARANCE_MESSAGES,
  ...ACTIVITY_MESSAGES,
  ...ORDER_TAG_MESSAGES,
  'Open order {0} in a new tab': {
    zh: '在新标签页打开订单 {0}',
    es: 'Abrir pedido {0} en otra pestaña',
  },
  'Open this order on 1688 in a new tab.': {
    zh: '在新标签页打开此订单的 1688 详情。',
    es: 'Abre este pedido de 1688 en otra pestaña.',
  },
  'Original product details': { zh: '商品原始详情', es: 'Detalles originales' },
  'Close product details': { zh: '关闭商品详情', es: 'Cerrar detalles' },
  'Copy description': { zh: '复制描述', es: 'Copiar descripción' },
  'Order details': { zh: '订单详情', es: 'Detalles del pedido' },
  'Open product photo': { zh: '打开商品图片', es: 'Abrir foto' },
  'Product photo unavailable': {
    zh: '商品图片暂不可用',
    es: 'Foto no disponible',
  },
  'Original description': { zh: '原始描述', es: 'Descripción original' },
  'Copy original title': { zh: '复制原始标题', es: 'Copiar título original' },
  'Copy original value': { zh: '复制原始内容', es: 'Copiar valor original' },
  'Copy value': { zh: '复制内容', es: 'Copiar valor' },
  'Click to copy this value.': {
    zh: '点击复制此内容。',
    es: 'Haz clic para copiar este valor.',
  },
  'Double-click for original product details. Click an attribute value to copy it.':
    {
      zh: '双击查看商品原始详情。点击属性内容即可复制。',
      es: 'Haz doble clic para ver los detalles originales. Haz clic en un valor para copiarlo.',
    },
  ...PACKING_MESSAGES,
  ...HELP_MESSAGES,
  ...VALIDATION_MESSAGES,
  ...EXCEL_MESSAGES,
  ...MATERIAL_MESSAGES,
  ...COPY_ACTION_MESSAGES,
  ...ERROR_MESSAGES,
  ...ACTION_HELP_MESSAGES,
  'Selected product totals': {
    zh: '所选商品合计',
    es: 'Totales de productos seleccionados',
  },
  'Selected rows': { zh: '所选行数', es: 'Filas seleccionadas' },
  'Price × quantity': { zh: '单价 × 数量', es: 'Precio × cantidad' },
  'After row discounts': { zh: '行优惠后金额', es: 'Tras descuentos por fila' },
  'Filtered products: {rows} rows · Quantity {quantity}': {
    zh: '筛选商品：{rows} 行 · 数量 {quantity}',
    es: 'Productos filtrados: {rows} filas · Cantidad {quantity}',
  },
  'Complete matching orders: Quantity {quantity}': {
    zh: '匹配的完整订单：数量 {quantity}',
    es: 'Pedidos completos coincidentes: Cantidad {quantity}',
  },
  'Only selected product rows are summed, across all filtered pages. After row discounts uses the saved Discount column, including already allocated seller adjustments. Shipping and other order-wide charges are not added or divided. This is not the order payable total.':
    {
      zh: '仅合计所有筛选页面中选中的商品行。行优惠后金额使用已保存的“优惠”列，包括已分摊的卖家改价。不添加或分摊运费及其他订单级费用。此金额不是订单实付款。',
      es: 'Solo se suman las filas seleccionadas de todas las páginas filtradas. El importe tras descuentos usa la columna Descuento guardada, incluidos los ajustes del vendedor ya repartidos. No se añaden ni reparten el envío ni otros cargos del pedido. No es el total a pagar del pedido.',
    },
  'Previous photo': { zh: '上一张图片', es: 'Foto anterior' },
  'Next photo': { zh: '下一张图片', es: 'Foto siguiente' },
  'Photo {position} of {total}': {
    zh: '第 {position} 张，共 {total} 张',
    es: 'Foto {position} de {total}',
  },
  '← / → photos · ↑ / ↓ or + / − zoom · Scroll to zoom · Drag to move · Double-click to zoom or fit · 0 fits':
    {
      zh: '← / → 切换图片 · ↑ / ↓ 或 + / − 缩放 · 滚轮缩放 · 拖动移动 · 双击缩放或适应 · 0 适应窗口',
      es: '← / → fotos · ↑ / ↓ o + / − amplía o reduce · Rueda para ampliar · Arrastra para mover · Doble clic para ampliar o ajustar · 0 ajusta',
    },
  '{0} products from {1} orders will reopen. {2} orders can receive selected packing edits from this file. Unselected products, newer local edits and existing settings stay unchanged. Source orders and current code assignments are included; restoration checks for current code conflicts.':
    {
      zh: '将重新打开 {1} 个订单中的 {0} 件商品。其中 {2} 个订单可恢复此文件中所选商品的装箱修改。未选商品、较新的本地修改和现有设置保持不变。文件包含原始订单和当前货号分配；恢复时会检查当前货号是否冲突。',
      es: 'Se reabrirán {0} productos de {1} pedidos. {2} pedidos pueden recibir los cambios de empaque seleccionados de este archivo. Los productos no seleccionados, los cambios locales más recientes y los ajustes actuales se mantienen. Se incluyen los pedidos originales y las asignaciones actuales de códigos; al restaurar se comprueba si hay conflictos con códigos en uso.',
    },
  '{rows} selected product rows from {orders} orders will be prepared for {month}. {detail}':
    {
      zh: '将为 {month} 准备来自 {orders} 个订单的 {rows} 行所选商品。{detail}',
      es: 'Se prepararán {rows} filas seleccionadas de {orders} pedidos para {month}. {detail}',
    },
  '{codes} group codes and their barcodes will change. {splits} partial groups will be split; unselected products keep their month and codes. Codes no longer in use become available. You can restore the previous packing later if its codes are available.':
    {
      zh: '将更改 {codes} 个组货号及其条码。{splits} 个部分选中的组将被拆分；未选商品保留原月份和货号。不再使用的货号将可重新分配。若原货号仍可用，您可以稍后恢复上次装箱设置。',
      es: 'Cambiarán {codes} códigos de grupo y sus códigos de barras. Se dividirán {splits} grupos parcialmente seleccionados; los productos no seleccionados conservan su mes y códigos. Los códigos que dejen de usarse quedarán disponibles. Podrás restaurar el empaque anterior si sus códigos siguen disponibles.',
    },
  'New codes will be assigned to the groups below. Orders without a seller remain editable and receive codes after you identify the seller.':
    {
      zh: '将为以下组分配新货号。缺少卖家信息的订单仍可编辑，确认卖家后再分配货号。',
      es: 'Se asignarán nuevos códigos a los grupos de abajo. Los pedidos sin vendedor siguen siendo editables y recibirán códigos cuando identifiques al vendedor.',
    },
  'Position {before} → {after}': {
    zh: '位置 {before} → {after}',
    es: 'Posición {before} → {after}',
  },
  'Restore original product order': {
    zh: '恢复商品原始顺序',
    es: 'Restaurar el orden original de productos',
  },
  'Restore original grouping': {
    zh: '恢复原始分组',
    es: 'Restaurar los grupos originales',
  },
  'Clear manual sorting': { zh: '清除手动排序', es: 'Quitar el orden manual' },
  'Removed from packing': { zh: '已从装箱清单移除', es: 'Quitado del empaque' },
  'Packing backup saved': {
    zh: '装箱备份已保存',
    es: 'Copia de empaque guardada',
  },
  'Back up every group and product in this preparation, including other pages and orders. Selection does not limit the backup; removed products and unrelated library data are excluded.':
    {
      zh: '备份本次备货中的所有商品组和商品，包括其他页面和订单。勾选范围不限制备份；已移除商品及无关订单库数据不包含在内。',
      es: 'Respalda todos los grupos y productos de esta preparación, incluidas las demás páginas y pedidos. La selección no limita la copia; se excluyen los productos retirados y los datos ajenos de la biblioteca.',
    },
  'Load a packing backup from Orders and open its saved groups in Preparation. Unrelated library data stays unchanged; newer local edits are kept.':
    {
      zh: '从订单页载入装箱备份，并在备货表中打开其中保存的商品组。无关订单库数据不变，并保留本地较新的修改。',
      es: 'Carga una copia de empaque desde Pedidos y abre sus grupos guardados en Preparación. Los datos ajenos de la biblioteca no cambian; se conservan las modificaciones locales más recientes.',
    },
  '{count} product groups in this order will share {code}. Their barcode endings may change to remain unique. Codes no longer in use become available.':
    {
      zh: '此订单中的 {count} 个商品组将共用 {code}。条码后缀可能更改以避免重复。不再使用的货号将可重新分配。',
      es: '{count} grupos de este pedido compartirán {code}. Las terminaciones de los códigos de barras pueden cambiar para evitar duplicados. Los códigos que dejen de usarse quedarán disponibles.',
    },
  'Remove this group’s displayed products from packing and discard their preparation edits from this session. Original order data is kept.':
    {
      zh: '从装箱清单移除此组当前显示的商品，并放弃这些商品在本次会话中的装箱修改。保留原始订单数据。',
      es: 'Quita del empaque los productos mostrados de este grupo y descarta sus cambios de preparación de esta sesión. Se conservan los datos del pedido original.',
    },
  'Remove this product from packing and discard its preparation edits from this session. Original order data is kept.':
    {
      zh: '从装箱清单移除此商品，并放弃它在本次会话中的装箱修改。保留原始订单数据。',
      es: 'Quita este producto del empaque y descarta sus cambios de preparación de esta sesión. Se conservan los datos del pedido original.',
    },
  '{count} selected variants will use {code}. Their original prices and quantities remain separate. Codes no longer in use become available.':
    {
      zh: '{count} 个所选款式将使用 {code}。原始价格和数量仍分开保存。不再使用的货号将可重新分配。',
      es: '{count} variantes seleccionadas usarán {code}. Sus precios y cantidades originales se mantienen separados. Los códigos que dejen de usarse quedarán disponibles.',
    },
  '{count} combined variants will be split into one barcode per original order row. New endings avoid codes currently used by other products.':
    {
      zh: '将拆分 {count} 个合并款式，每行原始商品使用独立条码。新后缀将避开其他商品当前使用的货号。',
      es: 'Se dividirán {count} variantes combinadas en un código de barras por fila original del pedido. Los nuevos sufijos evitan códigos que otros productos usan actualmente.',
    },
  '{count} variants will receive a new shared product code. The other variants keep {code}. Codes no longer in use become available.':
    {
      zh: '{count} 个款式将共用一个新商品货号。其他款式保留 {code}。不再使用的货号将可重新分配。',
      es: '{count} variantes recibirán un nuevo código de producto compartido. Las demás conservan {code}. Los códigos que dejen de usarse quedarán disponibles.',
    },
  Copy: { zh: '复制', es: 'Copiar' },
  Columns: { zh: '列', es: 'Columnas' },
  'Group codes': { zh: '组货号', es: 'Códigos de grupo' },
  'Excel image': { zh: 'Excel图片', es: 'Imagen de Excel' },
  Barcodes: { zh: '条码', es: 'Códigos de barras' },
  'Carton marks': { zh: '唛头', es: 'Marcas de caja' },
  'Remove group': { zh: '移除组', es: 'Quitar grupo' },
  'Remove product': { zh: '移除商品', es: 'Quitar producto' },
  'Remove from packing?': {
    zh: '从装箱清单中移除？',
    es: '¿Quitar del empaque?',
  },
  'Remove from packing': { zh: '从装箱清单中移除', es: 'Quitar del empaque' },
  '{count} selected products will leave this packing and their preparation edits from this session will be discarded. Previously prepared products return to their earlier values; newly prepared products become unassigned. Original order data is kept.':
    {
      zh: '{count} 件所选商品将离开此装箱清单，并放弃本次会话中的装箱修改。此前已准备的商品恢复原值；本次新准备的商品恢复为未分配。原始订单数据保留。',
      es: '{count} productos seleccionados saldrán de este empaque y se descartarán sus cambios de preparación de esta sesión. Los productos preparados anteriormente recuperan sus valores previos; los recién preparados quedan sin asignar. Se conservan los datos del pedido original.',
    },
  'Resolve code': {
    zh: '解决货号冲突',
    es: 'Resolver código',
  },
  '{count} products share this carton mark. Changing its code also changes the start of every barcode below. The Chinese category changes for the whole group.':
    {
      zh: '{count} 件商品共用此唛头。更改货号也会更改下方所有条码的开头。中文品类将应用于整组。',
      es: '{count} productos comparten esta marca de caja. Cambiar su código también cambia el inicio de todos los códigos de barras de abajo. La categoría china cambia para todo el grupo.',
    },
  '{0} product rows · {1} variants': {
    zh: '{0} 行商品 · {1} 个款式',
    es: '{0} filas de productos · {1} variantes',
  },
  'Move selected products to this packing month?': {
    zh: '将所选商品移至此装箱月份？',
    es: '¿Mover los productos seleccionados a este mes de empaque?',
  },
  'Assign product codes?': {
    zh: '分配商品货号？',
    es: '¿Asignar códigos de producto?',
  },
  'Change codes and prepare': {
    zh: '更改货号并准备装箱',
    es: 'Cambiar códigos y preparar',
  },
  'Assign codes and prepare': {
    zh: '分配货号并准备装箱',
    es: 'Asignar códigos y preparar',
  },
  'Restore previous packing?': {
    zh: '恢复上次装箱设置？',
    es: '¿Restaurar el empaque anterior?',
  },
  'Reset order and codes?': {
    zh: '重置排序和货号？',
    es: '¿Restablecer orden y códigos?',
  },
  'This replaces this order’s current grouping, codes, names and variant settings with the setup saved before its last month move. Later edits will be lost. Other orders are unchanged. Restoration checks for codes currently used by other products.':
    {
      zh: '此操作会用上次更改装箱月份前的设置替换本订单当前的分组、货号、名称及款式设置。此后的修改将丢失。其他订单不变。恢复时会检查货号是否已被其他商品使用。',
      es: 'Sustituye los grupos, códigos, nombres y ajustes de variantes de este pedido por la configuración guardada antes de su último cambio de mes. Se perderán los cambios posteriores. Los demás pedidos no cambian. Al restaurar se comprueba si otros productos usan esos códigos.',
    },
  'This restores this order’s default grouping, source order, product codes and barcode endings. Current names are retained where their groups still exist. Manual reordering and code edits will be replaced. Other orders are unchanged.':
    {
      zh: '恢复本订单的默认分组、原始顺序、商品货号及条码后缀。仍存在的分组保留当前名称。手动排序及货号修改将被替换。其他订单不变。',
      es: 'Restaura los grupos, el orden original, los códigos de producto y las terminaciones de barras predeterminados de este pedido. Se conservan los nombres de los grupos que aún existen. Se reemplazan los cambios manuales de orden y códigos. Los demás pedidos no cambian.',
    },
  'All {0} orders': {
    zh: '全部 {0} 个订单',
    es: 'Los {0} pedidos',
  },
  'Current saved data': {
    zh: '当前已保存数据',
    es: 'Datos guardados actuales',
  },
  'Keep newer edits': {
    zh: '保留较新的修改',
    es: 'Conservar cambios más recientes',
  },
  '{0} selected products': {
    zh: '已选 {0} 件商品',
    es: '{0} productos seleccionados',
  },
  'Restore packing backup?': {
    zh: '恢复装箱备份？',
    es: '¿Restaurar copia de empaque?',
  },
  '{0} products from {1} orders will reopen. {2} orders can receive saved packing edits from this file. This merges the complete included orders, label settings and local rules; newer local edits and existing notes are kept. Restoration checks for current code conflicts.':
    {
      zh: '将重新打开 {1} 个订单中的 {0} 件商品，其中 {2} 个订单可恢复此文件中的装箱修改。此操作会合并所包含的完整订单、标签设置及本地规则，保留较新的本地修改和现有备注。恢复时会检查当前货号是否冲突。',
      es: 'Se reabrirán {0} productos de {1} pedidos. {2} pedidos pueden recibir los cambios de empaque guardados en este archivo. Se combinan los pedidos completos incluidos, los ajustes de etiquetas y las reglas locales; se conservan los cambios locales más recientes y las notas existentes. Al restaurar se comprueba si hay conflictos con códigos en uso.',
    },
  'Seller unavailable': {
    zh: '卖家信息不可用',
    es: 'Vendedor no disponible',
  },
  'Copy store name': {
    zh: '复制店铺名称',
    es: 'Copiar nombre de tienda',
  },
  'Copy text': {
    zh: '复制文字',
    es: 'Copiar texto',
  },
  'Click to copy the order number.': {
    zh: '点击复制订单号。',
    es: 'Haz clic para copiar el número de pedido.',
  },
  'Click to copy the store name.': {
    zh: '点击复制店铺名称。',
    es: 'Haz clic para copiar el nombre de la tienda.',
  },
  'Could not copy. Try again.': {
    zh: '无法复制，请重试。',
    es: 'No se pudo copiar. Inténtalo de nuevo.',
  },
  'This order changed during a refresh. Updated does not describe its delivery status.':
    {
      zh: '此订单在刷新时发生了变化。“已更新”并非物流状态。',
      es: 'Este pedido cambió durante una actualización. Actualizado no indica su estado de entrega.',
    },
  'Saved in this browser. Saved does not describe its delivery status.': {
    zh: '已保存在此浏览器。“已保存”并非物流状态。',
    es: 'Guardado en este navegador. Guardado no indica su estado de entrega.',
  },
  'group {0}': {
    zh: '第 {0} 组',
    es: 'grupo {0}',
  },
  'product {0}': {
    zh: '第 {0} 件商品',
    es: 'producto {0}',
  },
  'Printed on every barcode label.': {
    zh: '打印在所有条码标签上。',
    es: 'Se imprime en cada etiqueta de código de barras.',
  },
  'Destination printed on every barcode label.': {
    zh: '打印在所有条码标签上的目的地。',
    es: 'Destino impreso en cada etiqueta de código de barras.',
  },
  'Image detail for copying and printing. 300 DPI is the default; physical dimensions stay the same.':
    {
      zh: '复制和打印图像的清晰度。默认为 300 DPI，实际尺寸不变。',
      es: 'Detalle de la imagen para copiar e imprimir. El valor predeterminado es 300 DPI; las dimensiones físicas no cambian.',
    },
  '{0} {1} in millimetres. Saved images carry this physical size.': {
    zh: '{0}的{1}，单位为毫米。保存的图像采用此实际尺寸。',
    es: '{1} de {0} en milímetros. Las imágenes guardadas llevan este tamaño físico.',
  },
  'Resize label text from 75% to 125%. The layout and barcode bars keep their proportions.':
    {
      zh: '将标签文字调整为 75% 至 125%。布局与条码线条比例保持不变。',
      es: 'Ajusta el texto de la etiqueta entre 75% y 125%. La distribución y las barras conservan sus proporciones.',
    },
  width: {
    zh: '宽度',
    es: 'ancho',
  },
  height: {
    zh: '高度',
    es: 'alto',
  },
  '{0} {1}': {
    zh: '{0} {1}',
    es: '{0} {1}',
  },
  Cancelled: { zh: '已取消', es: 'Cancelado' },
  '1688 Packing workspace': {
    zh: '1688 装箱工作台',
    es: '1688 · Espacio de empaque',
  },
  'Orders · packing · Excel': {
    zh: '订单 · 装箱 · Excel',
    es: 'Pedidos · empaque · Excel',
  },
  'Stored in this browser': {
    zh: '保存在此浏览器',
    es: 'Guardado en este navegador',
  },
  'Interface language': {
    zh: '界面语言',
    es: 'Idioma de la interfaz',
  },
  English: {
    zh: '英语',
    es: 'Inglés',
  },
  Chinese: {
    zh: '中文',
    es: 'Chino',
  },
  Spanish: {
    zh: '西班牙语',
    es: 'Español',
  },
  Activity: {
    zh: '动态',
    es: 'Actividad',
  },
  Settings: {
    zh: '设置',
    es: 'Ajustes',
  },
  'Switch to dark theme': {
    zh: '切换深色模式',
    es: 'Cambiar a tema oscuro',
  },
  'Switch to light theme': {
    zh: '切换浅色模式',
    es: 'Cambiar a tema claro',
  },
  'Library overview': {
    zh: '订单库概览',
    es: 'Resumen de pedidos',
  },
  Orders: {
    zh: '订单',
    es: 'Pedidos',
  },
  'Product rows': {
    zh: '商品行',
    es: 'Filas de productos',
  },
  'Updated orders': {
    zh: '已更新订单',
    es: 'Pedidos actualizados',
  },
  'Last checked': {
    zh: '上次检查',
    es: 'Última revisión',
  },
  'Open 1688 orders': {
    zh: '打开 1688 订单',
    es: 'Abrir pedidos de 1688',
  },
  'Orders processed': {
    zh: '已处理订单',
    es: 'Pedidos procesados',
  },
  Pause: {
    zh: '暂停',
    es: 'Pausar',
  },
  'Saved orders': {
    zh: '已保存订单',
    es: 'Pedidos guardados',
  },
  'Show all': {
    zh: '显示全部',
    es: 'Mostrar todos',
  },
  'Search orders': {
    zh: '搜索订单',
    es: 'Buscar pedidos',
  },
  'Seller or order number…': {
    zh: '店铺或订单号…',
    es: 'Tienda o número de pedido…',
  },
  'All purchase months': {
    zh: '全部购买月份',
    es: 'Todos los meses de compra',
  },
  'All months': {
    zh: '全部月份',
    es: 'Todos los meses',
  },
  'Filter months. Shift-click for a range.': {
    zh: '按月份筛选。按住 Shift 点击可选范围。',
    es: 'Filtra meses. Mayús + clic selecciona un rango.',
  },
  'Purchase months': {
    zh: '购买月份',
    es: 'Meses de compra',
  },
  'Purchase date range': {
    zh: '购买日期范围',
    es: 'Rango de fechas de compra',
  },
  From: {
    zh: '从',
    es: 'Desde',
  },
  Through: {
    zh: '至',
    es: 'Hasta',
  },
  'Refresh orders': {
    zh: '刷新订单',
    es: 'Actualizar pedidos',
  },
  'Previous order page': {
    zh: '上一页订单',
    es: 'Página anterior de pedidos',
  },
  'Next order page': {
    zh: '下一页订单',
    es: 'Página siguiente de pedidos',
  },
  'Remove selected': {
    zh: '删除所选',
    es: 'Eliminar selección',
  },
  'Order spreadsheet': {
    zh: '订单表格',
    es: 'Tabla de pedidos',
  },
  'All products': {
    zh: '全部商品',
    es: 'Todos los productos',
  },
  '0 rows': {
    zh: '0 行',
    es: '0 filas',
  },
  'Packing month': {
    zh: '装箱月份',
    es: 'Mes de empaque',
  },
  'Prepare packing list': {
    zh: '准备装箱清单',
    es: 'Preparar lista de empaque',
  },
  'Search products and orders': {
    zh: '搜索商品和订单',
    es: 'Buscar productos y pedidos',
  },
  'Search products, sellers or codes…': {
    zh: '搜索商品、店铺或货号…',
    es: 'Buscar productos, tiendas o códigos…',
  },
  'Order status': {
    zh: '订单状态',
    es: 'Estado del pedido',
  },
  'All statuses': {
    zh: '全部状态',
    es: 'Todos los estados',
  },
  'Changed only': {
    zh: '仅显示有变化的',
    es: 'Solo cambios',
  },
  'Copy selected product rows': {
    zh: '复制所选商品行',
    es: 'Copiar filas seleccionadas',
  },
  Products: {
    zh: '商品',
    es: 'Productos',
  },
  'Copy values': {
    zh: '复制数据',
    es: 'Copiar valores',
  },
  'Copy images': {
    zh: '复制图片',
    es: 'Copiar imágenes',
  },
  'Copy to Excel': {
    zh: '复制到 Excel',
    es: 'Copiar a Excel',
  },
  'Copy selected rows as one picture with Chinese headings': {
    zh: '将所选行复制为带中文表头的图片',
    es: 'Copiar filas como imagen con encabezados chinos',
  },
  'Copy Excel image': {
    zh: '复制 Excel 图片',
    es: 'Copiar imagen de Excel',
  },
  'Copy packing values': {
    zh: '复制装箱数据',
    es: 'Copiar datos de empaque',
  },
  Packing: {
    zh: '装箱',
    es: 'Empaque',
  },
  'Copy preparation columns': {
    zh: '复制装箱列',
    es: 'Copiar columnas de empaque',
  },
  'Copy group codes': {
    zh: '复制商品组货号',
    es: 'Copiar códigos de grupos',
  },
  Headers: {
    zh: '表头',
    es: 'Encabezados',
  },
  'Your orders belong here.': {
    zh: '在这里管理您的订单。',
    es: 'Tus pedidos aparecerán aquí.',
  },
  'Open your 1688 order list, select a few orders and choose': {
    zh: '打开 1688 订单列表，选择订单，然后点击',
    es: 'Abre tus pedidos de 1688, selecciona algunos y elige',
  },
  'Import selected': {
    zh: '导入所选',
    es: 'Importar selección',
  },
  'Scrollable product rows': {
    zh: '可滚动商品列表',
    es: 'Filas de productos desplazables',
  },
  Photo: {
    zh: '图片',
    es: 'Foto',
  },
  'Description & labels': {
    zh: '描述与标签',
    es: 'Descripción y etiquetas',
  },
  Price: {
    zh: '价格',
    es: 'Precio',
  },
  Quantity: {
    zh: '数量',
    es: 'Cantidad',
  },
  Discount: {
    zh: '优惠',
    es: 'Descuento',
  },
  'Select all rows': {
    zh: '选择全部行',
    es: 'Seleccionar todas las filas',
  },
  'Clear selection': {
    zh: '清除选择',
    es: 'Quitar selección',
  },
  'Previous product page': {
    zh: '上一页商品',
    es: 'Página anterior de productos',
  },
  'Next product page': {
    zh: '下一页商品',
    es: 'Página siguiente de productos',
  },
  'Page 1': {
    zh: '第 1 页',
    es: 'Página 1',
  },
  'Matching order totals': {
    zh: '匹配订单合计',
    es: 'Totales de pedidos coincidentes',
  },
  'Close activity': {
    zh: '关闭动态',
    es: 'Cerrar actividad',
  },
  'Import progress': {
    zh: '导入进度',
    es: 'Progreso de importación',
  },
  'No imports yet.': {
    zh: '尚无导入记录。',
    es: 'Aún no hay importaciones.',
  },
  'Label editor': {
    zh: '标签编辑器',
    es: 'Editor de etiquetas',
  },
  'Close label editor': {
    zh: '关闭标签编辑器',
    es: 'Cerrar editor de etiquetas',
  },
  'Close settings': {
    zh: '关闭设置',
    es: 'Cerrar ajustes',
  },
  'Library data': {
    zh: '订单库数据',
    es: 'Datos de pedidos',
  },
  'Keep a backup before clearing this browser or moving computers.': {
    zh: '清理浏览器或更换电脑前，请先备份。',
    es: 'Guarda una copia antes de limpiar el navegador o cambiar de equipo.',
  },
  'Back up': {
    zh: '备份',
    es: 'Crear copia',
  },
  Restore: {
    zh: '恢复',
    es: 'Restaurar',
  },
  'Refresh entire library': {
    zh: '刷新全部订单',
    es: 'Actualizar todos los pedidos',
  },
  'For an occasional full update. Use the Orders panel for individual orders or months.':
    {
      zh: '需要时更新全部订单。单个订单或月份请在订单面板刷新。',
      es: 'Para una actualización completa ocasional. Usa Pedidos para actualizar pedidos o meses concretos.',
    },
  'Refresh all orders': {
    zh: '刷新全部订单',
    es: 'Actualizar todos los pedidos',
  },
  'Close order details': {
    zh: '关闭订单详情',
    es: 'Cerrar detalles del pedido',
  },
  Cancel: {
    zh: '取消',
    es: 'Cancelar',
  },
  'Cancel image': {
    zh: '取消图片',
    es: 'Cancelar imagen',
  },
  Close: {
    zh: '关闭',
    es: 'Cerrar',
  },
  Done: { zh: '完成', es: 'Listo' },
  Retry: { zh: '重试', es: 'Reintentar' },
  Next: {
    zh: '下一页',
    es: 'Siguiente',
  },
  Previous: {
    zh: '上一页',
    es: 'Anterior',
  },
  'Confirm operation': {
    zh: '确认操作',
    es: 'Confirmar operación',
  },
  'Confirm bulk import': {
    zh: '确认批量导入',
    es: 'Confirmar importación masiva',
  },
  'Copying…': {
    zh: '正在复制…',
    es: 'Copiando…',
  },
  Copied: {
    zh: '已复制',
    es: 'Copiado',
  },
  'Try again': {
    zh: '重试',
    es: 'Reintentar',
  },
  'Copy image': {
    zh: '复制图片',
    es: 'Copiar imagen',
  },
  'Copy label': {
    zh: '复制标签',
    es: 'Copiar etiqueta',
  },
  'Copy order number': {
    zh: '复制订单号',
    es: 'Copiar número de pedido',
  },
  'Copy the complete order number.': {
    zh: '复制完整订单号。',
    es: 'Copia el número completo del pedido.',
  },
  'Copy this batch': {
    zh: '复制此批次',
    es: 'Copiar este lote',
  },
  Dismiss: {
    zh: '隐藏',
    es: 'Ocultar',
  },
  'Dismiss all': {
    zh: '全部隐藏',
    es: 'Ocultar todo',
  },
  'Dismiss notification': {
    zh: '关闭通知',
    es: 'Cerrar aviso',
  },
  Imports: {
    zh: '导入任务',
    es: 'Importaciones',
  },
  'Hide dismissed': {
    zh: '隐藏已忽略',
    es: 'Ocultar descartados',
  },
  'Show dismissed': {
    zh: '显示已忽略',
    es: 'Mostrar descartados',
  },
  'Save import report': {
    zh: '保存导入报告',
    es: 'Guardar informe de importación',
  },
  'Resume / retry': {
    zh: '继续 / 重试',
    es: 'Continuar / reintentar',
  },
  'Pausing…': {
    zh: '正在暂停…',
    es: 'Pausando…',
  },
  'Resuming…': {
    zh: '正在继续…',
    es: 'Reanudando…',
  },
  'Pausing import…': {
    zh: '正在暂停导入…',
    es: 'Pausando importación…',
  },
  'Save notes': {
    zh: '保存备注',
    es: 'Guardar notas',
  },
  'Your notes': {
    zh: '您的备注',
    es: 'Tus notas',
  },
  'Tags (comma separated)': {
    zh: '标签（用逗号分隔）',
    es: 'Etiquetas (separadas por comas)',
  },
  'Previous versions': {
    zh: '历史版本',
    es: 'Versiones anteriores',
  },
  Updated: {
    zh: '已更新',
    es: 'Actualizado',
  },
  Saved: {
    zh: '已保存',
    es: 'Guardado',
  },
  'Selected orders': {
    zh: '所选订单',
    es: 'Pedidos seleccionados',
  },
  'Selected months · matching search': {
    zh: '所选月份 · 匹配搜索',
    es: 'Meses filtrados · búsqueda actual',
  },
  'All matching orders': {
    zh: '全部匹配订单',
    es: 'Todos los pedidos coincidentes',
  },
  'Purchase date': {
    zh: '购买日期',
    es: 'Fecha de compra',
  },
  'Date unavailable': {
    zh: '日期未知',
    es: 'Fecha no disponible',
  },
  Completed: {
    zh: '交易成功',
    es: 'Completado',
  },
  Closed: {
    zh: '已关闭',
    es: 'Cerrado',
  },
  'Awaiting payment': {
    zh: '待付款',
    es: 'Pendiente de pago',
  },
  'Awaiting shipment': {
    zh: '待发货',
    es: 'Pendiente de envío',
  },
  'Awaiting delivery': {
    zh: '待收货',
    es: 'Pendiente de entrega',
  },
  'Refund in progress': {
    zh: '退款中',
    es: 'Reembolso en curso',
  },
  Refunded: {
    zh: '已退款',
    es: 'Reembolsado',
  },
  'Status unavailable': {
    zh: '状态未知',
    es: 'Estado no disponible',
  },
  'Original amount': {
    zh: '原价总计',
    es: 'Importe original',
  },
  Shipping: {
    zh: '运费',
    es: 'Envío',
  },
  'Seller price changes': {
    zh: '卖家改价',
    es: 'Cambios de precio del vendedor',
  },
  'Product discounts': {
    zh: '商品优惠',
    es: 'Descuentos de productos',
  },
  'Order discounts': {
    zh: '订单优惠',
    es: 'Descuentos del pedido',
  },
  'Red packets': {
    zh: '红包',
    es: 'Cupones de pago',
  },
  'Extra services': {
    zh: '附加服务',
    es: 'Servicios adicionales',
  },
  'Total payable': {
    zh: '实付款',
    es: 'Total a pagar',
  },
  Unavailable: {
    zh: '暂无',
    es: 'No disponible',
  },
  'Original total (includes customization)': {
    zh: '原价总计（含定制）',
    es: 'Total original (incluye personalización)',
  },
  'Original goods': {
    zh: '商品原价',
    es: 'Productos originales',
  },
  'Wholesale discount (already in prices)': {
    zh: '批发优惠（已含在价格中）',
    es: 'Descuento mayorista (incluido en precios)',
  },
  'Order adjustment (already in product discounts)': {
    zh: '订单改价（已含在商品优惠中）',
    es: 'Ajuste (incluido en descuentos de productos)',
  },
  'Order adjustment (allocated)': {
    zh: '订单改价（已分摊）',
    es: 'Ajuste del pedido (repartido)',
  },
  'Order-only discount': {
    zh: '订单专属优惠',
    es: 'Descuento general del pedido',
  },
  'Goods after discounts': {
    zh: '优惠后商品金额',
    es: 'Productos tras descuentos',
  },
  'Customization service': {
    zh: '定制服务',
    es: 'Servicio de personalización',
  },
  'Red-packet discount (payment only)': {
    zh: '红包抵扣（仅支付）',
    es: 'Cupón aplicado al pago',
  },
  'Order total': {
    zh: '订单合计',
    es: 'Total del pedido',
  },
  'ORDER {0}': {
    zh: '订单 {0}',
    es: 'PEDIDO {0}',
  },
  'Order {0}': {
    zh: '订单 {0}',
    es: 'Pedido {0}',
  },
  'Product {0}': {
    zh: '商品 {0}',
    es: 'Producto {0}',
  },
  'Zoom product photo {0}': {
    zh: '放大商品图片 {0}',
    es: 'Ampliar foto del producto {0}',
  },
  'Open original order ↗': {
    zh: '打开原始订单 ↗',
    es: 'Abrir pedido original ↗',
  },
  '{0} products': {
    zh: '{0} 件商品',
    es: '{0} productos',
  },
  '{0} orders': {
    zh: '{0} 个订单',
    es: '{0} pedidos',
  },
  '{0} purchase months': {
    zh: '{0} 个购买月份',
    es: '{0} meses de compra',
  },
  '{0} selected order{1}': {
    zh: '已选择 {0} 个订单',
    es: '{0} pedido{1} seleccionado{1}',
  },
  'Refresh {0} order{1}': {
    zh: '刷新 {0} 个订单',
    es: 'Actualizar {0} pedido{1}',
  },
  'Whole-order totals · {0} matching order{1}': {
    zh: '完整订单合计 · {0} 个匹配订单',
    es: 'Totales completos · {0} pedido{1} coincidente{1}',
  },
  '{0} matching product{1}{2}': {
    zh: '{0} 件匹配商品{2}',
    es: '{0} producto{1} coincidente{1}{2}',
  },
  ' · continued': {
    zh: ' · 续页',
    es: ' · continuación',
  },
  ' · all filtered rows will copy': {
    zh: ' · 将复制全部筛选行',
    es: ' · se copiarán todas las filas filtradas',
  },
  ' · {0} selected': {
    zh: ' · 已选择 {0} 行',
    es: ' · {0} seleccionadas',
  },
  '{0} rows{1}': {
    zh: '{0} 行{1}',
    es: '{0} filas{1}',
  },
  'incl. {0} allocated': {
    zh: '含分摊优惠 {0}',
    es: 'incluye {0} repartido',
  },
  'Version {0} · Checked {1}': {
    zh: '版本 {0} · 检查于 {1}',
    es: 'Versión {0} · Revisado {1}',
  },
  'Removed: {0}': {
    zh: '已移除：{0}',
    es: 'Eliminado: {0}',
  },
  '{0} · {1} products · Total ¥ {2}': {
    zh: '{0} · {1} 件商品 · 合计 ¥ {2}',
    es: '{0} · {1} productos · Total ¥ {2}',
  },
  'Resume collection of {0} orders?': {
    zh: '继续采集 {0} 个订单？',
    es: '¿Continuar la recopilación de {0} pedidos?',
  },
  'Resume {0} orders': {
    zh: '继续 {0} 个订单',
    es: 'Continuar {0} pedidos',
  },
  'Preparing images {0}–{1} of {2}…': {
    zh: '正在准备图片 {0}–{1} / {2}…',
    es: 'Preparando imágenes {0}–{1} de {2}…',
  },
  'Choose Excel image batch': {
    zh: '选择 Excel 图片批次',
    es: 'Elegir lote de imágenes de Excel',
  },
  'Image batch number': {
    zh: '图片批次编号',
    es: 'Número de lote de imágenes',
  },
  'Choose a valid batch number.': {
    zh: '请选择有效的批次编号。',
    es: 'Elige un número de lote válido.',
  },
  'Batch {0} of {1} · rows {2}–{3} of {4}': {
    zh: '第 {0} / {1} 批 · 第 {2}–{3} / {4} 行',
    es: 'Lote {0} de {1} · filas {2}–{3} de {4}',
  },
  'Copy the table in numbered images': {
    zh: '分批复制表格图片',
    es: 'Copiar la tabla en imágenes numeradas',
  },
  '{0} rows need {1} images at full quality. Choose one batch, then repeat for the others.':
    {
      zh: '{0} 行需要 {1} 张完整清晰度图片。选择一批后再复制其他批次。',
      es: '{0} filas requieren {1} imágenes de calidad completa. Elige un lote y repite para los demás.',
    },
  'Product photo': {
    zh: '商品图片',
    es: 'Foto del producto',
  },
  'Close product photo': {
    zh: '关闭商品图片',
    es: 'Cerrar foto del producto',
  },
  'Zoom in': {
    zh: '放大',
    es: 'Acercar',
  },
  'Zoom out': {
    zh: '缩小',
    es: 'Alejar',
  },
  Fit: {
    zh: '适合窗口',
    es: 'Ajustar',
  },
  'Actual size (100%)': {
    zh: '原始尺寸 (100%)',
    es: 'Tamaño real (100%)',
  },
  Fullscreen: {
    zh: '全屏',
    es: 'Pantalla completa',
  },
  'Exit fullscreen': {
    zh: '退出全屏',
    es: 'Salir de pantalla completa',
  },
  'Loading original image…': {
    zh: '正在加载原图…',
    es: 'Cargando imagen original…',
  },
  'Image unavailable offline': {
    zh: '离线时图片不可用',
    es: 'Imagen no disponible sin conexión',
  },
  'Printable label preview': {
    zh: '打印标签预览',
    es: 'Vista previa de etiqueta',
  },
  'Spanish product name': {
    zh: '西班牙语商品名',
    es: 'Nombre del producto en español',
  },
  'Chinese category': {
    zh: '中文品类',
    es: 'Categoría en chino',
  },
  'Product code': {
    zh: '商品货号',
    es: 'Código del producto',
  },
  'Base CE code': {
    zh: 'CE 基础货号',
    es: 'Código CE base',
  },
  'Barcode code': {
    zh: '条码货号',
    es: 'Código de barras',
  },
  'Product code · edit on the carton mark': {
    zh: '商品货号 · 在唛头上编辑',
    es: 'Código del producto · edita en la marca de caja',
  },
  ' · Unsaved text': {
    zh: ' · 文字未保存',
    es: ' · Texto sin guardar',
  },
  'Saving label…': {
    zh: '正在保存标签…',
    es: 'Guardando etiqueta…',
  },
  'Preparing label…{0}': {
    zh: '正在准备标签…{0}',
    es: 'Preparando etiqueta…{0}',
  },
  'Updating preview…{0}': {
    zh: '正在更新预览…{0}',
    es: 'Actualizando vista previa…{0}',
  },
  '{0} × {1} mm · {2} dpi': {
    zh: '{0} × {1} mm · {2} dpi',
    es: '{0} × {1} mm · {2} dpi',
  },
  '{0} × {1} mm · {2} dpi{3}': {
    zh: '{0} × {1} mm · {2} dpi{3}',
    es: '{0} × {1} mm · {2} dpi{3}',
  },
  '{0} — Enter saves, Escape restores': {
    zh: '{0} — 回车保存，Esc 恢复',
    es: '{0} — Intro guarda, Esc restaura',
  },
  '{0} · leave empty if not needed · Enter saves': {
    zh: '{0} · 不需要时留空 · 回车保存',
    es: '{0} · deja vacío si no hace falta · Intro guarda',
  },
  'Automatic size codes': {
    zh: '自动尺码编码',
    es: 'Códigos de talla automáticos',
  },
  'Search size rules': {
    zh: '搜索尺码规则',
    es: 'Buscar reglas de talla',
  },
  'Add size rule': {
    zh: '添加尺码规则',
    es: 'Añadir regla de talla',
  },
  'Remove size rule': {
    zh: '删除尺码规则',
    es: 'Eliminar regla de talla',
  },
  'Previous size rules': {
    zh: '上一页尺码规则',
    es: 'Reglas de talla anteriores',
  },
  'Next size rules': {
    zh: '下一页尺码规则',
    es: 'Reglas de talla siguientes',
  },
  'Size rules': {
    zh: '尺码规则',
    es: 'Reglas de talla',
  },
  'Size names': {
    zh: '尺码名称',
    es: 'Nombres de talla',
  },
  'Size code': {
    zh: '尺码码',
    es: 'Código de talla',
  },
  'No matching size rules.': {
    zh: '没有匹配的尺码规则。',
    es: 'No hay reglas de talla coincidentes.',
  },
  '{0}–{1} of {2} rules': {
    zh: '第 {0}–{1} 条，共 {2} 条规则',
    es: '{0}–{1} de {2} reglas',
  },
  '{0}–{1} of {2} groups': {
    zh: '第 {0}–{1} 组，共 {2} 组',
    es: '{0}–{1} de {2} grupos',
  },
  orders: {
    zh: '个订单',
    es: 'pedidos',
  },
  activities: {
    zh: '条动态',
    es: 'actividades',
  },
  Refresh: {
    zh: '刷新',
    es: 'Actualizar',
  },
  Remove: {
    zh: '删除',
    es: 'Eliminar',
  },
  '{0} {1} {2}': {
    zh: '{0} {1} {2}',
    es: '{0} {1} {2}',
  },
  '{0} {1} {2}?': {
    zh: '{0} {1} {2}？',
    es: '¿{0} {1} {2}?',
  },
  '{0}: {1}': {
    zh: '{0}：{1}',
    es: '{0}: {1}',
  },
}
