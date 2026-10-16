import { element as el } from './ui.js'
import { message as m, bindAttribute, bindText } from './i18n.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import { mergeOrderTags, orderTagColors, renameTagData } from './order-tags.js'
import { createAnnotationAutosave } from './annotation-autosave.js'
import { randomizeReadableColors } from './appearance.js'
import { mountTagPicker, orderTagBadge } from './tag-picker.js'
export { mountTagPicker, orderTagBadge } from './tag-picker.js'

export function mountOrderTagSettings(
  host,
  value,
  existingNames = [],
  options = {}
) {
  return mountTagSettings(host, value, {
    ...options,
    existingNames,
    scope: 'order',
  })
}

export function mountTagSettings(
  host,
  value,
  {
    scope = 'order',
    existingNames = [],
    removeTag,
    renameTag,
    getTagUsage,
  } = {}
) {
  const catalog = scope === 'product' ? 'productTags' : 'orderTags'
  value[catalog] = mergeOrderTags(value[catalog], existingNames)
  const heading = el(
      'h3',
      m(scope === 'product' ? 'Product tags' : 'Order tags')
    ),
    help = el(
      'p',
      m(
        'Unused tags created here stay available. After a tag is first used, removing its last assignment also removes it from this catalog.'
      ),
      'packing-help'
    ),
    addRow = el('div', undefined, 'order-tag-add'),
    input = el('input'),
    add = decorateIcon(el('button', m('Create tag')), 'plus'),
    list = el('div', undefined, 'order-tag-color-list'),
    status = el('p', undefined, 'packing-help')
  input.type = 'text'
  bindAttribute(
    input,
    'aria-label',
    m(scope === 'product' ? 'New product tag' : 'New order tag')
  )
  bindAttribute(
    input,
    'placeholder',
    m(scope === 'product' ? 'New product tag' : 'New order tag')
  )
  add.type = 'button'
  status.setAttribute('role', 'status')
  const edits = new Map()
  let pendingRename
  async function rename(entry) {
    if (pendingRename) return pendingRename
    const previousName = entry.name
    const draft = edits.get(previousName)
    if (!draft) return
    const work = (async () => {
      section.inert = true
      section.setAttribute('aria-busy', 'true')
      try {
        const nextName = draft.value.trim()
        renameTagData(
          { definitions: value[catalog] },
          previousName,
          nextName,
          scope
        )
        const saved =
          nextName !== previousName && renameTag
            ? await renameTag(previousName, nextName, scope)
            : false
        value[catalog] = renameTagData(
          { definitions: value[catalog] },
          previousName,
          nextName,
          scope
        ).definitions
        edits.delete(previousName)
        render()
        bindText(
          status,
          saved
            ? m('Tag renamed to “{name}” everywhere.', { name: nextName })
            : m('Tag name updated. Save settings to keep it.')
        )
      } catch (error) {
        draft.error = error.message
        render()
        throw error
      } finally {
        section.inert = false
        section.removeAttribute('aria-busy')
        const row = [...list.children].find(
          (node) =>
            node.dataset.tagName ===
            (edits.has(previousName) ? previousName : draft.value.trim())
        )
        row
          ?.querySelector(
            edits.has(previousName)
              ? '.order-tag-name-input'
              : '[data-rename-tag]'
          )
          ?.focus()
      }
    })()
    pendingRename = work
    try {
      return await work
    } finally {
      if (pendingRename === work) pendingRename = null
    }
  }
  function render() {
    list.replaceChildren()
    for (const entry of value[catalog]) {
      const row = el('div', undefined, 'order-tag-color-row')
      row.dataset.tagName = entry.name
      const badge = orderTagBadge(entry.name, value[catalog]),
        identity = el('div', undefined, 'order-tag-identity'),
        edit = decorateIcon(
          el('button', m('Rename tag {name}', { name: entry.name })),
          'edit',
          { iconOnly: true }
        ),
        randomize = decorateIcon(
          el('button', m('Randomize {label} colors', { label: entry.name })),
          'refresh',
          { iconOnly: true }
        ),
        remove = decorateIcon(
          el('button', m('Delete tag {name} everywhere', { name: entry.name })),
          'trash',
          { iconOnly: true }
        )
      edit.type = randomize.type = remove.type = 'button'
      edit.dataset.renameTag = entry.name
      edit.onclick = () => {
        edits.set(entry.name, { value: entry.name })
        render()
        const field = [...list.querySelectorAll('.order-tag-name-input')].find(
          (input) => input.dataset.tagName === entry.name
        )
        field?.focus()
        field?.select()
      }
      preparationHelp(
        edit,
        m(
          'Rename this tag in Settings. Assigned orders or products update together; colors stay the same.'
        )
      )
      randomize.dataset.randomTag = entry.name
      randomize.onclick = () => {
        const colors = randomizeReadableColors(orderTagColors(entry))
        entry.colors = { light: colors.light, dark: colors.dark }
        entry.textColors = { light: colors.lightText, dark: colors.darkText }
        render()
        ;[...list.querySelectorAll('[data-random-tag]')]
          .find((button) => button.dataset.randomTag === entry.name)
          ?.focus()
      }
      preparationHelp(
        randomize,
        m(
          'Try another coordinated background and text color in both modes. Save settings to keep it.'
        )
      )
      preparationHelp(
        remove,
        m(
          'Delete this tag from the catalog and every assignment. Used tags show a summary before removal.'
        )
      )
      remove.onclick = async () => {
        remove.disabled = true
        try {
          const count = getTagUsage
            ? await getTagUsage(entry.name, scope)
            : existingNames.filter((name) => name === entry.name).length
          if (count > 0 && !(await confirmTagRemoval(entry, scope, count)))
            return
          if (removeTag) await removeTag(entry.name, scope)
          value[catalog] = value[catalog].filter(
            (item) => item.name !== entry.name
          )
          render()
          bindText(
            status,
            m('Tag “{name}” removed everywhere.', { name: entry.name })
          )
        } catch (error) {
          bindText(
            status,
            m('Could not delete “{name}”: {error}', {
              name: entry.name,
              error: error.message,
            })
          )
        } finally {
          remove.disabled = false
        }
      }
      identity.append(badge, edit, randomize, remove)
      const draft = edits.get(entry.name)
      if (draft) {
        const editor = el('div', undefined, 'order-tag-rename'),
          nameInput = el('input', undefined, 'order-tag-name-input'),
          saveName = decorateIcon(el('button', m('Save tag name')), 'check', {
            iconOnly: true,
          }),
          cancelName = decorateIcon(
            el('button', m('Cancel tag rename')),
            'close',
            { iconOnly: true }
          ),
          errorText = el('p', undefined, 'order-tag-rename-error')
        nameInput.type = 'text'
        nameInput.dataset.tagName = entry.name
        nameInput.value = draft.value
        bindAttribute(
          nameInput,
          'aria-label',
          m('New name for {name}', { name: entry.name })
        )
        nameInput.setAttribute('aria-invalid', String(Boolean(draft.error)))
        nameInput.oninput = () => {
          draft.value = nameInput.value
          draft.error = ''
          nameInput.setAttribute('aria-invalid', 'false')
          errorText.hidden = true
        }
        saveName.type = cancelName.type = 'button'
        saveName.onclick = () => {
          void rename(entry).catch(() => {})
        }
        const cancel = () => {
          edits.delete(entry.name)
          render()
          ;[...list.querySelectorAll('[data-rename-tag]')]
            .find((button) => button.dataset.renameTag === entry.name)
            ?.focus()
        }
        cancelName.onclick = cancel
        nameInput.onkeydown = (event) => {
          if (!['Enter', 'Escape'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Escape') cancel()
          else void rename(entry).catch(() => {})
        }
        preparationHelp(
          saveName,
          m(
            'Save the new name for this tag everywhere. Duplicate names are not merged.'
          )
        )
        preparationHelp(cancelName, m('Keep the current tag name.'))
        errorText.setAttribute('role', 'alert')
        if (draft.error)
          bindText(
            errorText,
            m('Could not rename: {error}. Your draft is still here.', {
              error: m(draft.error),
            })
          )
        errorText.hidden = !draft.error
        for (const action of [edit, randomize, remove]) action.hidden = true
        editor.append(nameInput, saveName, cancelName, errorText)
        identity.append(editor)
      }
      row.append(identity)
      for (const mode of ['light', 'dark']) {
        const group = el('fieldset', undefined, 'order-tag-color-mode'),
          modeName = m(mode === 'light' ? 'Light' : 'Dark'),
          legend = el('legend', modeName),
          backgroundLabel = el('label', undefined, 'order-tag-color-control'),
          textLabel = el('label', undefined, 'order-tag-color-control'),
          color = el('input'),
          textColor = el('input'),
          automatic = el('button', m('Auto'), 'order-tag-auto'),
          preview = el('span', 'Aa', 'order-tag-mode-preview')
        color.type = textColor.type = 'color'
        color.style.colorScheme = textColor.style.colorScheme = mode
        automatic.type = 'button'
        bindAttribute(
          group,
          'aria-label',
          m('{label} · {mode}', { label: entry.name, mode: modeName })
        )
        bindAttribute(
          color,
          'aria-label',
          m('{label} background · {mode}', {
            label: entry.name,
            mode: modeName,
          })
        )
        bindAttribute(
          textColor,
          'aria-label',
          m('{label} text · {mode}', { label: entry.name, mode: modeName })
        )
        bindAttribute(
          automatic,
          'aria-label',
          m('Automatic text color for {label} · {mode}', {
            label: entry.name,
            mode: modeName,
          })
        )
        const paint = () => {
          const colors = orderTagColors(entry)
          color.value = colors[mode]
          textColor.value = colors[`${mode}Text`]
          automatic.disabled = !entry.textColors?.[mode]
          preview.style.backgroundColor = colors[mode]
          preview.style.color = colors[`${mode}Text`]
          for (const [key, value] of Object.entries(colors))
            badge.style.setProperty(`--tag-${key}`, value)
        }
        color.oninput = () => {
          entry.colors[mode] = color.value
          paint()
        }
        textColor.oninput = () => {
          entry.textColors ??= {}
          entry.textColors[mode] = textColor.value
          paint()
        }
        automatic.onclick = () => {
          delete entry.textColors?.[mode]
          if (entry.textColors && !Object.keys(entry.textColors).length)
            delete entry.textColors
          paint()
        }
        preparationHelp(
          color,
          m(
            'Choose this tag’s background for this mode. Automatic text adjusts to it unless you choose a text color.'
          )
        )
        preparationHelp(
          textColor,
          m(
            'Choose this tag’s text color. Auto restores readable black or white for the selected background.'
          )
        )
        preparationHelp(
          automatic,
          m(
            'Restore automatic readable text for this mode. The background color stays unchanged.'
          )
        )
        backgroundLabel.append(el('span', m('Background')), color)
        textLabel.append(el('span', m('Text')), textColor)
        group.append(legend, backgroundLabel, textLabel, automatic, preview)
        row.append(group)
        paint()
      }
      list.append(row)
    }
  }
  function create() {
    const name = input.value.trim()
    if (!name) return input.focus()
    if (value[catalog].some((entry) => entry.name === name)) {
      bindText(status, m('This tag already exists.'))
      return input.focus()
    }
    value[catalog] = mergeOrderTags(value[catalog], [name])
    input.value = ''
    bindText(
      status,
      m('Tag added. Save settings to make it available everywhere.')
    )
    render()
  }
  add.onclick = create
  input.onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      create()
    }
  }
  preparationHelp(
    add,
    m(
      scope === 'product'
        ? 'Create a reusable product tag. Save settings to keep it.'
        : 'Create a tag shared by all orders. Save settings to keep it.'
    )
  )
  addRow.append(input, add)
  const section = el(
    'section',
    undefined,
    'appearance-section order-tag-settings'
  )
  section.dataset.tagScope = scope
  section.append(heading, help, addRow, list, status)
  host.append(section)
  render()
  return {
    refresh: render,
    get pending() {
      return Boolean(pendingRename)
    },
    async flush() {
      if (pendingRename) await pendingRename
      for (const entry of [...value[catalog]])
        if (edits.has(entry.name)) await rename(entry)
    },
  }
}

