// Product-type vocabulary is bundled locally. It contains generic terms only;
// titles, seller names and imported orders never become extension assets.
export const VOCABULARY_VERSION = 1

const definitions = [
  [
    'diffuser',
    '藤条扩香|无火香薰|无火扩香|香薰精油|香氛精油',
    'DIFUSOR',
    '香薰',
    80,
    '蜡烛',
  ],
  ['scented-stone', '扩香石|香薰石', 'PIEDRA AROMATICA', '香薰石', 90],
  ['candle-holder', '蜡烛台|烛台|蜡烛座', 'PORTAVELA', '烛台', 90],
  [
    'candle',
    '蜡烛|杆蜡',
    'VELA',
    '蜡烛',
    70,
    '烛台|蜡烛座|蜡烛模具|蜡烛杯空杯',
  ],
  ['incense', '线香|塔香|盘香', 'INCIENSO', '香', 70],
  ['incense-holder', '香炉|香插|香托', 'PORTAINCIENSO', '香炉', 90],
  [
    'artificial-flower',
    '仿真花|假花|仿真植物|假植物|仿真绿植',
    'FLOR ARTIFICIAL',
    '仿真花',
    60,
  ],
  [
    'dried-flower',
    '干花|干燥花',
    'FLOR SECA',
    '干花',
    50,
    '仿真花|假花|花瓶|花器|花盆|收纳袋',
  ],
  [
    'flower-basket',
    '插花篮|编织花篮|藤编花篮|花艺花篮',
    'CANASTA PARA FLORES',
    '花篮',
    75,
  ],
  ['plant-stand', '花盆架|盆栽架|花架', 'SOPORTE PARA MACETA', '花架', 80],
  ['flower-pot', '花盆|花钵', 'MACETA', '花盆', 60, '花盆架|花架|仿真花|假花'],
  [
    'vase',
    '花瓶|花器|插花瓶',
    'FLORERO',
    '花瓶',
    65,
    '仿真花|假花|花盆架|香薰',
  ],
  ['ornament', '雕塑|雕像|摆件|摆饰|装饰品', 'ADORNO', '装饰品', 10],
  ['keyring', '钥匙扣|钥匙链|钥匙圈', 'LLAVERO', '钥匙扣', 80],
  ['blackboard', '黑板|留言板', 'PIZARRA', '黑板', 65, '黑板笔|白板笔'],
  ['picture-frame', '相框|画框', 'PORTARRETRATO', '相框', 70],
  [
    'mirror',
    '镜子|化妆镜|梳妆镜|穿衣镜|试衣镜|浴室镜|洗漱镜',
    'ESPEJO',
    '镜子',
    70,
  ],
  ['piggy-bank', '存钱罐|储蓄罐|储钱罐', 'ALCANCIA', '储蓄罐', 80],
  ['napkin-ring', '餐巾环|餐巾扣', 'ARO PARA SERVILLETA', '餐巾环', 80],
  ['photo-clip', '照片夹|便签座|桌卡夹|名片夹', 'PORTANOTAS', '便签夹', 75],
  [
    'pet-bowl',
    '猫碗|狗碗|狗盆|宠物碗|猫食盆|狗食盆|宠物食盆',
    'PLATO PARA MASCOTA',
    '宠物餐具',
    90,
  ],
  [
    'pet-toy',
    '逗猫棒|逗猫玩具|猫咪玩具|猫薄荷球|宠物玩具|狗狗玩具',
    'JUGUETE PARA MASCOTA',
    '宠物玩具',
    90,
  ],
  [
    'pet-brush',
    '猫梳|宠物梳|撸猫|宠物毛刷|狗梳',
    'CEPILLO PARA MASCOTA',
    '宠物用品',
    90,
  ],
  ['pet-bed', '猫窝|狗窝|宠物窝|宠物床', 'CAMA PARA MASCOTA', '宠物用品', 90],
  ['pet-leash', '牵引绳|宠物项圈|狗链', 'CORREA PARA MASCOTA', '宠物用品', 90],
  [
    'pet-clothes',
    '宠物衣服|宠物服装|狗狗衣服|猫咪衣服',
    'ROPA PARA MASCOTA',
    '宠物服装',
    90,
  ],
  ['soap-dish', '肥皂盒|香皂盒|皂盒|香皂托', 'JABONERA', '皂盒', 85],
  [
    'soap-dispenser',
    '皂液盒|皂液器|洗手液瓶|起泡瓶|乳液瓶',
    'DISPENSADOR DE JABON',
    '皂液器',
    85,
  ],
  [
    'toothpaste-dispenser',
    '挤牙膏器|牙膏挤压器',
    'DISPENSADOR DE PASTA',
    '牙膏器',
    85,
  ],
  [
    'toothbrush-holder',
    '牙刷架|牙刷收纳|牙刷筒',
    'PORTACEPILLOS',
    '牙刷架',
    80,
  ],
  ['toilet-brush', '马桶刷|厕所刷', 'ESCOBILLA DE BANO', '马桶刷', 90],
  [
    'cleaning-brush',
    '清洁刷|洗衣刷|洗鞋刷|洗碗刷|锅刷|床刷|除尘刷',
    'CEPILLO DE LIMPIEZA',
    '清洁刷',
    70,
  ],
  [
    'cleaning-sponge',
    '海绵擦|海绵百洁|百洁布|魔力擦|海绵块|洗碗海绵',
    'ESPONJA',
    '清洁海绵',
    75,
  ],
  [
    'cleaning-cloth',
    '抹布|洗碗布|洗碗巾|清洁布|擦车巾|擦车布',
    'PANO DE LIMPIEZA',
    '清洁布',
    70,
  ],
  ['bath-towel', '浴巾|浴裙|浴袍', 'TOALLA DE BANO', '浴巾', 75],
  ['hair-towel', '干发巾|干发帽|擦发巾', 'TOALLA PARA CABELLO', '干发巾', 80],
  [
    'towel',
    '毛巾|洗脸巾|面巾|运动巾|擦手巾',
    'TOALLA',
    '毛巾',
    50,
    '毛巾架|毛巾钩|浴巾|浴袍|干发巾|宠物',
  ],
  ['towel-rack', '毛巾架|毛巾挂架|抹布架', 'TOALLERO', '毛巾架', 85],
  ['shower-cap', '浴帽', 'GORRO DE BANO', '浴帽', 65, '干发'],
  ['bath-tub', '浴桶|澡桶|浴缸|沐浴盆|洗澡盆', 'BANERA', '浴盆', 70],
  [
    'bath-sponge',
    '沐浴球|浴花|洗澡球|搓澡巾|搓背',
    'ESPONJA DE BANO',
    '沐浴用品',
    75,
  ],
  [
    'rubber-glove',
    '洗碗手套|乳胶手套|橡胶手套|清洁手套|牛筋手套',
    'GUANTES DE LIMPIEZA',
    '手套',
    75,
  ],
  ['disposable-glove', '一次性手套', 'GUANTES DESECHABLES', '手套', 85],
  [
    'oven-glove',
    '烤箱手套|微波炉手套|隔热手套',
    'GUANTES DE COCINA',
    '隔热手套',
    85,
  ],
  ['apron', '围裙|围腰', 'DELANTAL', '围裙', 70],
  ['rug', '地毯|地垫|门垫|脚垫|防滑垫', 'ALFOMBRA', '地毯', 55],
  [
    'placemat',
    '餐垫|餐桌垫|杯垫|隔热垫|锅垫|碗垫|盘垫',
    'INDIVIDUAL',
    '餐垫',
    75,
  ],
  [
    'tablecloth',
    '桌布|台布|餐桌布',
    'MANTEL',
    '桌布',
    60,
    '擦桌布|清洁布|抹布',
  ],
  ['curtain', '窗帘|门帘|浴帘', 'CORTINA', '窗帘', 60],
  ['pillow', '枕头|枕芯|夹腿枕|腿枕|护颈枕|睡眠枕', 'ALMOHADA', '枕头', 70],
  ['cushion', '抱枕|靠垫|坐垫|椅垫', 'COJIN', '靠垫', 60],
  ['blanket', '毛毯|盖毯|绒毯|午睡毯', 'MANTA', '毯子', 60],
  ['slipper', '拖鞋|凉拖', 'SANDALIAS', '拖鞋', 65, '拖鞋架'],
  ['cap', '棒球帽|鸭舌帽', 'GORRA', '帽子', 75],
  [
    'hat',
    '草帽|遮阳帽|太阳帽|渔夫帽|沙滩帽|帽子|防晒帽',
    'SOMBRERO',
    '帽子',
    60,
    '帽子吊牌|帽子挂钩|挂钩',
  ],
  [
    'hanger',
    '衣架|衣裤挂|晒架',
    'COLGADOR DE ROPA',
    '衣架',
    65,
    '衣架夹|晾衣夹',
  ],
  [
    'clothespin',
    '晾衣夹|衣服夹|晒衣夹|棉被夹|晾晒夹',
    'GANCHO DE ROPA',
    '衣夹',
    80,
  ],
  ['laundry-bag', '洗衣袋|护洗袋|洗衣网袋', 'BOLSA PARA LAVAR', '洗衣袋', 85],
  [
    'laundry-basket',
    '脏衣篮|洗衣篮|脏衣筐|洗衣篓',
    'CESTA DE ROPA',
    '洗衣篮',
    85,
  ],
  [
    'garment-cover',
    '衣物套|衣服防尘罩|防尘衣罩|衣物防尘',
    'FUNDA PARA ROPA',
    '衣物防尘罩',
    85,
  ],
  ['shoe-rack', '鞋架|鞋柜', 'ZAPATERA', '鞋架', 80],
  [
    'storage-bag',
    '收纳袋|收纳挂袋|储物袋|整理袋',
    'BOLSA ORGANIZADORA',
    '收纳袋',
    65,
  ],
  [
    'storage-basket',
    '收纳篮|收纳筐|储物筐|置物篮|置物筐|洗漱篮|洗浴篮',
    'CESTA ORGANIZADORA',
    '收纳篮',
    60,
  ],
  [
    'storage-box',
    '收纳盒|收纳箱|储物盒|储物箱|整理盒|整理箱|分隔盒',
    'CAJA ORGANIZADORA',
    '收纳盒',
    40,
  ],
  [
    'tissue-box',
    '纸巾盒|抽纸盒|纸抽盒|餐巾纸盒',
    'PORTAPANUELOS',
    '纸巾盒',
    85,
  ],
  [
    'jewelry-organizer',
    '首饰收纳|首饰盒|首饰展示架|耳环挂架|饰品展示架',
    'ORGANIZADOR DE JOYAS',
    '首饰盒',
    75,
  ],
  [
    'cosmetic-organizer',
    '化妆品收纳|口红收纳|面膜收纳',
    'ORGANIZADOR DE COSMETICOS',
    '化妆品收纳盒',
    65,
    '笔筒|镜子|化妆镜',
  ],
  ['shelf', '置物架|收纳架|储物架|隔板架|书架', 'ESTANTE', '置物架', 35],
  ['hook', '挂钩|粘钩|无痕钩|排钩', 'GANCHO', '挂钩', 50, '胶针|吊牌枪针'],
  [
    'cable-organizer',
    '理线器|束线带|绕线器|扎带|扎线带|电线固定夹',
    'ORGANIZADOR DE CABLES',
    '理线器',
    80,
  ],
  [
    'phone-holder',
    '手机支架|手机充电支架|平板支架',
    'SOPORTE PARA CELULAR',
    '手机支架',
    85,
  ],
  [
    'hairdryer-holder',
    '吹风机架|电吹风架|风筒架',
    'SOPORTE PARA SECADORA',
    '吹风机架',
    85,
  ],
  [
    'food-container',
    '保鲜盒|葱花盒|蛋糕盒|饭盒|便当盒',
    'RECIPIENTE DE COCINA',
    '保鲜盒',
    70,
  ],
  [
    'egg-container',
    '鸡蛋盒|鸡蛋收纳|蛋托|蛋架',
    'ORGANIZADOR DE HUEVOS',
    '鸡蛋盒',
    85,
  ],
  ['rice-container', '米桶|储米罐|储米箱', 'RECIPIENTE PARA ARROZ', '米桶', 85],
  [
    'storage-jar',
    '密封罐|储物罐|收纳罐|茶叶罐|玻璃罐',
    'FRASCO',
    '储物罐',
    65,
    '调味|调料|存钱|储蓄',
  ],
  ['oil-bottle', '油壶|油瓶|醋瓶|醋壶|酱油瓶', 'ACEITERA', '油壶', 80],
  [
    'seasoning-container',
    '调味罐|调料罐|调味盒|调料盒|调味瓶|调料瓶',
    'ESPECIERO',
    '调料罐',
    70,
  ],
  ['spice-grinder', '研磨器|胡椒磨', 'MOLINILLO', '研磨器', 90],
  ['travel-bottle', '分装瓶|喷雾瓶|补水喷瓶', 'FRASCO DE VIAJE', '分装瓶', 80],
  [
    'water-bottle',
    '水壶|凉水壶|冷水壶|玻璃壶',
    'JARRA',
    '水壶',
    60,
    '电水壶|除垢|清洗剂|喷水壶',
  ],
  ['teapot', '茶壶|泡茶壶', 'TETERA', '茶壶', 70],
  [
    'thermal-cup',
    '保温杯|保温壶|保温瓶',
    'VASO TERMICO',
    '保温杯',
    70,
    '清洁刷|刷子',
  ],
  [
    'cup',
    '玻璃杯|水杯|杯子|饮杯|马克杯|茶杯|咖啡杯|奶茶杯|啤酒杯|酒杯',
    'VASO',
    '杯子',
    50,
    '蜡烛|香薰|清洁刷|杯架|杯盖|防尘盖|保鲜盖|杯垫',
  ],
  [
    'measuring-jug',
    '量杯|量勺|计量勺|量匙|刻度勺',
    'MEDIDOR DE COCINA',
    '量具',
    80,
    '送量杯',
  ],
  [
    'bowl',
    '碗|汤盆',
    'TAZON',
    '碗',
    25,
    '洗碗|碗架|碗柜|碗碟架|碗筷收纳|碗碟收纳|碗垫|碗盖',
  ],
  [
    'plate',
    '盘子|餐盘|菜盘|果盘|果碟|味碟|酱汁碟|骨碟|小食碟|小菜碟|小吃碟',
    'PLATO',
    '盘子',
    50,
  ],
  ['tray', '托盘|茶盘', 'BANDEJA', '托盘', 55, '带托盘|带底托|镜子|化妆镜'],
  [
    'dish-rack',
    '沥水碗架|碗碟架|碗筷收纳|碗碟收纳|沥水架',
    'ESCURRIDOR',
    '沥水架',
    70,
  ],
  [
    'cutlery-holder',
    '筷子筒|筷子笼|筷子篓|筷笼|筷子架|餐具收纳',
    'PORTACUBIERTOS',
    '筷子筒',
    80,
  ],
  ['knife-holder', '刀架|刀具架|锅盖架', 'ORGANIZADOR DE COCINA', '厨具架', 75],
  ['colander', '沥水篮|洗菜篮|洗菜盆|淘菜盆|滤水篮', 'COLADOR', '沥水篮', 75],
  ['food-strainer', '面粉筛|过滤网|漏勺|滤网|筛子', 'COLADOR', '滤网', 70],
  ['grater', '切菜器|切丝器|刨丝器|擦丝器|切片器', 'RALLADOR', '切菜器', 85],
  ['peeler', '削皮刀|削皮器|去皮器|瓜果刨', 'PELADOR', '削皮器', 85],
  ['fish-scaler', '鱼鳞器|鱼鳞刨', 'DESCAMADOR', '鱼鳞器', 85],
  ['scissors', '剪刀|剪子|剪骨刀', 'TIJERA', '剪刀', 75],
  [
    'kitchen-set',
    '厨具套装|铲勺套装|烹饪套装',
    'UTENSILIOS DE COCINA',
    '厨具',
    90,
  ],
  ['whisk', '打蛋器|手动搅拌器', 'BATIDOR', '打蛋器', 85],
  ['ladle', '水勺|水舀|水瓢|汤勺|汤匙', 'CUCHARON', '汤勺', 65],
  [
    'spatula',
    '锅铲|抹刀|饭铲|硅胶铲',
    'ESPATULA',
    '锅铲',
    65,
    '收纳|置物|厨具套装',
  ],
  [
    'chopsticks',
    '筷子',
    'PALILLOS',
    '筷子',
    25,
    '收纳|置物|筷子筒|筷子笼|筷子篓|筷子架',
  ],
  [
    'cutlery',
    '刀叉|勺子|西餐刀|西餐叉|叉子',
    'CUBIERTO',
    '餐具',
    30,
    '收纳|置物|带勺|含勺|筷子筒|筷子笼|筷子篓|筷子架',
  ],
  [
    'food-cover',
    '保鲜盖|碗盖|防尘盖|食品罩|菜罩',
    'TAPA DE COCINA',
    '保鲜盖',
    85,
  ],
  ['food-wrap', '保鲜膜|食品膜', 'FILM DE COCINA', '保鲜膜', 80],
  [
    'baking-paper',
    '硅油纸|烘焙纸|锡纸|铝箔纸',
    'PAPEL PARA HORNEAR',
    '烘焙纸',
    80,
  ],
  ['bag-clip', '密封夹|封口夹|封袋夹|保鲜夹', 'CLIP PARA BOLSA', '封口夹', 85],
  [
    'garbage-bag',
    '垃圾袋|拉圾袋',
    'BOLSA DE BASURA',
    '垃圾袋',
    65,
    '收纳盒|收集器',
  ],
  ['garbage-bin', '垃圾桶|垃圾篓', 'TACHO DE BASURA', '垃圾桶', 75],
  ['cleaner', '清洁剂|除垢剂|清洗剂|疏通剂|油污剂', 'LIMPIADOR', '清洁剂', 85],
  ['mop', '拖把|拖布', 'TRAPEADOR', '拖把', 70],
  ['broom', '扫把|扫帚|簸箕', 'ESCOBA', '扫把', 70],
  ['squeegee', '刮水器|玻璃刮|擦窗器', 'LIMPIAVIDRIOS', '玻璃清洁器', 80],
  ['water-filter', '净水器|净水机|滤水器', 'FILTRO DE AGUA', '净水器', 80],
  [
    'hairbrush',
    '梳子|发梳|气垫梳|按摩梳',
    'CEPILLO DE CABELLO',
    '梳子',
    65,
    '猫梳|宠物|狗梳',
  ],
  [
    'hair-accessory',
    '发夹|发箍|发圈|头绳|头箍|发带',
    'ACCESORIO DE CABELLO',
    '发饰',
    55,
  ],
  [
    'makeup-brush',
    '化妆刷|粉底刷|腮红刷',
    'BROCHA DE MAQUILLAJE',
    '化妆刷',
    65,
    '收纳|笔筒|刷桶',
  ],
  [
    'makeup-sponge',
    '美妆蛋|粉扑|化妆棉',
    'ESPONJA DE MAQUILLAJE',
    '化妆用品',
    75,
  ],
  ['nail-clipper', '指甲剪|指甲钳', 'CORTAUNAS', '指甲剪', 75],
  ['comb-case', '笔袋|文具盒|笔盒', 'CARTUCHERA', '笔袋', 60, '笔筒'],
  ['pen-holder', '笔筒|收纳筒', 'PORTALAPICES', '笔筒', 75],
  [
    'marker',
    '记号笔|白板笔|黑板笔|灯板笔|标记笔|液体粉笔',
    'MARCADOR',
    '记号笔',
    80,
  ],
  [
    'notebook',
    '笔记本|记事本|绘画本|素描本|线圈本|涂鸦本',
    'CUADERNO',
    '笔记本',
    70,
    '电脑|内存|硬盘|处理器',
  ],
  [
    'sticky-notes',
    '便利贴|便签纸|记事贴|留言贴',
    'NOTAS ADHESIVAS',
    '便签纸',
    75,
  ],
  [
    'binder-clip',
    '燕尾夹|长尾夹|凤尾夹|铁票夹',
    'CLIP DE OFICINA',
    '长尾夹',
    80,
  ],
  [
    'sign-holder',
    '亚克力台卡|台卡|餐牌|酒水牌|标牌架',
    'PORTALETRERO',
    '标牌架',
    75,
  ],
  [
    'label',
    '不干胶标签|条码纸|热敏标签|标签纸|吊牌|吊卡',
    'ETIQUETA',
    '标签',
    65,
    '枪针|胶针|打印机',
  ],
  [
    'thermal-paper',
    '热敏纸|收银纸|小票纸|收银打印纸|打印机纸',
    'PAPEL TERMICO',
    '热敏纸',
    70,
  ],
  [
    'tag-fastener',
    '胶针|吊牌枪针|吊牌针|胶钉',
    'SUJETADOR DE ETIQUETA',
    '胶针',
    85,
  ],
  [
    'tape',
    '胶带|双面胶|透明胶',
    'CINTA ADHESIVA',
    '胶带',
    65,
    '含双面胶|带双面胶',
  ],
  ['sewing-kit', '针线盒|针线包|缝补工具', 'COSTURERO', '针线盒', 80],
  ['screwdriver', '螺丝刀', 'DESTORNILLADOR', '螺丝刀', 80],
  [
    'garden-tools',
    '园艺工具|园林工具|花园工具',
    'HERRAMIENTAS DE JARDIN',
    '园艺工具',
    80,
  ],
  [
    'beekeeping',
    '养蜂|摇蜜机|巢础机|蜂蜜分离机',
    'EQUIPO DE APICULTURA',
    '养蜂工具',
    90,
  ],
  [
    'backpack',
    '背包|双肩包|书包',
    'MOCHILA',
    '背包',
    40,
    '钥匙扣|钥匙链|挂饰|挂件',
  ],
  ['wallet', '钱包|零钱包|卡包|证件包', 'MONEDERO', '钱包', 55, '钥匙扣|挂件'],
  ['bag', '手提包|手挎包|购物袋|购物包|帆布包', 'BOLSA', '包', 50],
  [
    'eyewear-chain',
    '眼镜链|口罩链|口罩带挂链',
    'CADENA PARA GAFAS',
    '眼镜链',
    80,
  ],
  ['umbrella', '雨伞|遮阳伞|晴雨伞', 'PARAGUAS', '雨伞', 70],
  [
    'plush-toy',
    '毛绒玩具|毛绒玩偶|布娃娃|毛绒公仔|毛绒',
    'PELUCHE',
    '毛绒玩具',
    65,
    '地毯|地垫|拖鞋|发箍',
  ],
  [
    'toy',
    '玩具|玩偶|公仔|娃娃',
    'JUGUETE',
    '玩具',
    25,
    '钥匙扣|钥匙链|挂饰|收纳|储物|饰品',
  ],
  [
    'building-blocks',
    '积木|拼图',
    'ROMPECABEZAS',
    '积木',
    60,
    '钥匙链|钥匙扣|收纳|相框|画框',
  ],
  ['light-bulb', '灯泡|球泡灯|球泡', 'FOCO', '灯泡', 75],
  [
    'mosquito-light',
    '灭蚊灯|捕蚊灯|驱蚊灯',
    'LAMPARA ANTIMOSQUITOS',
    '灭蚊灯',
    85,
  ],
  ['night-light', '小夜灯|台灯|床头灯', 'LAMPARA', '灯具', 65],
  ['string-light', '灯串|彩灯|串灯', 'LUCES DECORATIVAS', '彩灯', 70],
  ['printer', '打印机', 'IMPRESORA', '打印机', 70, '打印机纸|打印机配件'],
  ['scanner', '扫码枪|扫描枪|条码扫描', 'LECTOR DE CODIGOS', '扫描枪', 80],
  ['network-switch', '交换机', 'SWITCH DE RED', '网络设备', 70, '路由器'],
  ['router', '路由器|无线网关', 'ROUTER', '网络设备', 80],
  [
    'access-point',
    '无线吸顶AP|无线AP|WiFi6全屋',
    'PUNTO DE ACCESO',
    '网络设备',
    75,
  ],
  ['mouse-pad', '鼠标垫', 'PAD DE MOUSE', '鼠标垫', 80],
  ['christmas-stocking', '圣诞袜', 'BOTA NAVIDENA', '圣诞袜', 85],
  [
    'christmas-tree',
    '圣诞树|小圣树',
    'ARBOL NAVIDENO',
    '圣诞树',
    40,
    '蜡烛|圣诞袜|挂件|挂饰|耳环',
  ],
  ['metal-wall-art', '铁皮画|铁艺壁画', 'CUADRO METALICO', '铁皮画', 85],
  ['wood-slice', '木片|木制片', 'RODAJA DE MADERA', '木片', 70],
  [
    'bottle-cover',
    '酒瓶套|红酒套|酒瓶袋|酒袋',
    'FUNDA PARA BOTELLA',
    '酒瓶套',
    80,
  ],
  ['toiletry-bag', '洗漱包|化妆包', 'NECESER', '化妆包', 85],
  ['greeting-card', '贺卡|祝福卡|感谢卡|誓词卡', 'TARJETA', '贺卡', 80],
  ['postcard', '明信片', 'POSTAL', '明信片', 75, '夹子|相片夹'],
  ['bedding', '被套|床单|床盖|床褥', 'ROPA DE CAMA', '床上用品', 80],
  ['scarf', '围巾|丝巾|围脖|披肩', 'BUFANDA', '围巾', 70],
  [
    'winter-gloves',
    '保暖手套|针织手套|触屏手套|分指手套',
    'GUANTES',
    '手套',
    75,
  ],
  ['side-table', '边几|角几|小圆几|床头柜', 'MESA AUXILIAR', '边几', 70],
  ['mortar', '石臼|蒜臼|擂臼|捣蒜器', 'MORTERO', '石臼', 85],
  ['bread-basket', '面包篮|水果篮|整理篮', 'CANASTA', '篮子', 70],
  ['mask-brush', '面膜刷|面膜棒', 'BROCHA PARA MASCARILLA', '面膜刷', 85],
  [
    'sticker',
    '贴纸|贴画|不干胶',
    'ETIQUETA ADHESIVA',
    '贴纸',
    45,
    '送贴纸|黑板贴',
  ],
  ['gift-wrap', '包装纸|礼品纸|包书纸|礼物纸', 'PAPEL DE REGALO', '包装纸', 85],
  ['compression-bag', '压缩袋', 'BOLSA AL VACIO', '压缩袋', 85],
  [
    'price-display',
    '标价牌|价格牌|价格标签|价格展示牌|标签夹|标价框|价签|价格条|标价条',
    'PORTAPRECIO',
    '标价牌',
    85,
  ],
  ['ice-bag', '冰袋|冰敷袋|冷热敷袋', 'BOLSA DE HIELO', '冰袋', 85],
  ['automatic-umbrella', '晴雨两用|自动伞|环扣伞', 'PARAGUAS', '雨伞', 75],
  ['litter-box', '猫砂盆|猫厕所', 'ARENERO', '猫砂盆', 95],
  [
    'photo-clothespin',
    '相片夹|留言夹|照片挂墙|照片墙夹子|木质小夹子|木制小夹子',
    'PINZA DECORATIVA',
    '照片夹',
    70,
  ],
  ['duster', '鸡毛掸子|除尘掸子|掸子', 'PLUMERO', '掸子', 75],
  [
    'planner',
    '便签本|计划本|日程本|单词本|草稿本|拍纸本',
    'CUADERNO',
    '笔记本',
    75,
  ],
  ['door-seal', '门缝条|门底密封条|门缝贴', 'BURLETE', '门缝密封条', 85],
  ['chair-cover', '椅子套|凳子套|椅套', 'FUNDA PARA SILLA', '椅套', 85],
  [
    'faucet-filter',
    '水龙头防溅|净水防溅',
    'FILTRO PARA GRIFO',
    '水龙头过滤器',
    85,
  ],
  [
    'glass-bottle',
    '玻璃瓶|泡酒瓶|泡酒坛|泡酒空瓶',
    'BOTELLA DE VIDRIO',
    '玻璃瓶',
    65,
    '香薰|香氛|精油|分装|喷雾|调料|调味',
  ],
  ['cutting-board', '菜板|砧板|案板', 'TABLA DE COCINA', '砧板', 80],
  ['stool', '凳子|板凳|圆凳|马桶凳|垫脚凳', 'BANCO', '凳子', 70, '套罩|凳子套'],
  [
    'pet-shoes',
    '狗狗鞋|宠物外出鞋|宠物鞋',
    'ZAPATOS PARA MASCOTA',
    '宠物鞋',
    95,
  ],
  ['pet-scratcher', '猫抓板|猫抓垫|猫爬架', 'RASCADOR PARA GATO', '猫抓板', 95],
  ['pet-mat', '宠物垫|狗狗垫子|狗垫', 'COLCHONETA PARA MASCOTA', '宠物垫', 95],
  ['blackboard-sticker', '黑板贴|黑板不干胶', 'ETIQUETA PIZARRA', '黑板贴', 85],
  [
    'decorative-stone',
    '水晶碎石|水晶原料|消磁石|净化石',
    'PIEDRA DECORATIVA',
    '装饰石',
    80,
  ],
  ['lint-roller', '粘毛器|黏毛滚|除毛筒|除毛刷', 'QUITAPELUSAS', '粘毛器', 85],
  [
    'pet-comb',
    '宠物梳|宠物除毛梳|宠物脱毛梳|宠物电动|猫咪除蚤梳|开结梳',
    'CEPILLO PARA MASCOTA',
    '宠物用品',
    95,
  ],
  ['basting-brush', '油刷|烧烤刷|烘焙硅胶刷', 'BROCHA DE COCINA', '油刷', 80],
  ['food-bag', '密封袋|保鲜袋|自封袋|密实袋', 'BOLSA HERMETICA', '密封袋', 80],
  ['pill-box', '药盒', 'PASTILLERO', '药盒', 85],
  ['ribbon', '丝带|织带|缎带', 'CINTA DECORATIVA', '丝带', 60],
  ['drinking-straw', '玻璃吸管|喝水吸管|饮管', 'SORBETE', '吸管', 80],
  ['floor-brush', '地板刷|洗地刷|地缝隙刷', 'CEPILLO PARA PISO', '地板刷', 80],
  ['pushpin', '图钉|工字钉', 'CHINCHE', '图钉', 85],
  ['gift-bag', '礼品袋|礼物袋', 'BOLSA DE REGALO', '礼品袋', 65, '圣诞袜'],
  [
    'hot-water-bag',
    '热水袋|暖水袋|暖水热敷',
    'BOLSA DE AGUA CALIENTE',
    '热水袋',
    85,
  ],
  [
    'phone-waterproof-pouch',
    '手机防水袋|手机防水套',
    'FUNDA PARA CELULAR',
    '手机防水袋',
    85,
  ],
  ['garlic-press', '压蒜器|蒜蓉器', 'PRENSADOR DE AJO', '压蒜器', 85],
  ['pencil', '铅笔|彩铅', 'LAPIZ', '铅笔', 75],
  ['highlighter', '荧光笔', 'RESALTADOR', '荧光笔', 80],
  ['pen', '中性笔|签字笔', 'LAPICERO', '笔', 70],
  ['floss', '牙线', 'HILO DENTAL', '牙线', 85],
  ['insole', '鞋垫', 'PLANTILLA', '鞋垫', 85],
  ['foot-bath', '泡脚桶|泡脚盆|足浴盆|洗脚盆', 'TINA PARA PIES', '足浴盆', 85],
  ['shaving-razor', '刮毛刀|剃毛刀|剃毛器', 'RASURADORA', '剃毛刀', 85],
  [
    'drain-tool',
    '管道四爪钩|下水道疏通器|管道疏通器',
    'DESTAPADOR DE DESAGUE',
    '管道疏通器',
    85,
  ],
  ['glue', '胶水|焊接剂', 'PEGAMENTO', '胶水', 80],
  ['passport-case', '护照夹|护照包', 'PORTAPASAPORTE', '护照夹', 80],
  [
    'back-scratcher',
    '痒痒挠|抓痒|挠背|抓背',
    'RASCADOR DE ESPALDA',
    '痒痒挠',
    80,
  ],
  [
    'wardrobe',
    '衣柜|衣橱|储物柜',
    'ARMARIO',
    '柜子',
    15,
    '收纳|整理|挂钩|隔板|衣架|挂架',
  ],
]

