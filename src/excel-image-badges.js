import { appearanceTokens, UI_LABEL_COLORS } from './appearance.js'
import { orderTagColors } from './order-tags.js'

/** Resolve the same explicit override/system preference used by theme.js. */
export function currentExcelImageMode(
  scheme = globalThis.document?.querySelector('meta[name="color-scheme"]')
    ?.content,
  systemDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches
) {
  return ['light', 'dark'].includes(scheme)
    ? scheme
    : systemDark
      ? 'dark'
      : 'light'
}

/** Capture colors, not settings references, for one open image-copy session. */
export function createExcelImageBadges(preferences = {}, mode = 'light') {
  mode = mode === 'dark' ? 'dark' : 'light'
  const tags = (definitions) =>
    Object.freeze(
      Object.fromEntries(
        (Array.isArray(definitions) ? definitions : []).map((definition) => {
          const colors = orderTagColors(definition)
          return [
            definition.name,
            Object.freeze({
              background: colors[mode],
              foreground: colors[`${mode}Text`],
            }),
          ]
        })
      )
    )
  const tokens = appearanceTokens(preferences.appearance, mode)
  return Object.freeze({
    mode,
    orderTags: tags(preferences.orderTags),
    productTags: tags(preferences.productTags),
    labels: Object.freeze(
      Object.fromEntries(
        UI_LABEL_COLORS.map(([key]) => [
          key,
          Object.freeze({
            background: tokens[`label-${key}-bg`],
            foreground: tokens[`label-${key}-text`],
          }),
        ])
      )
    ),
  })
}
