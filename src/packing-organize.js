import { element as el } from './ui.js'
import { message as m, bindAttribute, bindText } from './i18n.js'
import { setCodeText } from './code-display.js'
import { decorateIcon } from './icons.js'
import { reorderHandle } from './packing-reorder.js'
import { createRowSelection } from './row-selection.js'
import { createVirtualList } from './virtual-list.js'
import { preparationHelp } from './preparation-help.js'

export const organizeGroupKey = (orderId, groupId) =>
  JSON.stringify([orderId, groupId])
export const organizeProductKey = (orderId, groupId, variantId) =>
  JSON.stringify([orderId, groupId, variantId])

/** Organizing never borrows or clears the selection used for exports. */
export function createOrganizeState() {
  return {
    active: false,
    mode: 'groups',
    groups: new Set(),
    products: new Set(),
    groupKey: '',
    anchors: new Map(),
    normalAnchor: null,
  }
}

/** Move complete selected blocks by one visible position; never cross a bucket. */
export function moveOrganizeKeys(keys, selected, direction) {
  const result = [...keys]
  if (direction < 0) {
    for (let index = 1; index < result.length; index++)
      if (selected.has(result[index]) && !selected.has(result[index - 1]))
        [result[index - 1], result[index]] = [result[index], result[index - 1]]
  } else {
    for (let index = result.length - 2; index >= 0; index--)
      if (selected.has(result[index]) && !selected.has(result[index + 1]))
        [result[index], result[index + 1]] = [result[index + 1], result[index]]
  }
  return result
}

/** Selections retain original purchase identities, including combined variants. */
export function organizeRemovalEntries(groups, state) {
  const entries = new Map()
  for (const group of groups) {
    const variants =
      state.mode === 'groups'
        ? state.groups.has(group.key)
          ? group.products
          : []
        : group.key === state.groupKey
          ? group.products.filter((product) => state.products.has(product.key))
          : []
    for (const product of variants) {
      if (!entries.has(group.orderId))
        entries.set(group.orderId, { draft: group.draft, entryIds: new Set() })
      for (const id of product.entryIds)
        entries.get(group.orderId).entryIds.add(id)
    }
  }
  return [...entries.values()].map(({ draft, entryIds }) => ({
    draft,
    entryIds: [...entryIds],
  }))
}