export const DEFAULT_VOCABULARY = Object.freeze(
  definitions.map(
    ([seed, match, spanishName, category, priority, exclude = '']) =>
      Object.freeze({
        seed,
        match,
        spanishName,
        category,
        priority,
        ...(exclude ? { exclude } : {}),
      })
  )
)

const defaults = new Map(DEFAULT_VOCABULARY.map((entry) => [entry.seed, entry]))
const nameFields = ['spanishName', 'category']
const normalized = (value) =>
  value.normalize('NFKC').toLocaleLowerCase('en').trim()
const terms = (value) => value.split('|').map(normalized).filter(Boolean)

/** Seed once. Later removal of a default or an intentionally empty list persists. */
export function initializeVocabulary(preferences) {
  if (preferences.settings.vocabularyVersion === VOCABULARY_VERSION)
    return preferences
  const vocabulary = structuredClone(preferences.vocabulary)
  const existingSeeds = new Set(vocabulary.map((entry) => entry.seed))
  if (!preferences.settings.vocabularyInitialized)
    for (const entry of DEFAULT_VOCABULARY)
      if (!existingSeeds.has(entry.seed)) vocabulary.push({ ...entry })
  return {
    ...preferences,
    settings: {
      ...preferences.settings,
      vocabularyInitialized: true,
      vocabularyVersion: VOCABULARY_VERSION,
    },
    vocabulary,
  }
}

