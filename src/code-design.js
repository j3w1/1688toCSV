/** One visual identity for Casa Elida codes in the workspace and label artwork. */
export const CE_CODE_DESIGN = Object.freeze({
  fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
  fontWeight: 700,
  background: '#000',
  foreground: '#fff',
  // The approved 20px badge is the drawing master. Scale the whole badge with
  // its type, never with the dimensions or unused space of its container.
  referenceFontSize: 20,
  paddingInline: 7,
  paddingBlock: 6,
  radius: 4,
})

export function codeDesignMetrics(fontSize) {
  const scale = fontSize / CE_CODE_DESIGN.referenceFontSize
  return {
    paddingInline: CE_CODE_DESIGN.paddingInline * scale,
    paddingBlock: CE_CODE_DESIGN.paddingBlock * scale,
    radius: CE_CODE_DESIGN.radius * scale,
  }
}

export function applyCodeDesign(element) {
  const master = codeDesignMetrics(1)
  const values = {
    '--ce-code-font-family': CE_CODE_DESIGN.fontFamily,
    '--ce-code-font-weight': CE_CODE_DESIGN.fontWeight,
    '--ce-code-background': CE_CODE_DESIGN.background,
    '--ce-code-foreground': CE_CODE_DESIGN.foreground,
    '--ce-code-padding-inline': `${master.paddingInline}em`,
    '--ce-code-padding-block': `${master.paddingBlock}em`,
    '--ce-code-radius': `${master.radius}em`,
  }
  for (const [name, value] of Object.entries(values))
    element.style.setProperty(name, String(value))
}
