import { element } from './ui.js'
import {
  bindAttribute,
  getLanguage,
  message,
  onLanguageChange,
  setLanguage,
  createLanguageScope,
} from './i18n.js'

/** Translate only this popup and its exports, without remounting draft fields. */
export function popupLanguageToggle(dialog, { onChange, language } = {}) {
  createLanguageScope(dialog, language)
  const group = element(
    'div',
    undefined,
    'language-toggle popup-language-toggle'
  )
  group.setAttribute('role', 'group')
  bindAttribute(group, 'aria-label', message('Language'))
  for (const [language, label, name] of [
    ['en', 'EN', 'English'],
    ['es', 'ES', 'Spanish'],
    ['zh', '中文', 'Chinese'],
  ]) {
    const button = element('button', label)
    button.type = 'button'
    button.dataset.language = language
    button.lang = language === 'zh' ? 'zh-CN' : language
    bindAttribute(button, 'aria-label', message(name))
    bindAttribute(button, 'title', message(name))
    button.onclick = () => setLanguage(language, { scope: dialog })
    group.append(button)
  }
  const update = () => {
    for (const button of group.children)
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.language === getLanguage(dialog))
      )
  }
  update()
  const stop = onLanguageChange((language) => {
    update()
    onChange?.(language)
  }, dialog)
  dialog.addEventListener('close', stop, { once: true })
  return group
}