/** An edited seeded rule becomes a user override, including its exclusions. */
export function vocabularyEntryMetadata(entry) {
  const original = defaults.get(entry.seed)
  if (
    original &&
    ['match', 'spanishName', 'category', 'exclude'].every(
      (key) => (entry[key] ?? '') === (original[key] ?? '')
    ) &&
    (entry.priority ?? 0) === original.priority
  )
    return { seed: original.seed, priority: original.priority }
  return {}
}

function agreed(entries, field) {
  const values = [
    ...new Set(entries.map((entry) => entry[field]?.trim()).filter(Boolean)),
  ]
  return values.length === 1 ? values[0] : ''
}

/** Literal alternatives only: no user regular expressions or remote inference. */
export function createNameSuggester(vocabulary = DEFAULT_VOCABULARY) {
  const rules = vocabulary.map((entry) => ({
    ...entry,
    spanishName: (entry.spanishName ?? '').trim().toUpperCase(),
    category: (entry.category ?? '').trim(),
    terms: terms(entry.match),
    exclusions: terms(entry.exclude ?? ''),
  }))
  const cache = new Map()
  return (title) => {
    const source = normalized(title)
    if (cache.has(source)) return { ...cache.get(source) }
    const matches = rules.filter(
      (entry) =>
        entry.terms.some((term) => source.includes(term)) &&
        !entry.exclusions.some((term) => source.includes(term))
    )
    const overrides = matches.filter((entry) => !entry.seed)
    const priority = Math.max(0, ...matches.map((entry) => entry.priority ?? 0))
    const best = overrides.length
      ? overrides
      : matches.filter((entry) => entry.priority === priority)
    const spanishName = agreed(best, 'spanishName')
    const category = agreed(best, 'category')
    const result = {
      spanishName,
      category,
      status:
        spanishName && category
          ? 'matched'
          : matches.length
            ? 'ambiguous'
            : 'unknown',
    }
    cache.set(source, result)
    return { ...result }
  }
}