/** A separate compact projection: product editors and label previews are unmounted. */
export function mountPackingOrganizer({
  host,
  groups,
  state,
  photo,
  actionButton,
  actions,
}) {
  const selected = state.mode === 'groups' ? state.groups : state.products
  const availableGroups = new Set(groups.map((group) => group.key))
  for (const key of state.groups)
    if (!availableGroups.has(key)) state.groups.delete(key)
  const availableProducts = new Set(
    groups.flatMap((group) => group.products.map((product) => product.key))
  )
  for (const key of state.products)
    if (!availableProducts.has(key)) state.products.delete(key)
  if (!availableGroups.has(state.groupKey))
    state.groupKey = groups[0]?.key || ''
  const activeGroup = groups.find((group) => group.key === state.groupKey)
  const entries = state.mode === 'groups' ? groups : activeGroup?.products || []
  const byKey = new Map(entries.map((entry) => [entry.key, entry]))
  const body = el(
    'div',
    undefined,
    'packing-order-sections packing-organize-list'
  )
  body.tabIndex = 0
  body.dataset.organizeMode = state.mode
  body.setAttribute('role', 'region')
  bindAttribute(
    body,
    'aria-label',
    m(state.mode === 'groups' ? 'Organize groups' : 'Organize products')
  )
  const output = el(
    'div',
    undefined,
    'preparation-output packing-selection-toolbar packing-organize-toolbar'
  )
  output.setAttribute('role', 'group')
  bindAttribute(output, 'aria-label', m('Organize packing'))
  const count = el('span', undefined, 'packing-organize-count')
  let list, chooserList
  const controller = createRowSelection({
    selected,
    additive: true,
    getKeys: () => entries.map((entry) => entry.key),
    ensureVisible: (key) => list?.ensureVisible(key),
    onChange: paint,
  })
  const selectAll = actionButton('Select all', () => controller.selectAll())
  const clear = actionButton('Clear selection', () => controller.clear())
  const up = actionButton('Move up', () => actions.moveSelected(-1))
  const down = actionButton('Move down', () => actions.moveSelected(1))
  const remove = actionButton('Remove from packing', () =>
    actions.remove(organizeRemovalEntries(groups, state))
  )
  remove.classList.add('packing-organize-remove')
  decorateIcon(remove, 'trash')
  decorateIcon(selectAll, 'check', { iconOnly: true, label: m('Select all') })
  decorateIcon(clear, 'close', { iconOnly: true, label: m('Clear selection') })
  for (const [control, symbol, label] of [
    [up, '↑', 'Move up'],
    [down, '↓', 'Move down'],
  ]) {
    const arrow = el('span', symbol)
    arrow.setAttribute('aria-hidden', 'true')
    control.prepend(arrow)
    bindAttribute(control, 'aria-label', m(label))
  }
  const modes = el('div', undefined, 'packing-organize-modes')
  modes.setAttribute('role', 'group')
  bindAttribute(modes, 'aria-label', m('Organize view'))
  for (const [mode, label] of [
    ['groups', 'Groups'],
    ['products', 'Products'],
  ]) {
    const control = actionButton(label, () => actions.mode(mode))
    control.dataset.action = `organize-${mode}`
    control.setAttribute('aria-pressed', String(state.mode === mode))
    modes.append(control)
  }
  const arrange = el(
    'div',
    undefined,
    'packing-arrange packing-organize-arrange'
  )
  if (state.mode === 'groups') actions.arrange(arrange)
  const undo = actionButton('Undo', () => actions.travel('undo'))
  const redo = actionButton('Redo', () => actions.travel('redo'))
  decorateIcon(undo, 'undo', { iconOnly: true, label: m('Undo') })
  decorateIcon(redo, 'redo', { iconOnly: true, label: m('Redo') })
  const done = actionButton('Done', actions.done)
  decorateIcon(done, 'check')
  done.classList.add('primary')
  done.dataset.action = 'organize-done'
  output.append(
    modes,
    count,
    selectAll,
    clear,
    up,
    down,
    arrange,
    remove,
    undo,
    redo,
    done
  )

  function paint() {
    const keys = entries.map((entry) => entry.key)
    const picked = keys.filter((key) => selected.has(key))
    bindText(
      count,
      m('{0} selected · {1} {2}', {
        0: picked.length,
        1: keys.length,
        2: m(state.mode === 'groups' ? 'groups' : 'products'),
      })
    )
    clear.disabled = remove.disabled = !picked.length
    selectAll.disabled = !keys.length || picked.length === keys.length
    function canMove(direction) {
      const buckets =
        state.mode === 'groups'
          ? [...new Set(groups.map((group) => group.orderId))].map((orderId) =>
              groups
                .filter((group) => group.orderId === orderId)
                .map((group) => group.key)
            )
          : [keys]
      return buckets.some((bucket) =>
        moveOrganizeKeys(bucket, selected, direction).some(
          (key, index) => key !== bucket[index]
        )
      )
    }
    up.disabled = !canMove(-1)
    down.disabled = !canMove(1)
    controller.paint()
    for (const input of body.querySelectorAll('[data-organize-select]'))
      input.checked = selected.has(input.dataset.organizeSelect)
  }
  function selection(entry, card) {
    const checkbox = el('input')
    checkbox.type = 'checkbox'
    checkbox.dataset.organizeSelect = entry.key
    checkbox.checked = selected.has(entry.key)
    bindAttribute(
      checkbox,
      'aria-label',
      m('Select {0}', { 0: entry.code || entry.name })
    )
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(entry.key)
      else selected.delete(entry.key)
      paint()
    })
    controller.bind(card, entry.key)
    card.append(checkbox)
  }
  function row(entry) {
    const card = el(
      'article',
      undefined,
      `packing-organize-card packing-organize-${state.mode === 'groups' ? 'group' : 'product'}`
    )
    card.dataset.organizeKey = entry.key
    if (state.mode === 'groups') card.dataset.groupId = entry.groupId
    else card.dataset.variantId = entry.variantId
    selection(entry, card)
    card.append(
      reorderHandle({
        key: entry.key,
        label: entry.code || entry.name,
        items: () =>
          entries
            .filter((candidate) => candidate.orderId === entry.orderId)
            .map((candidate) => candidate.key),
        element: (key) => list?.element(key),
        move: (key, target, after) =>
          actions.drag(state.mode, byKey.get(key), byKey.get(target), after),
      })
    )
    if (entry.photo) card.append(photo(entry.photo))
    else card.append(el('span', undefined, 'packing-organize-photo-empty'))
    const identity = el('div', undefined, 'packing-organize-identity')
    const code = el('span', undefined, 'ce-code')
    setCodeText(code, entry.code)
    const name = el('strong', entry.name)
    identity.append(code, name)
    const detail = el(
      'small',
      entry.title || '',
      'packing-organize-description'
    )
    identity.append(detail)
    card.append(identity)
    const quantity = el('span', undefined, 'packing-organize-quantity')
    bindText(
      quantity,
      state.mode === 'groups'
        ? m('{0} products · {1} pcs', {
            0: entry.products.length,
            1: entry.quantity,
          })
        : m('{0} pcs', { 0: entry.quantity })
    )
    card.append(quantity)
    if (state.mode === 'groups') {
      const products = actionButton('Products', () => actions.group(entry.key))
      products.classList.add('packing-organize-open-products')
      card.append(products)
    }
    return card
  }
  function orderHeading(group) {
    const header = el(
      'header',
      undefined,
      'packing-order-header packing-organize-order-header'
    )
    header.dataset.organizeOrder = group.orderId
    if (state.mode === 'groups')
      header.append(
        reorderHandle({
          key: group.orderId,
          label: group.storeName,
          items: () => [...new Set(groups.map((entry) => entry.orderId))],
          element: (key) =>
            list
              ?.element(`organize-order:${key}`)
              ?.closest('.packing-order-section'),
          move: (key, target, after) => actions.dragOrder(key, target, after),
        })
      )
    const identity = el('div')
    identity.append(
      el('h2', group.storeName),
      el('small', group.orderId, 'packing-order-number')
    )
    header.append(identity)
    return header
  }
  function chooser() {
    const header = el('div', undefined, 'packing-organize-product-context')
    if (activeGroup) {
      const code = el('span', undefined, 'ce-code')
      setCodeText(code, activeGroup.code)
      header.append(
        code,
        el('strong', activeGroup.name),
        el('small', activeGroup.storeName)
      )
    }
    const picker = el('div', undefined, 'packing-organize-picker')
    picker.id = `organize-picker-${crypto.randomUUID()}`
    picker.setAttribute('popover', 'auto')
    const search = el('input')
    search.type = 'search'
    bindAttribute(search, 'placeholder', m('Find group or store'))
    bindAttribute(search, 'aria-label', m('Find group or store'))
    const scroller = el('div', undefined, 'packing-organize-picker-list')
    picker.append(search, scroller)
    const trigger = el('button', m('Choose group'))
    trigger.type = 'button'
    trigger.setAttribute('popovertarget', picker.id)
    function renderChoices() {
      chooserList?.destroy()
      scroller.replaceChildren()
      const query = search.value.trim().toLocaleLowerCase()
      const choices = groups.filter((group) =>
        [group.code, group.name, group.storeName]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query)
      )
      if (!choices.length) {
        scroller.append(el('p', m('No matching groups.')))
        return
      }
      chooserList = createVirtualList({
        scroller,
        limit: 100,
        sections: [{ element: scroller, entries: choices }],
        render: (group) => {
          const choice = actionButton(group.code, () =>
            actions.group(group.key)
          )
          choice.classList.add('packing-organize-group-choice')
          choice.setAttribute(
            'aria-pressed',
            String(group.key === state.groupKey)
          )
          const code = el('span', undefined, 'ce-code')
          setCodeText(code, group.code)
          choice.replaceChildren(
            code,
            el('span', group.name),
            el('small', group.storeName)
          )
          return choice
        },
      })
      chooserList.update()
    }
    search.addEventListener('input', renderChoices)
    picker.addEventListener('toggle', (event) => {
      if (event.newState === 'open') {
        renderChoices()
        search.focus()
      }
    })
    header.append(trigger, picker)
    body.append(header)
  }
  const sections = []
  if (state.mode === 'products') chooser()
  const orderIds =
    state.mode === 'groups'
      ? [...new Set(groups.map((entry) => entry.orderId))]
      : activeGroup
        ? [activeGroup.orderId]
        : []
  for (const orderId of orderIds) {
    const group = groups.find((entry) => entry.orderId === orderId)
    const section = el('section', undefined, 'packing-order-section')
    section.dataset.packingOrder = orderId
    body.append(section)
    sections.push({
      element: section,
      entries: [
        { key: `organize-order:${orderId}`, heading: true, group },
        ...entries.filter((entry) => entry.orderId === orderId),
      ],
    })
  }
  if (!entries.length)
    body.append(
      el(
        'p',
        m(
          'No products in this packing selection. Return to Orders to choose products.'
        )
      )
    )
  host.append(body, output)
  list = createVirtualList({
    scroller: body,
    sections,
    limit: 100,
    render: (entry) => (entry.heading ? orderHeading(entry.group) : row(entry)),
    remove: (node) => actions.forget(node),
    pinned: (nodes) =>
      [...nodes]
        .filter(([, node]) => node.querySelector('[data-reorder-captured]'))
        .map(([key]) => key),
    paint,
  })
  const anchorKey = `${state.mode}/${state.mode === 'products' ? state.groupKey : ''}`
  list.update(state.anchors.get(anchorKey))
  preparationHelp(
    remove,
    m(
      'Review selected products and preparation changes before removing. Original orders are kept.'
    )
  )
  return {
    output,
    undo,
    redo,
    selectAll: () => controller.selectAll(),
    clear: () => controller.clear(),
    focus(key) {
      const node = list.ensureVisible(key)
      node?.querySelector('.reorder-handle')?.focus({ preventScroll: true })
    },
    destroy() {
      state.anchors.set(anchorKey, list.anchor())
      list.destroy()
      chooserList?.destroy()
      controller.detach()
    },
  }
}
