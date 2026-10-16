import { element as el } from './ui.js'
import { message as m, bindText } from './i18n.js'
import { mountTagPicker } from './order-tags-ui.js'
import { createAnnotationAutosave } from './annotation-autosave.js'
import { preparationHelp } from './preparation-help.js'

// Product annotations belong to the library row, never to the packing model.
export function mountProductTags(host, { selected = [], definitions, save }) {
  const section = el('section', undefined, 'product-details-tags'),
    pickerHost = el('div'),
    status = el('span', m('Saved'), 'annotation-state'),
    retry = el('button', m('Retry save')),
    footer = el('div', undefined, 'annotation-footer')
  status.setAttribute('role', 'status')
  retry.type = 'button'
  retry.hidden = true
  let picker
  const autosave = createAnnotationAutosave({
    initial: selected,
    write: async (tags) => {
      const definitions = await save(tags)
      if (definitions) picker.setDefinitions(definitions)
    },
    onState(state, error) {
      section.dataset.saveState = state
      retry.hidden = state !== 'error'
      bindText(
        status,
        state === 'error'
          ? m('Not saved: {error}. Your draft is still here.', {
              error: error.message,
            })
          : m(
              state === 'saved'
                ? 'Saved'
                : state === 'saving'
                  ? 'Saving…'
                  : 'Changes save automatically'
            )
      )
    },
  })
  picker = mountTagPicker(pickerHost, {
    label: m('Product tags'),
    definitions,
    selected,
    onChange: (tags) => autosave.update(tags),
  })
  retry.onclick = () => void autosave.flush().catch(() => {})
  preparationHelp(
    section,
    m(
      'Assign tags to this product. Product tags appear only in the Products table.'
    )
  )
  footer.append(status, retry)
  section.append(pickerHost, footer)
  host.append(section)
  return {
    setBusy(busy) {
      // Keep the save status reachable while blocking new edits during dismissal.
      pickerHost.inert = busy
      retry.disabled = busy
      picker.close()
      if (!busy && !retry.hidden) retry.focus()
    },
    async flush() {
      picker.commitInput()
      try {
        await autosave.flush()
      } catch (error) {
        retry.focus()
        throw error
      }
    },
    dirty: () => autosave.dirty() || picker.dirty(),
    setDefinitions: (definitions) => picker.setDefinitions(definitions),
    destroy() {
      picker.destroy()
      section.remove()
    },
  }
}