export function suggestProductNames(title, vocabulary = DEFAULT_VOCABULARY) {
  return createNameSuggester(vocabulary)(title)
}

/** A derived cache, separate from imported amounts and code allocations. */
export function orderNamingSuggestions(snapshot, suggest) {
  const groups = new Map()
  for (const item of snapshot.items) {
    const title = (item.title || item.description).trim()
    let group = groups.get(title)
    if (!group) {
      group = { title, ...suggest(title), entryIds: [] }
      groups.set(title, group)
    }
    group.entryIds.push(item.entryId)
  }
  return { version: VOCABULARY_VERSION, groups: [...groups.values()] }
}

export function automaticNaming(suggestion) {
  return Object.fromEntries(
    nameFields.map((field) => [
      field,
      { source: 'automatic', value: suggestion[field] },
    ])
  )
}

/** Only explicit edits change authorship. Automatic refreshes bypass this helper. */
export function recordNamingEdits(preparation, previous) {
  const previousGroups = new Map(
    previous?.groups.map((group) => [group.id, group])
  )
  return {
    ...preparation,
    groups: preparation.groups.map((group) => {
      const old = previousGroups.get(group.id)
      const naming = { ...group.naming }
      for (const field of nameFields) {
        const provenance = naming[field]
        if (
          (old && old[field] !== group[field]) ||
          (provenance && provenance.value !== group[field]) ||
          (!provenance && group[field])
        )
          naming[field] = { source: 'manual', value: group[field] }
      }
      return Object.keys(naming).length ? { ...group, naming } : group
    }),
  }
}

