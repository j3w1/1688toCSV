export const STORE_IMPORT_MESSAGES = {
  'Store spreadsheet guide': {
    zh: '门店表格格式指南',
    es: 'Guía de Excel de tiendas',
  },
  'Close spreadsheet guide': {
    zh: '关闭表格指南',
    es: 'Cerrar guía de Excel',
  },
  'Check import markers, filenames and review rules. This format guide does not import files or change your library.':
    {
      zh: '查看导入标记、文件命名和审核规则。本格式指南不会导入文件，也不会更改资料库。',
      es: 'Consulta los marcadores, los nombres de archivo y las reglas de revisión. Esta guía de formato no importa archivos ni cambia tu biblioteca.',
    },
  'Format guide for the proposed Store spreadsheet import. Importing files and editing their photos are not available yet; this guide does not change your library.':
    {
      zh: '本指南说明计划中的门店表格导入格式。文件导入与照片编辑尚未开放；本指南不会更改资料库。',
      es: 'Guía del formato propuesto para importar Excel de tiendas. La importación de archivos y la edición de sus fotos aún no están disponibles; esta guía no cambia tu biblioteca.',
    },
  'Spreadsheet guide sections': {
    zh: '表格指南章节',
    es: 'Secciones de la guía de Excel',
  },
  'Start here': { zh: '从这里开始', es: 'Primeros pasos' },
  'Import markers': { zh: '导入标记', es: 'Marcadores de importación' },
  'Review rules': { zh: '审核规则', es: 'Reglas de revisión' },
  'Copy import marker': {
    zh: '复制导入标记',
    es: 'Copiar marcador de importación',
  },
  'Copy filename example': {
    zh: '复制文件名示例',
    es: 'Copiar nombre de archivo',
  },
  'Name the file': { zh: '命名文件', es: 'Nombra el archivo' },
  'A numeric filename identifies a store number. A company-name filename identifies a factory without a store number. Windows copy suffixes do not change the store identity. Each import creates a new order.':
    {
      zh: '纯数字文件名代表门店号；公司名称文件名代表没有门店号的工厂。Windows 复制文件时添加的后缀不会改变门店身份。每次导入均创建新订单。',
      es: 'Un nombre numérico identifica el número de tienda. Un nombre de empresa identifica una fábrica sin número de tienda. Los sufijos de copia de Windows no cambian la tienda. Cada importación crea un pedido nuevo.',
    },
  'Same store · new orders': {
    zh: '同一门店 · 新订单',
    es: 'Misma tienda · pedidos nuevos',
  },
  'Same factory · new orders': {
    zh: '同一工厂 · 新订单',
    es: 'Misma fábrica · pedidos nuevos',
  },
  'Mark a copy of the workbook': {
    zh: '在工作簿副本中添加标记',
    es: 'Marca una copia del libro',
  },
  'Keep the seller’s original file. Add a row of import markers above the seller’s column headers. Only marked columns are included; their position does not matter.':
    {
      zh: '保留卖家的原文件，在卖家列标题上方添加一行导入标记。仅导入已标记的列；列的位置不限。',
      es: 'Conserva el archivo original del vendedor. Añade una fila de marcadores sobre sus encabezados. Solo se incluyen las columnas marcadas; su posición no importa.',
    },
  'Copy markers from the next tab. Repeat ysms for every description column to combine.':
    {
      zh: '从下一个标签页复制标记。在需要合并的每个描述列中重复填写 ysms。',
      es: 'Copia los marcadores de la siguiente pestaña. Repite ysms en cada columna de descripción que quieras combinar.',
    },
  'Give each imported row a group value. Matching group values can appear anywhere in the sheet.':
    {
      zh: '为每个需要导入的行填写 group 值。相同 group 值可以分散在工作表中的不同位置。',
      es: 'Asigna un valor group a cada fila que quieras importar. Los valores iguales pueden aparecer en cualquier parte de la hoja.',
    },
  'Mark the order total with zje on both sides, then review photos, quantities and amounts before a future import.':
    {
      zh: '在订单总金额两侧各填写 zje。未来导入时，还需要先审核照片、数量和金额。',
      es: 'Pon zje a ambos lados del importe total del pedido. Antes de una futura importación, revisa las fotos, las cantidades y los importes.',
    },
  'Click a marker to copy its exact spelling. Markers stay the same in every language.':
    {
      zh: '点击标记可复制准确拼写。所有语言均使用相同的标记。',
      es: 'Haz clic en un marcador para copiarlo exactamente. Los marcadores son iguales en todos los idiomas.',
    },
  Marker: { zh: '标记', es: 'Marcador' },
  'Meaning and requirement': {
    zh: '含义与要求',
    es: 'Significado y requisito',
  },
  'Product photos': { zh: '商品照片', es: 'Fotos del producto' },
  'Required for every imported product.': {
    zh: '每个导入商品均须提供。',
    es: 'Obligatorio para cada producto importado.',
  },
  'Product group': { zh: '商品组', es: 'Grupo de productos' },
  'Required. Repeated values join a group; a blank skips the row.': {
    zh: '必填。相同值归为一组；留空则跳过该行。',
    es: 'Obligatorio. Los valores repetidos forman un grupo; una celda vacía omite la fila.',
  },
  Cartons: { zh: '箱数', es: 'Cajas' },
  'Required. Number of cartons for this row.': {
    zh: '必填。该行商品的箱数。',
    es: 'Obligatorio. Número de cajas de esta fila.',
  },
  'Provide zxs, zsl, or both. Units inside one carton.': {
    zh: 'zxs 和 zsl 至少填写一项。一个箱内的商品件数。',
    es: 'Indica zxs, zsl o ambos. Unidades dentro de una caja.',
  },
  'Total quantity': { zh: '总数量', es: 'Cantidad total' },
  'Provide zxs, zsl, or both. Units across all cartons.': {
    zh: 'zxs 和 zsl 至少填写一项。全部箱子中的商品总件数。',
    es: 'Indica zxs, zsl o ambos. Unidades de todas las cajas.',
  },
  'Unit price': { zh: '单价', es: 'Precio unitario' },
  'Required. Price of one unit in yuan.': {
    zh: '必填。单件商品的人民币价格。',
    es: 'Obligatorio. Precio de una unidad en yuanes.',
  },
  'Product amount': { zh: '商品金额', es: 'Importe del producto' },
  'Optional. Must equal unit price × total quantity.': {
    zh: '选填。必须等于单价 × 总数量。',
    es: 'Opcional. Debe ser igual al precio unitario × cantidad total.',
  },
  'Seller description': { zh: '卖家描述', es: 'Descripción del vendedor' },
  'Optional; repeat on each description column you want to include.': {
    zh: '选填；在每个需要导入的描述列重复填写。',
    es: 'Opcional; repítelo en cada columna de descripción que quieras incluir.',
  },
  'Variant or size': { zh: '款式或尺寸', es: 'Variante o talla' },
  'Optional. Combined variants require a reviewed quantity split.': {
    zh: '选填。合并款式的数量必须经审核后拆分。',
    es: 'Opcional. Las variantes combinadas requieren revisar el reparto de cantidades.',
  },
  'Carton weight': { zh: '每箱重量', es: 'Peso por caja' },
  'Optional. Kilograms per carton, never the row total.': {
    zh: '选填。每箱千克数，不是该行的总重量。',
    es: 'Opcional. Kilogramos por caja, nunca el total de la fila.',
  },
  'Carton volume': { zh: '每箱体积', es: 'Volumen por caja' },
  'Optional. Cubic metres per carton, never the row total.': {
    zh: '选填。每箱立方米数，不是该行的总体积。',
    es: 'Opcional. Metros cúbicos por caja, nunca el total de la fila.',
  },
  'Carton dimensions': { zh: '纸箱尺寸', es: 'Medidas de la caja' },
  'Optional. Length, width and height in centimetres; all three take priority over tiji.':
    {
      zh: '选填。以厘米填写长、宽、高；三项齐全时优先用于计算体积，保留 tiji 原值。',
      es: 'Opcional. Largo, ancho y alto en centímetros; las tres medidas tienen prioridad sobre tiji.',
    },
  'Order total': { zh: '订单总金额', es: 'Total del pedido' },
  'Required twice, on either side of the seller’s whole-order total.': {
    zh: '必填两次，分别位于卖家订单总金额的左右两侧。',
    es: 'Obligatorio dos veces, a cada lado del importe total indicado por el vendedor.',
  },
  'Check quantities and prices': {
    zh: '核对数量与价格',
    es: 'Comprueba cantidades y precios',
  },
  'When both quantities are supplied, xs × zxs must equal zsl. Each product amount must equal unit price × total quantity, and the sum must match the total between the two zje markers. Mismatches must pause import and identify the affected cells; values are never silently corrected.':
    {
      zh: '两种数量都提供时，xs × zxs 必须等于 zsl。商品金额必须等于单价 × 总数量，各商品金额之和须与两个 zje 之间的总金额一致。不一致时必须暂停导入并指出具体单元格，不会自动更正数据。',
      es: 'Si se indican ambas cantidades, xs × zxs debe ser igual a zsl. Cada importe debe ser precio unitario × cantidad total y la suma debe coincidir con el total entre los dos zje. Las diferencias deben detener la importación e identificar las celdas afectadas; nunca se corrigen valores en silencio.',
    },
  'Read numbers without their units': {
    zh: '读取数字并识别单位',
    es: 'Lee los números sin sus unidades',
  },
  'Values such as 6元, 8RMB, 20.5 K.G. and 0.14 CBM describe numbers with units. Ambiguous values must be reviewed instead of guessed. Weight and volume always describe one carton.':
    {
      zh: '6元、8RMB、20.5 K.G.、0.14 CBM 等写法包含数字与单位。含义不明确的值必须审核，不得猜测。重量和体积均指单箱数据。',
      es: 'Valores como 6元, 8RMB, 20.5 K.G. y 0.14 CBM contienen números y unidades. Los valores ambiguos deben revisarse, sin adivinarlos. El peso y el volumen siempre corresponden a una caja.',
    },
  'Keep combined variants together until review': {
    zh: '合并款式须先审核再拆分',
    es: 'Revisa antes de separar variantes combinadas',
  },
  'A row marked abcd contains one combined quantity and amount for A, B, C and D. Review must ask for the actual split; it must never duplicate the totals or assume equal quantities. abs, abm and abl mean variants A and B together in sizes S, M and L respectively.':
    {
      zh: '标记 abcd 的单行包含 A、B、C、D 合计的数量与金额。审核时必须填写实际分配，不得重复总数或默认平均分配。abs、abm、abl 分别表示 A、B 两种款式合计的 S、M、L 尺寸。',
      es: 'Una fila con abcd contiene una cantidad y un importe conjuntos para A, B, C y D. La revisión debe pedir el reparto real, sin duplicar totales ni suponer cantidades iguales. abs, abm y abl representan las variantes A y B juntas en las tallas S, M y L, respectivamente.',
    },
  'Review photos before importing': {
    zh: '导入前审核照片',
    es: 'Revisa las fotos antes de importar',
  },
  'Every imported product needs a photo. Missing or uncertain row links must pause import. Shared group photos and multiple photos require review. Square thumbnails must fit without stretching, and any later photo adjustment must retain the original.':
    {
      zh: '每个导入商品均须有照片。照片缺失或所属行不明确时必须暂停导入。同组共用图片及多张图片均须审核。方形缩略图须保持原图比例，不得拉伸；后续调整也必须保留原图。',
      es: 'Cada producto importado necesita una foto. Las fotos ausentes o sin una fila clara deben detener la importación. Las fotos compartidas y las múltiples requieren revisión. Las miniaturas cuadradas deben encajar sin deformarse y cualquier ajuste posterior debe conservar el original.',
    },
  'Keep packing exceptions explicit': {
    zh: '明确记录装箱例外',
    es: 'Registra las excepciones de empaque',
  },
  'Keep the ordered quantity separate from the actual carton allocation. Do not turn loose units into fractional cartons or silently combine them with another group. Mixed cartons and unequal carton contents need a reviewed physical packing record. Additional order charges must be entered separately and explained.':
    {
      zh: '订购数量与实际装箱分配需分别记录。不得将零散件自动折算为小数箱数，或擅自与其他商品组合箱。混装箱和不同装箱数量需经过审核并记录实际装箱明细。订单附加费用必须单独填写并注明原因。',
      es: 'Registra por separado la cantidad pedida y la distribución real en cajas. No conviertas unidades sueltas en fracciones de caja ni las mezcles con otro grupo sin avisar. Las cajas mixtas y los contenidos desiguales necesitan un registro físico revisado. Los cargos adicionales del pedido deben anotarse y explicarse por separado.',
    },
  'Keep carton measurements separate': {
    zh: '分别填写纸箱尺寸与体积',
    es: 'Separa las medidas de la caja',
  },
  'tiji is a decimal volume in cubic metres, not text such as 58*35*47. Put centimetre dimensions in tijix, tijiy and tijiz. Their volume is length × width × height ÷ 1,000,000 per carton; it takes priority over the supplied decimal volume.':
    {
      zh: 'tiji 为以立方米表示的小数体积，不是 58*35*47 等尺寸文本。厘米尺寸请分别填入 tijix、tijiy、tijiz。每箱体积按长 × 宽 × 高 ÷ 1,000,000 计算，并优先于卖家填写的小数体积。',
      es: 'tiji es un volumen decimal en metros cúbicos, no texto como 58*35*47. Pon las medidas en centímetros en tijix, tijiy y tijiz. El volumen por caja es largo × ancho × alto ÷ 1,000,000 y tiene prioridad sobre el volumen decimal indicado.',
    },
  'Confirm the purchase date': {
    zh: '确认购买日期',
    es: 'Confirma la fecha de compra',
  },
  'Review must require a confirmed purchase date when the workbook has no reliable date. The filename identifies the store, not the purchase date.':
    {
      zh: '工作簿中没有可靠日期时，审核必须要求确认购买日期。文件名用于识别门店，不代表购买日期。',
      es: 'La revisión debe exigir una fecha de compra confirmada cuando el libro no tenga una fecha fiable. El nombre del archivo identifica la tienda, no la fecha de compra.',
    },
}
