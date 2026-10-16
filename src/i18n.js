import { UI_MESSAGES } from './ui-messages.js'

export const LANGUAGE_PREFERENCE = '1688-workspace-language'
const locales = { en: 'en-GB', zh: 'zh-CN', es: 'es-PE' }
const listeners = new Set()
const bindings = new Set()
const textBindings = new WeakMap()
const attributeBindings = new WeakMap()
let language = 'en'
let templateMessages
try {
  const stored = globalThis.localStorage?.getItem(LANGUAGE_PREFERENCE)
  if (Object.hasOwn(locales, stored)) language = stored
} catch {
  /* The in-memory selection still works if storage is unavailable. */
}

export const getLanguage = () => language
export const getLocale = () => locales[language]
export const isMessage = (value) => value instanceof UIMessage

/** Only explicitly marked UI messages are translated. Source data stays data. */
export function t(source, params = {}) {
  if (isMessage(source)) return source.toString()
  const key = String(source ?? '')
  let translated = UI_MESSAGES[key]?.[language]
  // Existing validated errors arrive as strings from storage and the importer.
  // Translate only cataloged sentences with a substantial literal prefix; this
  // never scans or translates seller/product fields, which do not call t().
  if (
    translated === undefined &&
    language !== 'en' &&
    !Object.keys(params).length
  ) {
    templateMessages ??= Object.entries(UI_MESSAGES)
      .flatMap(([source, values]) => {
        if (
          !source.includes('{') ||
          source.replace(/\{\w+\}/g, '').trim().length < 12
        )
          return []
        const names = [],
          parts = source.split(/(\{\w+\})/g)
        const pattern = parts
          .map((part) => {
            if (/^\{\w+\}$/.test(part)) {
              names.push(part.slice(1, -1))
              return '(.*?)'
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          })
          .join('')
        return [
          { source, values, names, pattern: new RegExp(`^${pattern}$`, 's') },
        ]
      })
      .sort((a, b) => b.source.length - a.source.length)
    for (const entry of templateMessages) {
      const match = entry.pattern.exec(key)
      if (!match) continue
      translated = entry.values[language]
      params = Object.fromEntries(
        entry.names.map((name, index) => [name, match[index + 1]])
      )
      break
    }
  }
  translated ??= key
  return translated.replace(/\{(\w+)\}/g, (token, name) =>
    Object.hasOwn(params, name)
      ? String(
          (typeof params[name] === 'function'
            ? params[name]()
            : params[name]) ?? ''
        )
      : token
  )
}

class UIMessage {
  constructor(source, params) {
    this.source = source
    this.params = params
  }
  toString() {
    return t(this.source, this.params)
  }
}

export const message = (source, params = {}) => new UIMessage(source, params)
const resolve = (source, params) =>
  typeof source === 'function' ? String(source()) : t(source, params)

function track(binding) {
  bindings.add(new WeakRef(binding))
  binding.update()
  return binding
}

/** Bind one owned text node; later language changes never remount form controls. */
export function bindText(element, source, params = {}) {
  if (['INPUT', 'TEXTAREA'].includes(element.tagName))
    throw new TypeError(
      'Use an attribute binding for input help, never its value.'
    )
  let binding = textBindings.get(element)
  if (!binding || binding.node.parentNode !== element) {
    const node = element.ownerDocument.createTextNode('')
    element.replaceChildren(node)
    binding = {
      element,
      node,
      source,
      params,
      update() {
        if (this.node.parentNode === this.element)
          this.node.data = resolve(this.source, this.params)
      },
    }
    textBindings.set(element, binding)
    track(binding)
  } else {
    binding.source = source
    binding.params = params
    binding.update()
  }
  return element
}

export function bindAttribute(element, attribute, source, params = {}) {
  if (
    ![
      'title',
      'aria-label',
      'aria-description',
      'aria-valuetext',
      'placeholder',
      'alt',
    ].includes(attribute)
  )
    throw new TypeError(`Unsupported translated attribute: ${attribute}`)
  let entries = attributeBindings.get(element)
  if (!entries) attributeBindings.set(element, (entries = new Map()))
  let binding = entries.get(attribute)
  if (!binding) {
    binding = {
      element,
      attribute,
      source,
      params,
      initialized: false,
      update() {
        // A helper may intentionally remove a native title, or replace an alt with
        // source text. Never resurrect or overwrite attributes it no longer owns.
        if (
          this.initialized &&
          this.element.getAttribute(this.attribute) !== this.last
        )
          return
        this.last = resolve(this.source, this.params)
        this.element.setAttribute(this.attribute, this.last)
        this.initialized = true
      },
    }
    entries.set(attribute, binding)
    track(binding)
  } else {
    binding.source = source
    binding.params = params
    binding.initialized = false
    binding.update()
  }
  return element
}

export function textMessage(element) {
  return textBindings.get(element)?.source
}

export function attributeMessage(element, attribute) {
  return attributeBindings.get(element)?.get(attribute)?.source
}

/** Static markup opts in with data-i18n; there is no text matching or data scan. */
export function localize(root = document) {
  const attributes = [
    'title',
    'aria-label',
    'aria-description',
    'placeholder',
    'alt',
  ]
  const selector = [
    '[data-i18n]',
    ...attributes.map((name) => `[data-i18n-${name}]`),
  ].join(',')
  for (const element of [root, ...root.querySelectorAll(selector)]) {
    if (element.hasAttribute?.('data-i18n'))
      bindText(element, element.getAttribute('data-i18n'))
    for (const name of attributes)
      if (element.hasAttribute?.(`data-i18n-${name}`))
        bindAttribute(element, name, element.getAttribute(`data-i18n-${name}`))
  }
}

export function setLanguage(value, { persist = true } = {}) {
  if (!Object.hasOwn(locales, value)) return false
  language = value
  if (persist) {
    try {
      globalThis.localStorage?.setItem(LANGUAGE_PREFERENCE, value)
    } catch {}
  }
  if (globalThis.document)
    document.documentElement.lang = value === 'zh' ? 'zh-CN' : value
  for (const reference of bindings) {
    const binding = reference.deref()
    if (binding) binding.update()
    else bindings.delete(reference)
  }
  for (const listener of listeners) listener(value)
  return true
}

export function onLanguageChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

globalThis.addEventListener?.('storage', (event) => {
  if (event.key === LANGUAGE_PREFERENCE || event.key === null)
    setLanguage(event.newValue || 'en', { persist: false })
})