/** Compare authored preparation independently of derived names and write revisions. */
export function preparationAuthoring(preparation) {
  const { revision, ...content } = preparation
  return {
    ...content,
    groups: preparation.groups.map(({ naming, ...group }) => {
      const result = { ...group }
      for (const field of nameFields) {
        const provenance = naming?.[field]
        const automatic = provenance
          ? provenance.source === 'automatic' &&
            provenance.value === group[field]
          : !group[field]
        result[field] = automatic
          ? { source: 'automatic' }
          : { source: 'manual', value: group[field] }
      }
      return result
    }),
  }
}

/** Passive refresh preserves saved automatic values; rule changes may replace them. */
export function refreshPreparationNames(
  preparation,
  suggest,
  { replaceAutomatic = true } = {}
) {
  let changed = false
  const groups = preparation.groups.map((group) => {
    const result = { ...group, naming: { ...group.naming } }
    const suggestion = suggest(group.title)
    for (const field of nameFields) {
      const provenance = group.naming?.[field]
      if (provenance?.source === 'manual') continue
      if (
        provenance?.source === 'automatic' &&
        provenance.value !== group[field]
      ) {
        result.naming[field] = { source: 'manual', value: group[field] }
      } else if (
        (provenance && replaceAutomatic) ||
        (!provenance && !group[field])
      ) {
        result[field] = suggestion[field]
        result.naming[field] = { source: 'automatic', value: suggestion[field] }
      }
    }
    if (!Object.keys(result.naming).length) delete result.naming
    if (JSON.stringify(group) !== JSON.stringify(result)) changed = true
    return result
  })
  return changed ? { ...preparation, groups } : preparation
}
