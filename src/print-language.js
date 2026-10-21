/** Generated print text only. Seller names, custom label text and codes stay data. */
export const printLanguage = (value) =>
  ['en', 'es', 'zh'].includes(value) ? value : 'en'

const messages = {
  quantity: { en: 'Quantity:', es: 'Cantidad:', zh: '数量：' },
  weight: { en: 'Weight:', es: 'Peso:', zh: '重量：' },
  volume: { en: 'Volume:', es: 'Volumen:', zh: '体积：' },
  labels: { en: 'CE labels', es: 'Etiquetas CE', zh: 'CE 标签' },
  marks: { en: 'CE carton marks', es: 'Marcas de caja CE', zh: 'CE 箱唛' },
  fileLabels: { en: 'labels', es: 'etiquetas', zh: '标签' },
  fileMarks: { en: 'carton-marks', es: 'marcas-de-caja', zh: '唛头' },
  fileCalibration: {
    en: 'print-calibration',
    es: 'calibracion-de-impresion',
    zh: '打印校准',
  },
  fileProduct: { en: 'product', es: 'producto', zh: '产品' },
  fileProducts: { en: 'products', es: 'productos', zh: '产品' },
  page: {
    en: 'page {n} of {total}',
    es: 'página {n} de {total}',
    zh: '第 {n}/{total} 页',
  },
  carton: {
    en: 'Carton {n} of {total}',
    es: 'Caja {n} de {total}',
    zh: '第 {n}/{total} 箱',
  },
  actual: {
    en: 'print at 100% (Actual size)',
    es: 'imprimir al 100% (Tamaño real)',
    zh: '按 100%（实际大小）打印',
  },
  more: { en: '+{n} more', es: '+{n} más', zh: '另 {n} 项' },
  calibration: {
    en: 'CE print calibration',
    es: 'Calibración de impresión CE',
    zh: 'CE 打印校准',
  },
  calibrationScale: {
    en: 'Print this page at 100% (Actual size), with no "fit to page" scaling.',
    es: 'Imprima esta página al 100% (Tamaño real), sin "ajustar a la página".',
    zh: '按 100%（实际大小）打印本页，不要使用“适合页面”缩放。',
  },
  calibrationRulers: {
    en: '1. Each long ruler must measure exactly 100 mm and each short ruler 10 mm.',
    es: '1. Cada regla larga debe medir exactamente 100 mm y cada regla corta 10 mm.',
    zh: '1. 长标尺必须恰好为 100 mm，短标尺为 10 mm。',
  },
  calibrationRulersFix: {
    en: '   If not, the printer is scaling: choose Actual size or 100% and print again.',
    es: '   Si no es así, elija Tamaño real o 100% y vuelva a imprimir.',
    zh: '   如果不符，请选择实际大小或 100%，然后重新打印。',
  },
  calibrationLeft: {
    en: '2. Measure from the left paper edge to the vertical line of the top-left cross',
    es: '2. Mida desde el borde izquierdo hasta la línea vertical de la cruz superior.',
    zh: '2. 测量纸张左边缘到左上角十字竖线的距离。',
  },
  calibrationFormula: {
    en: '   (target 20 mm). New offset X = current X + 20 - measured; X is printed below.',
    es: '   Objetivo: 20 mm. Nuevo ajuste X = X actual + 20 - distancia medida.',
    zh: '   目标为 20 mm。新 X 偏移 = 当前 X + 20 - 实测值；当前 X 见下方。',
  },
  calibrationTop: {
    en: '3. Do the same from the top paper edge to its horizontal line for offset Y.',
    es: '3. Repita desde el borde superior hasta la línea horizontal para el ajuste Y.',
    zh: '3. 同样测量纸张上边缘到十字横线的距离，以计算 Y 偏移。',
  },
  calibrationExample: {
    en: '   Example: current X +2.0, measured 22 mm -> new X +0.0. Save them as a preset.',
    es: '   Ejemplo: X actual +2.0, medida 22 mm -> nuevo X +0.0. Guarde el ajuste.',
    zh: '   例如：当前 X +2.0，实测 22 mm -> 新 X +0.0。可保存为预设。',
  },
  offsets: {
    en: 'Offsets on this sheet: X {x} mm, Y {y} mm',
    es: 'Ajustes de esta hoja: X {x} mm, Y {y} mm',
    zh: '本页偏移：X {x} mm，Y {y} mm',
  },
  preset: { en: 'preset {name}', es: 'preajuste {name}', zh: '预设 {name}' },
  crossTop: {
    en: '20 mm from left and top',
    es: '20 mm desde izquierda y arriba',
    zh: '距左侧和顶部 20 mm',
  },
  crossBottom: {
    en: '20 mm from right and bottom',
    es: '20 mm desde derecha y abajo',
    zh: '距右侧和底部 20 mm',
  },
}

export function printText(key, language, params = {}) {
  return messages[key][printLanguage(language)].replace(
    /\{(\w+)\}/g,
    (_, name) => String(params[name] ?? '')
  )
}
