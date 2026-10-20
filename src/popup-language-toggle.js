import { element } from './ui.js'
import {
  bindAttribute,
  getLanguage,
  message,
  onLanguageChange,
  setLanguage,
} from './i18n.js'

/** The same language choice as the workspace, without remounting draft fields. */
export function popupLanguageToggle(dialog, { onChange } = {}) {
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
    button.onclick = () => setLanguage(language)
    group.append(button)
  }
  const update = () => {
    for (const button of group.children)
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.language === getLanguage())
      )
  }
  update()
  const stop = onLanguageChange((language) => {
    update()
    onChange?.(language)
  })
  dialog.addEventListener('close', stop, { once: true })
  return group
}
