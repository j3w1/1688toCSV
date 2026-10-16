/** One visual identity for Casa Elida codes in the workspace and label artwork. */
export const CE_CODE_DESIGN = Object.freeze({
  fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
  fontWeight: 700,
  background: '#000',
  foreground: '#fff',
  horizontalPaddingScale: 0.8645,
  verticalPaddingScale: 0.63,
  radiusRatio: 0.16,
})

export function applyCodeDesign(element) {
  const values = {
    '--ce-code-font-family': CE_CODE_DESIGN.fontFamily,
    '--ce-code-font-weight': CE_CODE_DESIGN.fontWeight,
    '--ce-code-background': CE_CODE_DESIGN.background,
    '--ce-code-foreground': CE_CODE_DESIGN.foreground,
    '--ce-code-horizontal-padding-scale': CE_CODE_DESIGN.horizontalPaddingScale,
    '--ce-code-vertical-padding-scale': CE_CODE_DESIGN.verticalPaddingScale,
    '--ce-code-radius-ratio': CE_CODE_DESIGN.radiusRatio,
  }
  for (const [name, value] of Object.entries(values))
    element.style.setProperty(name, String(value))
}
