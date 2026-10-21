export const OPERATIONS_MESSAGES = {
  Today: { es: 'Hoy', zh: '今天' },
  Yesterday: { es: 'Ayer', zh: '昨天' },
  Clear: { es: 'Borrar', zh: '清空' },
  'Purchased: {date}': { es: 'Compra: {date}', zh: '购买日期：{date}' },
  'Source: {price} × {quantity}': {
    es: 'Original: {price} × {quantity}',
    zh: '原始：{price} × {quantity}',
  },
  'Source payable: {amount}': {
    es: 'Total original: {amount}',
    zh: '原始应付：{amount}',
  },
  'Source freight: {amount}': {
    es: 'Envío original: {amount}',
    zh: '原始运费：{amount}',
  },
  'Copy the source amount only if it matches the actual amount. Save workflow to keep the change.':
    {
      es: 'Usa el importe original solo si coincide con el real. Guarda el seguimiento para conservar el cambio.',
      zh: '仅在与实际金额一致时使用原始金额，保存跟进后生效。',
    },
  'Use note: {note}': { es: 'Usar nota: {note}', zh: '使用已有说明：{note}' },
  'Use this existing note in the field. Save workflow to keep the change.': {
    es: 'Usa esta nota existente en el campo. Guarda el seguimiento para conservar el cambio.',
    zh: '将这条已有说明填入此字段，保存跟进后生效。',
  },
  'Add {feature}': { es: 'Añadir {feature}', zh: '添加 {feature}' },
  'Use this existing feature name. Enter its cost and choose how it is recorded.':
    {
      es: 'Usa este nombre de característica existente. Ingresa su costo y cómo se contabiliza.',
      zh: '使用此已有功能名称，填写费用并选择计费方式。',
    },
  'Feature name': { es: 'Característica', zh: '功能名称' },
  'Cost / piece (¥)': { es: 'Costo / pieza (¥)', zh: '费用 / 件 (¥)' },
  'Cost treatment': { es: 'Contabilización', zh: '费用处理' },
  'Includes ¥{0} of added costs. The source unit price stays unchanged.': {
    es: 'Incluye ¥{0} de costos añadidos. El precio unitario original se conserva.',
    zh: '包含 ¥{0} 的新增成本，原始单价保持不变。',
  },
  'Already recorded': { es: 'Ya registrado', zh: '已计入付款' },
  'Additional cost': { es: 'Costo adicional', zh: '另加费用' },
  'Add feature': { es: 'Añadir característica', zh: '添加功能' },
  'Remove feature': { es: 'Quitar característica', zh: '移除功能' },
  'Product feature: {name} · ¥{cost}/piece · {treatment}': {
    es: 'Característica: {name} · ¥{cost}/pieza · {treatment}',
    zh: '商品功能：{name} · ¥{cost}/件 · {treatment}',
  },
  'Enter a cost per piece. Choose Already recorded when the source price, linked payment or order charges already cover it; otherwise it increases this product’s cost.':
    {
      es: 'Ingresa el costo por pieza. Elige Ya registrado si ya está incluido en el precio, un pago vinculado o los cargos del pedido; de lo contrario, se suma al costo del producto.',
      zh: '填写每件费用。如果原价、关联付款或订单附加费用已包含此项，请选择“已计入付款”；否则将增加该商品的成本。',
    },
  'Additional feature cost: ¥{cost} per piece': {
    es: 'Costo adicional de características: ¥{cost} por pieza',
    zh: '功能另加费用：每件 ¥{cost}',
  },
  'Enter a valid feature cost to calculate the total.': {
    es: 'Ingresa un costo válido para calcular el total.',
    zh: '请输入有效功能费用以计算总额。',
  },
  'Product features must be an object': {
    es: 'Las características deben ser un objeto',
    zh: '商品功能必须为对象',
  },
  'Product feature ID is invalid': {
    es: 'El ID de la característica no es válido',
    zh: '商品功能标识无效',
  },
  'Product feature names must be unique': {
    es: 'Los nombres de las características deben ser únicos',
    zh: '商品功能名称不能重复',
  },
  'Product feature is invalid': {
    es: 'La característica no es válida',
    zh: '商品功能无效',
  },
  'Enter a product feature name': {
    es: 'Ingresa un nombre para la característica',
    zh: '请输入商品功能名称',
  },
  'Feature cost must be a non-negative amount': {
    es: 'El costo de la característica no puede ser negativo',
    zh: '功能费用不得为负数',
  },
  'Choose whether the feature cost is already recorded': {
    es: 'Indica si el costo ya está registrado',
    zh: '请选择功能费用是否已计入付款',
  },
  Operations: { es: 'Seguimiento', zh: '业务跟进' },
  'Operations workflow': { es: 'Seguimiento operativo', zh: '业务跟进' },
  'Edit operations workflow': {
    es: 'Editar seguimiento operativo',
    zh: '编辑业务跟进',
  },
  'Workflow scope': { es: 'Ámbito del seguimiento', zh: '跟进范围' },
  'Save workflow': { es: 'Guardar seguimiento', zh: '保存跟进' },
  'More operations: {detail}': {
    es: 'Más estados: {detail}',
    zh: '更多状态：{detail}',
  },
  'Supplier prints product labels': {
    es: 'El proveedor imprime etiquetas de producto',
    zh: '供应商打印商品标签',
  },
  'Physical product labels must be sent': {
    es: 'Hay que enviar etiquetas físicas de producto',
    zh: '需要寄送商品实物标签',
  },
  'Store applies product labels free': {
    es: 'La tienda pega etiquetas de producto gratis',
    zh: '店铺免费贴商品标签',
  },
  'Store applies product labels for a fee': {
    es: 'La tienda cobra por pegar etiquetas de producto',
    zh: '店铺收费贴商品标签',
  },
  'Warehouse received{detail}': {
    es: 'Recibido en almacén{detail}',
    zh: '仓库已收货{detail}',
  },
  'Warehouse partially received{detail}': {
    es: 'Recibido parcialmente en almacén{detail}',
    zh: '仓库部分收货{detail}',
  },
  'Waiting for warehouse receipt': {
    es: 'Pendiente de recepción en almacén',
    zh: '等待仓库收货',
  },
  'Production delay: {detail}': {
    es: 'Retraso de producción: {detail}',
    zh: '生产延期：{detail}',
  },
  'Arrived without product labels{detail}': {
    es: 'Llegó sin etiquetas de producto{detail}',
    zh: '到货缺少商品标签{detail}',
  },
  'Labels, carton marks and written requirements sent': {
    es: 'Etiquetas, marcas de cartón y requisitos escritos enviados',
    zh: '标签、箱唛及书面要求均已发送',
  },
  'Physical labels dispatched: {date}': {
    es: 'Etiquetas físicas enviadas: {date}',
    zh: '实物标签已寄出：{date}',
  },
  'Shipping refund needs follow-up': {
    es: 'Reembolso de envío pendiente de seguimiento',
    zh: '运费退款待跟进',
  },
  Lighting: { es: 'Iluminación', zh: '带灯' },
  Rotation: { es: 'Rotación', zh: '旋转' },
  'Production delay': { es: 'Retraso de producción', zh: '生产延期' },
  'Delay state': { es: 'Estado del retraso', zh: '延期状态' },
  'Use order default': { es: 'Usar el valor del pedido', zh: '使用订单默认值' },
  'Not recorded': { es: 'Sin registrar', zh: '未记录' },
  'No delay': { es: 'Sin retraso', zh: '无延期' },
  Delayed: { es: 'Retrasado', zh: '已延期' },
  'Delay reason': { es: 'Motivo del retraso', zh: '延期原因' },
  'Original seller promise': {
    es: 'Promesa original del vendedor',
    zh: '卖家原始承诺',
  },
  'Confirmed date / range start': {
    es: 'Fecha confirmada / inicio del plazo',
    zh: '确认日期／起始日期',
  },
  'Range end (optional)': {
    es: 'Fin del plazo (opcional)',
    zh: '结束日期（可选）',
  },
  'Keep approximate seller wording. Enter dates only when confirmed.': {
    es: 'Conserva el plazo aproximado del vendedor. Introduce fechas solo cuando estén confirmadas.',
    zh: '保留卖家原始的大致时间说法，仅在已确认时填写日期。',
  },
  'Order default: {detail}': {
    es: 'Valor del pedido: {detail}',
    zh: '订单默认值：{detail}',
  },
  'Warehouse receipt': { es: 'Recepción en almacén', zh: '仓库收货' },
  Waiting: { es: 'Pendiente', zh: '待收货' },
  'Partially received': { es: 'Recibido parcialmente', zh: '部分收货' },
  Received: { es: 'Recibido', zh: '已收货' },
  'Received date': { es: 'Fecha de recepción', zh: '收货日期' },
  'Received quantity (optional)': {
    es: 'Cantidad recibida (opcional)',
    zh: '已收数量（可选）',
  },
  'Warehouse receipt is separate from the supplier delivery status.': {
    es: 'La recepción en almacén es independiente del estado de entrega del proveedor.',
    zh: '仓库收货状态与供应商的物流状态分开记录。',
  },
  'Product-label issue': {
    es: 'Incidencia de etiquetas de producto',
    zh: '商品标签问题',
  },
  'Arrived without product labels': {
    es: 'Llegó sin etiquetas de producto',
    zh: '到货缺少商品标签',
  },
  'No open label issue': {
    es: 'Sin incidencias de etiquetas pendientes',
    zh: '无待处理标签问题',
  },
  'Labels missing': { es: 'Faltan etiquetas', zh: '缺少标签' },
  'Label issue / resolution note': {
    es: 'Nota de la incidencia / solución',
    zh: '标签问题／处理说明',
  },
  'Original operational tags': {
    es: 'Etiquetas operativas originales',
    zh: '原始业务标签',
  },
  'Store services are shared by {count} known orders in this account.': {
    es: 'Los servicios de la tienda se comparten entre {count} pedidos identificados de esta cuenta.',
    zh: '店铺服务在本账户的 {count} 个已识别同店订单中共享。',
  },
  'Label services': { es: 'Servicios de etiquetas', zh: '标签服务' },
  'Product-label printing': {
    es: 'Impresión de etiquetas de producto',
    zh: '商品标签打印',
  },
  'Supplier prints labels': {
    es: 'El proveedor imprime las etiquetas',
    zh: '供应商打印标签',
  },
  'Send physical labels': {
    es: 'Enviar etiquetas físicas',
    zh: '寄送实物标签',
  },
  'Product-label application': {
    es: 'Colocación de etiquetas de producto',
    zh: '贴商品标签',
  },
  'Applies labels free': { es: 'Pega etiquetas gratis', zh: '免费贴标签' },
  'Applies labels for a fee': {
    es: 'Cobra por pegar etiquetas',
    zh: '收费贴标签',
  },
  'Every store can print carton marks. Product-label printing and application are separate services.':
    {
      es: 'Todas las tiendas pueden imprimir marcas de cartón. Imprimir y pegar etiquetas de producto son servicios distintos.',
      zh: '所有店铺都可以打印箱唛。商品标签打印与贴标是两项独立服务。',
    },
  'Store promises excess-shipping refunds': {
    es: 'La tienda promete devolver el exceso de envío',
    zh: '店铺承诺退还多收运费',
  },
  'Store instructions': { es: 'Instrucciones de la tienda', zh: '店铺说明' },
  'Instructions sent': { es: 'Instrucciones enviadas', zh: '已发送的要求' },
  'Label instructions sent': {
    es: 'Instrucciones de etiquetas enviadas',
    zh: '已发送标签要求',
  },
  'Carton-mark instructions sent': {
    es: 'Instrucciones de marcas de cartón enviadas',
    zh: '已发送箱唛要求',
  },
  'Written requirements sent': {
    es: 'Requisitos escritos enviados',
    zh: '已发送书面要求',
  },
  'Physical labels dispatched on': {
    es: 'Fecha de envío de etiquetas físicas',
    zh: '实物标签寄出日期',
  },
  'Shipping refund': { es: 'Reembolso de envío', zh: '运费退款' },
  'Record actual amounts and the promise separately. Original supplier totals stay unchanged.':
    {
      es: 'Registra los importes reales y la promesa por separado. Los totales originales del proveedor se conservan.',
      zh: '实际金额与承诺金额分开记录，保留供应商原始总额。',
    },
  'Actual payment · CNY': { es: 'Pago real · CNY', zh: '实际支付 · 人民币' },
  'Actual freight · CNY': { es: 'Flete real · CNY', zh: '实际运费 · 人民币' },
  'Promised refund · CNY': {
    es: 'Reembolso prometido · CNY',
    zh: '承诺退款 · 人民币',
  },
  'Refund received · CNY': {
    es: 'Reembolso recibido · CNY',
    zh: '已收到退款 · 人民币',
  },
  'Refund notes': { es: 'Notas del reembolso', zh: '退款说明' },
  'Product exceptions override the order default. Choose Use order default to remove an exception.':
    {
      es: 'Las excepciones del producto prevalecen sobre el pedido. Elige Usar el valor del pedido para quitar una excepción.',
      zh: '商品例外优先于订单默认值；选择“使用订单默认值”可移除例外。',
    },
  'Product features': { es: 'Características del producto', zh: '商品功能' },
  'Review operational tags': {
    es: 'Revisar etiquetas operativas',
    zh: '检查业务标签',
  },
  'Recognized operational tags': {
    es: 'Etiquetas operativas reconocidas',
    zh: '已识别业务标签',
  },
  'Only selected recognized tags become workflow fields. Original wording is retained; other tags and notes stay unchanged.':
    {
      es: 'Solo las etiquetas reconocidas y seleccionadas se convierten en campos. Se conserva su texto original; las demás etiquetas y notas no cambian.',
      zh: '仅将选中的已识别标签转换为跟进字段，保留原文；其他标签与备注保持不变。',
    },
  'Convert this tag': { es: 'Convertir esta etiqueta', zh: '转换此标签' },
  '→ {state}': { es: '→ {state}', zh: '→ {state}' },
  'Store service (shared with known same-account store orders)': {
    es: 'Servicio de tienda (compartido con sus pedidos identificados en esta cuenta)',
    zh: '店铺服务（在本账户已识别的同店订单中共享）',
  },
  'Product exception': { es: 'Excepción del producto', zh: '商品例外' },
  'Order default': { es: 'Valor del pedido', zh: '订单默认值' },
  'Original wording will be kept. Open the workflow after conversion to confirm details; no date is invented.':
    {
      es: 'Se conserva el texto original. Abre el seguimiento tras convertir para confirmar los detalles; no se inventa una fecha.',
      zh: '保留原始表述。转换后请打开跟进确认详情，不会推测日期。',
    },
  'An existing workflow value conflicts with this tag. Edit it individually.': {
    es: 'Un valor guardado entra en conflicto con esta etiqueta. Edítalo individualmente.',
    zh: '已有跟进值与此标签冲突，请单独编辑。',
  },
  'No recognized operational tags to convert.': {
    es: 'No hay etiquetas operativas reconocidas para convertir.',
    zh: '没有可转换的已识别业务标签。',
  },
  '{count} unrecognized tags will stay unchanged, including payment and code references.':
    {
      es: '{count} etiquetas no reconocidas se conservarán, incluidas las referencias a pagos y códigos.',
      zh: '{count} 个未识别标签将保留，包括付款与编码引用。',
    },
  'I reviewed the selected conversions': {
    es: 'He revisado las conversiones seleccionadas',
    zh: '我已检查选中的转换',
  },
  'Apply selected conversions': {
    es: 'Aplicar conversiones seleccionadas',
    zh: '应用所选转换',
  },
  'Choose at least one tag to migrate': {
    es: 'Elige al menos una etiqueta para convertir',
    zh: '请至少选择一个要转换的标签',
  },
  'Review and confirm the workflow migration first': {
    es: 'Revisa y confirma primero la conversión',
    zh: '请先检查并确认标签转换',
  },
  'Could not save workflow. Try again.': {
    es: 'No se pudo guardar el seguimiento. Inténtalo de nuevo.',
    zh: '无法保存跟进，请重试。',
  },
  'Workflow changed in another tab. Reopen it before saving.': {
    es: 'El seguimiento cambió en otra pestaña. Vuelve a abrirlo antes de guardar.',
    zh: '跟进已在其他标签页修改，请重新打开后再保存。',
  },
  'A migrated tag conflicts with an existing workflow value': {
    es: 'Una etiqueta convertida entra en conflicto con un valor guardado',
    zh: '转换标签与已有跟进值冲突',
  },
  'Selected tags propose conflicting workflow values': {
    es: 'Las etiquetas seleccionadas proponen valores incompatibles',
    zh: '所选标签提出的跟进值互相冲突',
  },
  'Workflow must be an object': {
    es: 'El seguimiento debe ser un objeto',
    zh: '跟进数据必须为对象',
  },
  'Unknown workflow field': {
    es: 'Campo de seguimiento desconocido',
    zh: '未知跟进字段',
  },
  'Workflow text is invalid': {
    es: 'El texto del seguimiento no es válido',
    zh: '跟进文字无效',
  },
  'Choose a valid workflow state': {
    es: 'Elige un estado de seguimiento válido',
    zh: '请选择有效的跟进状态',
  },
  'Workflow choice must be true or false': {
    es: 'La opción del seguimiento debe ser verdadera o falsa',
    zh: '跟进选项必须为是或否',
  },
  'Enter a valid workflow date': {
    es: 'Introduce una fecha de seguimiento válida',
    zh: '请填写有效的跟进日期',
  },
  'Workflow requires a valid update timestamp': {
    es: 'El seguimiento requiere una fecha de actualización válida',
    zh: '跟进数据需要有效的更新时间',
  },
  'Workflow product ID is invalid': {
    es: 'El identificador del producto no es válido',
    zh: '跟进商品标识无效',
  },
  'Workflow source tags are invalid': {
    es: 'Las etiquetas originales del seguimiento no son válidas',
    zh: '跟进原始标签无效',
  },
  'The confirmed end date must follow the start date': {
    es: 'La fecha final confirmada debe ser igual o posterior a la inicial',
    zh: '确认的结束日期不得早于起始日期',
  },
  'A delivery date requires an active delay': {
    es: 'Una fecha de entrega requiere un retraso activo',
    zh: '有延期时才能填写延期交付日期',
  },
  'Received quantity must be a non-negative whole number': {
    es: 'La cantidad recibida debe ser un número entero no negativo',
    zh: '已收数量必须为非负整数',
  },
  'Receipt details require a partial or received state': {
    es: 'Los datos de recepción requieren un estado parcial o recibido',
    zh: '部分收货或已收货时才能填写收货详情',
  },
  'Workflow amounts must be non-negative': {
    es: 'Los importes del seguimiento deben ser no negativos',
    zh: '跟进金额不得为负数',
  },
  'Product workflows must be an object': {
    es: 'Los seguimientos de producto deben ser un objeto',
    zh: '商品跟进数据必须为对象',
  },
  'Product workflow clocks must be an object': {
    es: 'Las fechas de seguimiento de productos deben ser un objeto',
    zh: '商品跟进更新时间必须为对象',
  },
  'Backup conflict: workflows have the same timestamp': {
    es: 'Conflicto de copia: los seguimientos tienen la misma fecha',
    zh: '备份冲突：跟进数据更新时间相同但内容不同',
  },
}
