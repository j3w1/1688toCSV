export const VALIDATION_MESSAGES = {
  'Product row {0} ({1}) needs a Chinese category before copying its carton mark.':
    {
      zh: '商品第 {0} 行（{1}）需要填写中文品类后才能复制唛头。',
      es: 'La fila {0} ({1}) necesita una categoría en chino antes de copiar su marca de caja.',
    },
  'Carton mark for product row {0} could not be created. Check its code and Chinese category, then try again. {1}':
    {
      zh: '无法生成商品第 {0} 行的唛头。请检查货号和中文品类后重试。{1}',
      es: 'No se pudo crear la marca de caja de la fila {0}. Revisa su código y categoría en chino e inténtalo de nuevo. {1}',
    },
  'A carton mark renderer is required for prepared products.': {
    zh: '已准备的商品需要唛头图像生成器。',
    es: 'Los productos preparados necesitan un generador de marcas de caja.',
  },
  'A complete order must contain product rows': {
    zh: '完整订单必须包含商品行',
    es: 'Un pedido completo debe contener filas de productos',
  },
  'A product character cannot fit in the Excel image.': {
    zh: '某个商品文字字符无法放入 Excel 图片。',
    es: 'Un carácter del producto no cabe en la imagen para Excel.',
  },
  'A removed row is still present in the order': {
    zh: '已删除的商品行仍存在于订单中',
    es: 'Una fila eliminada todavía aparece en el pedido',
  },
  'A source entry may belong to only one variant': {
    zh: '每条原始商品记录只能属于一个款式',
    es: 'Cada registro original solo puede pertenecer a una variante',
  },
  'All 99 seller groups for this packing month are exhausted': {
    zh: '此装箱月份的 99 个卖家组编号已全部用完',
    es: 'Se agotaron los 99 grupos de vendedores para este mes de empaque',
  },
  'Allocation groups must be an array': {
    zh: '编码分配组必须为数组',
    es: 'Los grupos de asignación deben ser una lista',
  },
  'An order contains duplicate product entry IDs': {
    zh: '订单中包含重复的商品记录 ID',
    es: 'Un pedido contiene ID de registros de productos duplicados',
  },
  'Backup conflict: monthly group belongs to another seller': {
    zh: '备份冲突：该月份组属于另一卖家',
    es: 'Conflicto en la copia: el grupo mensual pertenece a otro vendedor',
  },
  'Backup conflict: preparation edits have the same timestamp': {
    zh: '备份冲突：装箱修改具有相同的时间戳',
    es: 'Conflicto en la copia: las ediciones de empaque tienen la misma fecha y hora',
  },
  'Backup contains duplicate cached images': {
    zh: '备份包含重复的缓存图片',
    es: 'La copia contiene imágenes en caché duplicadas',
  },
  'Backup contains duplicate history entries': {
    zh: '备份包含重复的历史记录',
    es: 'La copia contiene registros de historial duplicados',
  },
  'Backup contains duplicate order IDs': {
    zh: '备份包含重复的订单 ID',
    es: 'La copia contiene ID de pedidos duplicados',
  },
  'Backup contains duplicate {0}': {
    zh: '备份包含重复的 {0}',
    es: 'La copia contiene {0} duplicados',
  },
  'Backup history must precede its current order': {
    zh: '备份中的历史版本必须早于当前订单版本',
    es: 'El historial de la copia debe ser anterior a la versión actual del pedido',
  },
  'Backup images must be an array': {
    zh: '备份图片必须为数组',
    es: 'Las imágenes de la copia deben ser una lista',
  },
  'Backup orders and history must be arrays': {
    zh: '备份订单和历史记录必须为数组',
    es: 'Los pedidos y el historial de la copia deben ser listas',
  },
  'Backup {0} must be an array': {
    zh: '备份中的 {0} 必须为数组',
    es: 'El campo {0} de la copia debe ser una lista',
  },
  'Barcode suffixes must use uppercase letters and numbers': {
    zh: '条码后缀必须使用大写字母和数字',
    es: 'Las terminaciones del código de barras deben usar letras mayúsculas y números',
  },
  'Base code must use the chosen month and group/item numbers 01–99': {
    zh: '主编码必须使用所选月份，组号和商品号必须在 01–99 之间',
    es: 'El código base debe usar el mes elegido y números de grupo y producto del 01 al 99',
  },
  'Cached image exceeds the 2 MB limit': {
    zh: '缓存图片超过 2 MB 限制',
    es: 'La imagen en caché supera el límite de 2 MB',
  },
  'Cached images must use an Alibaba CDN URL and raster image data': {
    zh: '缓存图片必须使用阿里巴巴 CDN 地址和位图数据',
    es: 'Las imágenes en caché deben usar una URL de la CDN de Alibaba y datos de imagen de mapa de bits',
  },
  'Changed row is missing from the order': {
    zh: '订单中缺少已更改的商品行',
    es: 'La fila modificada no aparece en el pedido',
  },
  'Choose a barcode or shipping mark': {
    zh: '请选择条码或唛头',
    es: 'Elige un código de barras o una marca de caja',
  },
  'Choose a packing month between 2000 and 2099': {
    zh: '请选择 2000–2099 年间的装箱月份',
    es: 'Elige un mes de empaque entre los años 2000 y 2099',
  },
  'Choose an Excel image batch and photo loader.': {
    zh: '请选择 Excel 图片批次并提供图片加载器。',
    es: 'Elige un lote de imágenes para Excel y un cargador de fotos.',
  },
  'Choose at least one order to prepare': {
    zh: '请至少选择一个订单进行装箱准备',
    es: 'Elige al menos un pedido para preparar',
  },
  'Choose columns and product rows to copy.': {
    zh: '请选择要复制的列和商品行。',
    es: 'Elige las columnas y filas de productos que quieres copiar.',
  },
  'Close other order-library tabs before upgrading the database': {
    zh: '升级数据库前，请关闭其他订单库标签页',
    es: 'Cierra las demás pestañas de la biblioteca de pedidos antes de actualizar la base de datos',
  },
  'Code owner entry ID must be a decimal ID': {
    zh: '编码所属商品的记录 ID 必须为十进制 ID',
    es: 'El ID del registro propietario del código debe ser decimal',
  },
  'Code owner snapshot must contain entry IDs and photos': {
    zh: '编码所属商品的快照必须包含记录 ID 和图片',
    es: 'La instantánea del propietario del código debe contener los ID de registro y las fotos',
  },
  'Copy requires a prepared PNG thumbnail.': {
    zh: '复制需要已准备好的 PNG 商品图片。',
    es: 'Para copiar se necesita una foto preparada en formato PNG.',
  },
  'Database transaction aborted': {
    zh: '数据库操作已中止',
    es: 'La operación de la base de datos se canceló',
  },
  'Database transaction failed': {
    zh: '数据库操作失败',
    es: 'Falló la operación de la base de datos',
  },
  'Duplicate product group ID': {
    zh: '商品组 ID 重复',
    es: 'ID de grupo de productos duplicado',
  },
  'Duplicate variant ID': {
    zh: '款式 ID 重复',
    es: 'ID de variante duplicado',
  },
  'Each packing selection needs its source order and selected entry IDs': {
    zh: '每项装箱选择都必须包含原始订单及所选商品的记录 ID',
    es: 'Cada selección de empaque necesita su pedido original y los ID de los registros seleccionados',
  },
  'Enter a short Chinese category, up to 30 characters': {
    zh: '请输入简短的中文品类，最多 30 个字符',
    es: 'Ingresa una categoría breve en chino, de hasta 30 caracteres',
  },
  'Enter a short Spanish product name, up to 80 characters': {
    zh: '请输入简短的西班牙语商品名，最多 80 个字符',
    es: 'Ingresa un nombre breve del producto en español, de hasta 80 caracteres',
  },
  'Enter a short website and destination': {
    zh: '请输入简短的网站和目的地',
    es: 'Ingresa un sitio web y un destino breves',
  },
  'Every selected product needs its own image.': {
    zh: '每个所选商品都需要有自己的图片。',
    es: 'Cada producto seleccionado necesita su propia imagen.',
  },
  'Expected preparation revisions must be non-negative integers': {
    zh: '预期的装箱版本号必须为非负整数',
    es: 'Las revisiones esperadas del empaque deben ser enteros no negativos',
  },
  'Identify the seller before saving preparation or assigning label codes.': {
    zh: '保存装箱准备或分配标签编码前，请先确认卖家。',
    es: 'Identifica al vendedor antes de guardar la preparación o asignar códigos de etiquetas.',
  },
  'Issued barcode is missing its owning base reservation': {
    zh: '已分配的条码缺少其所属主编码的保留记录',
    es: 'Al código de barras emitido le falta la reserva de su código base',
  },
  'Issued code is invalid': {
    zh: '已分配的编码无效',
    es: 'El código emitido no es válido',
  },
  'Issued code is missing its monthly allocation reservation': {
    zh: '已分配的编码缺少月份分配保留记录',
    es: 'Al código emitido le falta su reserva de asignación mensual',
  },
  'Map this variant size before generating labels': {
    zh: '生成标签前，请先设置此款式的尺码对应规则',
    es: 'Asigna un código a la talla de esta variante antes de generar etiquetas',
  },
  'Monthly seller group numbers must be unique and between 01 and 99': {
    zh: '每月卖家组编号必须唯一，且在 01–99 之间',
    es: 'Los números de grupo de vendedor del mes deben ser únicos y estar entre 01 y 99',
  },
  'Name provenance source must be automatic or manual': {
    zh: '名称来源必须为自动或手动',
    es: 'El origen del nombre debe ser automático o manual',
  },
  'No labels are ready to copy.': {
    zh: '暂无可复制的标签。',
    es: 'No hay etiquetas listas para copiar.',
  },
  'No photo data was returned.': {
    zh: '未返回图片数据。',
    es: 'No se recibieron datos de la foto.',
  },
  'Order changedAt follows its observation': {
    zh: '订单的 changedAt 晚于采集时间',
    es: 'El campo changedAt del pedido es posterior a su captura',
  },
  'Order lastCheckedAt precedes its observation': {
    zh: '订单的 lastCheckedAt 早于采集时间',
    es: 'El campo lastCheckedAt del pedido es anterior a su captura',
  },
  'Order revision must be a positive integer': {
    zh: '订单版本号必须为正整数',
    es: 'La revisión del pedido debe ser un entero positivo',
  },
  'Order was not found': { zh: '未找到订单', es: 'No se encontró el pedido' },
  'Packing checkpoints cannot contain nested history': {
    zh: '装箱恢复点不能包含嵌套历史记录',
    es: 'Los puntos de restauración de empaque no pueden contener historial anidado',
  },
  'Packing preferences exceed the 3 MB limit': {
    zh: '装箱偏好设置超过 3 MB 限制',
    es: 'Las preferencias de empaque superan el límite de 3 MB',
  },
  'Packing selection must be an array': {
    zh: '装箱选择必须为数组',
    es: 'La selección de empaque debe ser una lista',
  },
  'Photo for product row {0} could not be loaded. Refresh the photo and try again. {1}':
    {
      zh: '无法加载第 {0} 行商品的图片。请刷新图片后重试。{1}',
      es: 'No se pudo cargar la foto de la fila de producto {0}. Actualiza la foto e inténtalo de nuevo. {1}',
    },
  'Preparation changed in another tab. Reload it before saving your edits.': {
    zh: '装箱准备已在其他标签页更改。保存修改前，请重新加载。',
    es: 'La preparación cambió en otra pestaña. Recárgala antes de guardar tus ediciones.',
  },
  'Preparation contains an entry missing from its order and history': {
    zh: '装箱准备中的某条商品记录不存在于订单或历史记录中',
    es: 'La preparación contiene un registro que no aparece en el pedido ni en su historial',
  },
  'Preparation contains an entry missing from this order': {
    zh: '装箱准备中的某条商品记录不存在于此订单中',
    es: 'La preparación contiene un registro que no aparece en este pedido',
  },
  'Preparation groups must be an array': {
    zh: '装箱商品组必须为数组',
    es: 'Los grupos de preparación deben ser una lista',
  },
  'Preparation is missing issued code reservations': {
    zh: '装箱准备缺少已分配编码的保留记录',
    es: 'A la preparación le faltan las reservas de códigos emitidos',
  },
  'Preparation is missing its saved order': {
    zh: '装箱准备缺少对应的已保存订单',
    es: 'A la preparación le falta su pedido guardado',
  },
  'Preparation order ID must be a decimal ID': {
    zh: '装箱准备的订单 ID 必须为十进制 ID',
    es: 'El ID del pedido de preparación debe ser decimal',
  },
  'Preparation revision must be a non-negative integer': {
    zh: '装箱版本号必须为非负整数',
    es: 'La revisión de preparación debe ser un entero no negativo',
  },
  'Preparation updatedAt must be a timestamp': {
    zh: '装箱准备的 updatedAt 必须为时间戳',
    es: 'El campo updatedAt de la preparación debe ser una fecha y hora',
  },
  'Product amounts do not reconcile with the order totals': {
    zh: '商品金额与订单合计不一致',
    es: 'Los importes de productos no cuadran con los totales del pedido',
  },
  'Product discounts do not reconcile with their row values': {
    zh: '商品优惠与对应行金额不一致',
    es: 'Los descuentos de productos no cuadran con los importes de sus filas',
  },
  'Product row {0} has no photo. Add or refresh its photo before copying.': {
    zh: '第 {0} 行商品没有图片。复制前请添加或刷新图片。',
    es: 'La fila de producto {0} no tiene foto. Añade o actualiza su foto antes de copiar.',
  },
  'Product row {0} is invalid.': {
    zh: '第 {0} 行商品无效。',
    es: 'La fila de producto {0} no es válida.',
  },
  'Product row {0} is too tall for one image. Shorten its description or copy its values instead.':
    {
      zh: '第 {0} 行商品过高，无法放入一张图片。请缩短描述或改为复制数据。',
      es: 'La fila de producto {0} es demasiado alta para una sola imagen. Acorta su descripción o copia sus valores.',
    },
  'Product variants must be an array': {
    zh: '商品款式必须为数组',
    es: 'Las variantes de productos deben ser una lista',
  },
  'Resolution must be a whole number': {
    zh: '分辨率必须为整数',
    es: 'La resolución debe ser un número entero',
  },
  'SKU properties must be an array': {
    zh: 'SKU 属性必须为数组',
    es: 'Las propiedades de SKU deben ser una lista',
  },
  'Save a valid base code before generating labels': {
    zh: '生成标签前，请先保存有效的主编码',
    es: 'Guarda un código base válido antes de generar etiquetas',
  },
  'Save each order preparation only once in a batch': {
    zh: '同一批次中，每个订单的装箱准备只能保存一次',
    es: 'Guarda la preparación de cada pedido una sola vez por lote',
  },
  'Save the source order before preparing labels': {
    zh: '准备标签前，请先保存原始订单',
    es: 'Guarda el pedido original antes de preparar etiquetas',
  },
  'Saved preparation is missing allocated codes or revision': {
    zh: '已保存的装箱准备缺少分配编码或版本号',
    es: 'A la preparación guardada le faltan códigos asignados o su revisión',
  },
  'Select at least one product to copy.': {
    zh: '请至少选择一个商品进行复制。',
    es: 'Selecciona al menos un producto para copiar.',
  },
  'Select each order only once': {
    zh: '每个订单只能选择一次',
    es: 'Selecciona cada pedido una sola vez',
  },
  'Select product rows to copy as an image.': {
    zh: '请选择要复制为图片的商品行。',
    es: 'Selecciona las filas de productos que quieres copiar como imagen.',
  },
  'Selected source order does not match its preparation': {
    zh: '所选原始订单与其装箱准备不匹配',
    es: 'El pedido original seleccionado no coincide con su preparación',
  },
  'Seller shop origin is invalid': {
    zh: '卖家店铺来源地址无效',
    es: 'La dirección de origen de la tienda no es válida',
  },
  'Seller shop origin must be an HTTPS 1688 shop': {
    zh: '卖家店铺来源必须为使用 HTTPS 的 1688 店铺',
    es: 'La dirección de origen debe ser una tienda de 1688 con HTTPS',
  },
  'Seller unavailable requires an explicit sellerUnavailable flag': {
    zh: '卖家信息缺失时，必须明确设置 sellerUnavailable 标记',
    es: 'Cuando el vendedor no está disponible, se requiere la marca sellerUnavailable explícita',
  },
  'Size rules must be a list with at most 500 entries': {
    zh: '尺码规则必须为列表，最多 500 条',
    es: 'Las reglas de talla deben ser una lista de hasta 500 registros',
  },
  'Size suggestions need one variant key per size': {
    zh: '每个尺码建议都需要一个款式标识',
    es: 'Las sugerencias de talla necesitan una clave de variante por talla',
  },
  'Text does not fit this label. Shorten it or increase the label size.': {
    zh: '文字无法放入此标签。请缩短文字或增大标签尺寸。',
    es: 'El texto no cabe en esta etiqueta. Acórtalo o aumenta el tamaño de la etiqueta.',
  },
  'The Excel image could not be encoded.': {
    zh: '无法编码 Excel 图片。',
    es: 'No se pudo codificar la imagen para Excel.',
  },
  'The Excel image exceeds the memory limit. Choose a smaller batch.': {
    zh: 'Excel 图片超过内存限制，请减少本批次的商品数量。',
    es: 'La imagen para Excel supera el límite de memoria. Elige un lote más pequeño.',
  },
  'The Excel image is too wide to render safely.': {
    zh: 'Excel 图片过宽，无法正常生成。',
    es: 'La imagen para Excel es demasiado ancha para generarla correctamente.',
  },
  'The browser could not create the label image': {
    zh: '浏览器无法创建标签图片',
    es: 'El navegador no pudo crear la imagen de la etiqueta',
  },
  'The browser could not encode the label PNG': {
    zh: '浏览器无法生成标签 PNG 数据',
    es: 'El navegador no pudo codificar el PNG de la etiqueta',
  },
  'The label renderer is closed': {
    zh: '标签生成器已关闭',
    es: 'El generador de etiquetas está cerrado',
  },
  'The logo must be a raster image': {
    zh: '标志必须为位图图片',
    es: 'El logotipo debe ser una imagen de mapa de bits',
  },
  'The next item number must be between 1 and 100': {
    zh: '下一商品编号必须在 1–100 之间',
    es: 'El siguiente número de producto debe estar entre 1 y 100',
  },
  'The order source URL is invalid': {
    zh: '订单来源网址无效',
    es: 'La URL de origen del pedido no es válida',
  },
  'The order source URL must identify the same supported order': {
    zh: '订单来源网址必须指向同一受支持的订单',
    es: 'La URL de origen debe identificar el mismo pedido compatible',
  },
  'The photo has unsupported dimensions.': {
    zh: '不支持此图片尺寸。',
    es: 'Las dimensiones de la foto no son compatibles.',
  },
  'The product group no longer exists in this order': {
    zh: '此订单中已不存在该商品组',
    es: 'El grupo de productos ya no existe en este pedido',
  },
  'The selected products changed. Refresh the selection before preparing.': {
    zh: '所选商品已变化。请更新选择后再进行装箱准备。',
    es: 'Los productos seleccionados cambiaron. Actualiza la selección antes de preparar.',
  },
  'The size name “{0}” appears in more than one rule': {
    zh: '尺码名称“{0}”出现在多条规则中',
    es: 'El nombre de talla «{0}» aparece en más de una regla',
  },
  'The source order does not match this preparation': {
    zh: '原始订单与此装箱准备不匹配',
    es: 'El pedido original no coincide con esta preparación',
  },
  'This barcode is too long for the label width. Shorten the suffix or increase the width.':
    {
      zh: '条码过长，超出标签宽度。请缩短后缀或增加标签宽度。',
      es: 'Este código de barras es demasiado largo para el ancho de la etiqueta. Acorta la terminación o aumenta el ancho.',
    },
  'This browser cannot create the Excel image.': {
    zh: '此浏览器无法创建 Excel 图片。',
    es: 'Este navegador no puede crear la imagen para Excel.',
  },
  'This label is too large. Reduce its dimensions or resolution.': {
    zh: '此标签过大，请减小尺寸或分辨率。',
    es: 'Esta etiqueta es demasiado grande. Reduce sus dimensiones o resolución.',
  },
  'This monthly group belongs to another seller': {
    zh: '此月份组属于另一卖家',
    es: 'Este grupo mensual pertenece a otro vendedor',
  },
  'This order has no previous packing to restore': {
    zh: '此订单没有可恢复的先前装箱设置',
    es: 'Este pedido no tiene un empaque anterior para restaurar',
  },
  'This order has no saved default layout yet': {
    zh: '此订单尚未保存默认排序布局',
    es: 'Este pedido aún no tiene una distribución predeterminada guardada',
  },
  'This photo exceeds the image memory budget. Copy its values separately or use a smaller source photo.':
    {
      zh: '此图片超过图片内存限制。请单独复制数据，或使用更小的原图。',
      es: 'Esta foto supera el límite de memoria para imágenes. Copia sus valores por separado o usa una foto original más pequeña.',
    },
  'This thumbnail host is not supported for image copying.': {
    zh: '不支持从此图片网站复制商品图片。',
    es: 'No se admite copiar imágenes desde el servidor de esta foto.',
  },
  'Thumbnail URL is invalid.': {
    zh: '商品图片网址无效。',
    es: 'La URL de la foto no es válida.',
  },
  'Thumbnail could not be loaded ({0}).': {
    zh: '无法加载商品图片（{0}）。',
    es: 'No se pudo cargar la foto ({0}).',
  },
  'Thumbnail is not a supported image.': {
    zh: '不支持此商品图片格式。',
    es: 'La foto no tiene un formato de imagen compatible.',
  },
  'Thumbnail is too large to copy.': {
    zh: '商品图片过大，无法复制。',
    es: 'La foto es demasiado grande para copiar.',
  },
  'Unavailable seller must have no member login and use the Seller unavailable name':
    {
      zh: '卖家信息缺失时，会员登录名必须为空，名称必须为“卖家信息缺失”',
      es: 'Un vendedor no disponible debe tener el usuario vacío y usar el nombre Vendedor no disponible',
    },
  'Unsupported order-library backup': {
    zh: '不支持此订单库备份格式',
    es: 'La copia de la biblioteca de pedidos no es compatible',
  },
  'Unsupported snapshot schema version': {
    zh: '不支持此快照结构版本',
    es: 'La versión del formato de la instantánea no es compatible',
  },
  'Use a cache up to 64 MB and one or two rendering tasks': {
    zh: '缓存不得超过 64 MB，生成任务数应为 1 或 2',
    es: 'Usa una caché de hasta 64 MB y una o dos tareas de generación',
  },
  'Variant entry ID must be a decimal ID': {
    zh: '款式记录 ID 必须为十进制 ID',
    es: 'El ID del registro de variante debe ser decimal',
  },
  'Variant entryIds must be an array': {
    zh: '款式的 entryIds 必须为数组',
    es: 'El campo entryIds de la variante debe ser una lista',
  },
  'Vocabulary must be an array': {
    zh: '词库必须为数组',
    es: 'El vocabulario debe ser una lista',
  },
  'foreignCurrencyFeeUnspecified must be true when present': {
    zh: '若存在 foreignCurrencyFeeUnspecified，其值必须为 true',
    es: 'Si existe foreignCurrencyFeeUnspecified, su valor debe ser true',
  },
  'needsSizeMapping must be true or false': {
    zh: 'needsSizeMapping 必须为 true 或 false',
    es: 'needsSizeMapping debe ser true o false',
  },
  'purchasedAt must be a valid purchase timestamp': {
    zh: 'purchasedAt 必须为有效的购买时间戳',
    es: 'purchasedAt debe ser una fecha y hora de compra válida',
  },
  '{0} cannot move items from another order or group': {
    zh: '{0} 不能移动其他订单或商品组中的商品',
    es: '{0} no puede mover productos de otro pedido o grupo',
  },
  '{0} contains an empty or invalid size name': {
    zh: '{0} 包含空白或无效的尺码名称',
    es: '{0} contiene un nombre de talla vacío o no válido',
  },
  '{0} contains an order outside this preparation batch': {
    zh: '{0} 包含不属于本次装箱批次的订单',
    es: '{0} contiene un pedido que no pertenece a este lote de preparación',
  },
  '{0} contains duplicate values': {
    zh: '{0} 包含重复值',
    es: '{0} contiene valores duplicados',
  },
  '{0} is invalid': { zh: '{0} 无效', es: '{0} no es válido' },
  '{0} must be a full decimal ID string': {
    zh: '{0} 必须为完整的十进制 ID 字符串',
    es: '{0} debe ser una cadena completa de ID decimal',
  },
  '{0} must be a string{1}': {
    zh: '{0} 必须为字符串{1}',
    es: '{0} debe ser una cadena de texto{1}',
  },
  '{0} must be a valid timestamp': {
    zh: '{0} 必须为有效时间戳',
    es: '{0} debe ser una fecha y hora válida',
  },
  '{0} must be an array': {
    zh: '{0} 必须为数组',
    es: '{0} debe ser una lista',
  },
  '{0} must be an object': {
    zh: '{0} 必须为对象',
    es: '{0} debe ser un objeto',
  },
  '{0} must be between {1} and {2}': {
    zh: '{0} 必须在 {1} 和 {2} 之间',
    es: '{0} debe estar entre {1} y {2}',
  },
  '{0} must be text{1}': {
    zh: '{0} 必须为文本{1}',
    es: '{0} debe ser texto{1}',
  },
  '{0} must be true or false': {
    zh: '{0} 必须为 true 或 false',
    es: '{0} debe ser true o false',
  },
  '{0} must include each existing item exactly once': {
    zh: '{0} 必须包含每个现有商品，且各出现一次',
    es: '{0} debe incluir cada producto existente exactamente una vez',
  },
  '{0} needs a code of 1–12 letters or numbers': {
    zh: '{0} 需要一个由 1–12 个字母或数字组成的编码',
    es: '{0} necesita un código de 1 a 12 letras o números',
  },
  '{0} needs size names separated by |': {
    zh: '{0} 需要填写尺码名称，多个名称用 | 分隔',
    es: '{0} necesita nombres de talla separados por |',
  },
  '{0}.{1} must be a decimal string': {
    zh: '{0}.{1} 必须为十进制数字字符串',
    es: '{0}.{1} debe ser una cadena decimal',
  },
}