function confirmTagRemoval(entry, scope, count) {
  const dialog = el('dialog', undefined, 'tag-delete-dialog'),
    heading = el('h2', m('Delete tag everywhere?')),
    badge = orderTagBadge(entry.name, [entry]),
    description = el(
      'p',
      m(
        scope === 'product'
          ? 'This removes the tag from {count} products and the product tag catalog.'
          : 'This removes the tag from {count} orders and the order tag catalog.',
        { count }
      )
    ),
    actions = el('div', undefined, 'dialog-actions'),
    cancel = el('button', m('Cancel')),
    remove = decorateIcon(el('button', m('Delete tag everywhere')), 'trash')
  bindAttribute(dialog, 'aria-label', m('Delete tag everywhere?'))
  cancel.type = remove.type = 'button'
  actions.append(cancel, remove)
  dialog.append(heading, badge, description, actions)
  document.body.append(dialog)
  return new Promise((resolve) => {
    let confirmed = false
    cancel.onclick = () => dialog.close()
    remove.onclick = () => {
      confirmed = true
      dialog.close()
    }
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove()
        resolve(confirmed)
      },
      { once: true }
    )
    dialog.showModal()
    cancel.focus()
  })
}

export function mountOrderAnnotations(
  host,
  { record, definitions, draft, onDraft, save }
) {
  const section = el('section', undefined, 'order-annotations'),
    tagHost = el('div'),
    notesLabel = el('label', m('Your notes')),
    notes = el('textarea'),
    state = el('span', m('Saved'), 'annotation-state'),
    retry = el('button', m('Retry save')),
    footer = el('div', undefined, 'annotation-footer')
  let tags = [...(draft?.tags || record.tags)]
  notes.value = draft?.notes ?? record.notes
  notes.id = 'order-notes'
  notes.rows = 3
  notesLabel.htmlFor = notes.id
  retry.type = 'button'
  retry.hidden = true
  state.setAttribute('role', 'status')
  const current = () => ({ notes: notes.value, tags: [...tags] })
  const autosave = createAnnotationAutosave({
    initial: { notes: record.notes, tags: record.tags },
    write: save,
    onState(status, error) {
      section.dataset.saveState = status
      retry.hidden = status !== 'error'
      bindText(
        state,
        status === 'error'
          ? m('Not saved: {error}. Your draft is still here.', {
              error: error.message,
            })
          : m(
              status === 'saved'
                ? 'Saved'
                : status === 'saving'
                  ? 'Saving…'
                  : 'Changes save automatically'
            )
      )
      if (status === 'saved') onDraft(null)
    },
  })
  function changed() {
    onDraft(current())
    autosave.update(current())
  }
  const picker = mountTagPicker(tagHost, {
    label: m('Tags'),
    definitions,
    selected: tags,
    onChange(next) {
      tags = next
      changed()
    },
  })
  let flushing
  function flush() {
    if (flushing) return flushing
    const previous = {
      inert: tagHost.inert,
      notesDisabled: notes.disabled,
      retryDisabled: retry.disabled,
    }
    tagHost.inert = true
    notes.disabled = true
    retry.disabled = true
    flushing = (async () => {
      await Promise.resolve()
      try {
        picker.commitInput()
        await autosave.flush()
      } finally {
        tagHost.inert = previous.inert
        notes.disabled = previous.notesDisabled
        retry.disabled = previous.retryDisabled
        flushing = null
      }
    })()
    return flushing
  }
  notes.oninput = changed
  retry.onclick = () => {
    void flush().catch(() => {})
  }
  preparationHelp(
    notes,
    m(
      'Private order notes save automatically. Refreshing from 1688 preserves your notes and tags.'
    )
  )
  footer.append(state, retry)
  section.append(tagHost, notesLabel, notes, footer)
  host.append(section)
  if (draft) changed()
  return {
    flush,
    dirty: () => autosave.dirty() || picker.dirty(),
    setDefinitions: picker.setDefinitions,
    destroy: picker.destroy,
    section,
  }
}
