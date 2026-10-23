import { element as el, copyTextButton, copied } from './ui.js'
import { message as m, bindText, bindAttribute, getLocale } from './i18n.js'
import { createVirtualTable } from './virtual-table.js'
import { photoCopyTile } from './photo-copy.js'
import { copySingleImage } from './clipboard.js'
import { mountProductCopyActions, mountCopyActions } from './copy-actions.js'

const clone = (value) => structuredClone(value)
const orderRef = (order) => ({
  accountId: order.accountId || order.record?.accountId || 'local',
  orderId: order.orderId || order.record?.snapshot.orderId,
})
const refKey = (ref) => JSON.stringify([ref.accountId || 'local', ref.orderId])
const idFor = (carton) => carton.cartonId || carton.id
const revisionFor = (view) => view.container.revision

/** Repository-only shipment commands. Pending reads never overwrite a new route. */
export function createContainerController({
  repository,
  onChange = () => {},
  newIntent = () => crypto.randomUUID(),
}) {
  let view,
    route,
    generation = 0,
    pending,
    review,
    error
  const intents = new Map()
  const loadingHistory = { past: [], future: [] }
  function notify() {
    onChange(view && clone(view), {
      pending: Boolean(pending),
      error,
      route: route && clone(route),
    })
  }
  function requireDraft() {
    if (!view || route.revisionId || (!view.draft && !view.container.amendment))
      throw new Error(
        'Open a draft or amendment before changing loading decisions.'
      )
  }
  async function open(id, revisionId) {
    const version = ++generation
    const nextRoute = { containerId: id, ...(revisionId ? { revisionId } : {}) }
    const next = await repository.getContainerView({ id, revisionId })
    if (version !== generation) return false
    route = nextRoute
    view = clone(next)
    review = undefined
    error = undefined
    loadingHistory.past = []
    loadingHistory.future = []
    notify()
    return true
  }
  async function mutate(name, args = {}, { draft = true } = {}) {
    if (pending)
      throw new Error('Wait for the current container operation to finish.')
    if (draft) requireDraft()
    if (!view) throw new Error('Choose a container first.')
    const capturedRoute = clone(route),
      version = generation,
      revision = revisionFor(view)
    const key = JSON.stringify([
      capturedRoute.containerId,
      revision,
      name,
      args,
    ])
    const intentId = intents.get(key) || newIntent()
    intents.set(key, intentId)
    let finish
    const idle = new Promise((resolve) => {
      finish = resolve
    })
    const work = Promise.resolve().then(() =>
      repository[name]({
        id: capturedRoute.containerId,
        ...clone(args),
        expectedRevision: revision,
        intentId,
      })
    )
    pending = { work, idle }
    notify()
    try {
      await work
      intents.delete(key)
      if (version === generation) {
        const next = await repository.getContainerView({
          id: capturedRoute.containerId,
          revisionId: capturedRoute.revisionId,
        })
        if (version === generation) {
          view = clone(next)
          review = undefined
          error = undefined
        }
      }
      if (
        ![
          'setContainerLoading',
          'markContainerLoaded',
          'setInterchangeableLoading',
        ].includes(name)
      ) {
        loadingHistory.past = []
        loadingHistory.future = []
      }
    } catch (failure) {
      if (version === generation) error = failure
      throw failure
    } finally {
      pending = undefined
      finish()
      notify()
    }
  }
  async function loadCommand(name, args) {
    const version = generation
    const before =
      view?.cartons.map((carton) => ({
        cartonId: idFor(carton),
        state: carton.state || 'unconfirmed',
      })) || []
    await mutate(name, args)
    if (version !== generation) return
    const after = view.cartons.map((carton) => ({
      cartonId: idFor(carton),
      state: carton.state || 'unconfirmed',
    }))
    loadingHistory.past.push({ before, after })
    if (loadingHistory.past.length > 50) loadingHistory.past.shift()
    loadingHistory.future = []
    notify()
  }
  return {
    open,
    view: () => view && clone(view),
    route: () => route && clone(route),
    busy: () => Boolean(pending),
    async flush() {
      if (pending) await pending.idle
    },
    setLoading: (decisions) =>
      loadCommand('setContainerLoading', { decisions }),
    markAllLoaded: () =>
      loadCommand('markContainerLoaded', {
        orderRefs: view.orders.map(orderRef),
      }),
    includeOrders: (orderRefs) =>
      mutate('includeContainerOrders', { orderRefs }),
    removeOrder: (order) =>
      mutate('removeContainerOrder', { orderRef: orderRef(order) }),
    cancel: () => mutate('cancelContainer'),
    setInterchangeableLoading(batchId, leftBehind) {
      const carton = view.cartons.find(
        (carton) => carton.batchId === batchId || carton.id === batchId
      )
      if (carton?.interchangeable !== true && carton?.canSelectCount !== true)
        throw new Error(
          'Choose the actual carton references when their contents or measurements differ.'
        )
      return loadCommand('setInterchangeableLoading', { batchId, leftBehind })
    },
    async reviewAvailability() {
      requireDraft()
      return repository.reviewContainerAvailability({
        id: route.containerId,
        expectedRevision: revisionFor(view),
      })
    },
    applyAvailability: (plan) => mutate('applyContainerAvailability', { plan }),
    async reviewSeal() {
      requireDraft()
      const version = generation,
        revision = revisionFor(view)
      const result = await repository.reviewContainerSeal({
        id: route.containerId,
        expectedRevision: revision,
      })
      if (version !== generation || revision !== revisionFor(view))
        throw new Error(
          'The container changed. Review it again before sealing.'
        )
      review = { ...result, revision }
      return clone(review)
    },
    seal(media) {
      if (!review?.ready || review.revision !== revisionFor(view))
        throw new Error('Review this container before sealing.')
      return mutate(
        view.container.amendment ? 'applyContainerAmendment' : 'sealContainer',
        {
          reviewToken: review.reviewToken,
          ...(media ? { media } : {}),
          ...(view.container.amendment
            ? { reason: view.container.amendment.reason }
            : {}),
        }
      )
    },
    amend: (reason) =>
      mutate('beginContainerAmendment', { reason }, { draft: false }),
    cancelAmendment: () => mutate('cancelContainerAmendment'),
    canUndo: () => loadingHistory.past.length > 0,
    canRedo: () => loadingHistory.future.length > 0,
    async undo() {
      const entry = loadingHistory.past.at(-1)
      if (!entry) return
      await mutate('setContainerLoading', { decisions: entry.before })
      loadingHistory.past.pop()
      loadingHistory.future.push(entry)
      notify()
    },
    async redo() {
      const entry = loadingHistory.future.at(-1)
      if (!entry) return
      await mutate('setContainerLoading', { decisions: entry.after })
      loadingHistory.future.pop()
      loadingHistory.past.push(entry)
      notify()
    },
    dispose() {
      generation++
      view = undefined
      route = undefined
      review = undefined
    },
  }
}

/** A contextual sidebar and the same compact tables for every named container. */
export function createContainerWorkspace({
  host,
  repository,
  output,
  inspectProduct,
  editInOrders,
  loadImage = async (url) => url,
  onRoute = () => {},
  onError = () => {},
}) {
  const sidebar = el('aside', undefined, 'orders-pane container-sidebar'),
    main = el('section', undefined, 'container-main'),
    heading = el('div', undefined, 'container-heading'),
    tools = el('div', undefined, 'container-tools'),
    orders = el('div', undefined, 'container-order-list'),
    tabs = el('nav', undefined, 'workspace-subviews'),
    status = el('p'),
    notice = el('p'),
    scroller = el('div', undefined, 'smart-grid-scroll'),
    table = el('table'),
    head = el('thead'),
    body = el('tbody'),
    selector = el('select'),
    revisions = el('select'),
    summary = el('div', undefined, 'container-summary')
  sidebar.append(el('h2', m('Container')), selector, revisions, orders)
  bindAttribute(selector, 'aria-label', m('Choose container'))
  selector.dataset.action = 'choose-container'
  bindAttribute(revisions, 'aria-label', m('Container revision'))
  revisions.dataset.action = 'choose-container-revision'
  status.setAttribute('role', 'status')
  notice.setAttribute('role', 'status')
  table.setAttribute('role', 'grid')
  scroller.append(table)
  table.append(head, body)
  main.append(
    heading,
    tabs,
    notice,
    summary,
    tools,
    el(
      'p',
      m(
        'Copy/print uses explicit product selection; workbook always exports the full container revision.'
      )
    ),
    status,
    scroller
  )
  host.replaceChildren(sidebar, main)
  let currentView = 'loading',
    displayFilter = '',
    selected = new Set(),
    allRows = [],
    visibleRows = [],
    matchingKeys = [],
    selectionBox,
    expandedOrders = new Set(),
    targetOrder,
    lastSelection
  const buttons = new Map(),
    tabButtons = []
  let painting = false
  function action(parent, title, name, run) {
    const button = el('button', m(title))
    button.type = 'button'
    button.dataset.action = name
    button.onclick = () =>
      void Promise.resolve()
        .then(() => run(button))
        .catch(failure)
    parent.append(button)
    return button
  }
  function failure(error) {
    bindText(status, m(error.message))
    onError(error)
  }
  const controller = createContainerController({
    repository,
    onChange: (_view, state) => {
      host.setAttribute('aria-busy', String(state.pending))
      if (state.error) bindText(status, m(state.error.message))
      render()
    },
  })
  for (const [value, title] of [
    ['loading', 'Loading'],
    ['packing-list', 'Packing list'],
    ['left-behind', 'Se quedó'],
  ]) {
    const button = action(tabs, title, 'container-view', () => show(value))
    button.dataset.view = value
    tabButtons.push(button)
  }
  action(sidebar, 'New container', 'create-container', create)
  buttons.set(
    'include',
    action(sidebar, 'Include whole orders', 'include-container-orders', include)
  )
  buttons.set(
    'cancel',
    action(sidebar, 'Cancel container draft', 'cancel-container', async () => {
      if (await confirm('Cancel this draft and release its reservations?')) {
        await controller.cancel()
        await reloadContainers()
      }
    })
  )
  buttons.set(
    'all',
    action(tools, 'Mark all loaded', 'mark-all-loaded', () =>
      controller.markAllLoaded()
    )
  )
  buttons.set(
    'loaded',
    action(tools, '+ Loaded', 'mark-cartons-loaded', () =>
      controller.setLoading(selectedDecisions('loaded'))
    )
  )
  buttons.set(
    'left',
    action(tools, '− Left behind', 'mark-cartons-left-behind', () =>
      controller.setLoading(selectedDecisions('left-behind'))
    )
  )
  buttons.set(
    'reset',
    action(tools, 'Unconfirmed', 'mark-cartons-unconfirmed', () =>
      controller.setLoading(selectedDecisions('unconfirmed'))
    )
  )
  buttons.set(
    'undo',
    action(tools, 'Undo', 'undo-container-loading', () => controller.undo())
  )
  buttons.set(
    'redo',
    action(tools, 'Redo', 'redo-container-loading', () => controller.redo())
  )
  action(tools, 'Select all', 'select-all-rows', () => selectAll())
  action(tools, 'Clear selection', 'clear-selection', () => clearSelection())
  buttons.set(
    'revalidate',
    action(
      tools,
      'Review availability changes',
      'review-container-availability',
      async () => {
        const plan = await controller.reviewAvailability()
        await reviewDialog(
          'Review availability changes',
          plan,
          () => controller.applyAvailability(plan),
          'apply-container-availability'
        )
      }
    )
  )
  buttons.set(
    'seal',
    action(tools, 'Review & seal', 'review-container-seal', async () => {
      const review = await controller.reviewSeal()
      await reviewDialog(
        'Review & seal',
        review,
        review.ready ? () => controller.seal() : null,
        'seal-container'
      )
    })
  )
  buttons.set(
    'amend',
    action(tools, 'Amend sealed container', 'amend-container', async () => {
      const reason = await textDialog('Reason for amendment', 'Begin amendment')
      if (reason?.trim()) await controller.amend(reason.trim())
    })
  )
  buttons.set(
    'cancelAmendment',
    action(tools, 'Cancel amendment', 'cancel-container-amendment', () =>
      controller.cancelAmendment()
    )
  )
  action(tools, 'Export packing list', 'export-packing-list', async () => {
    await controller.flush()
    // No selected or filtered product rows enter this request.
    return output.openWorkbook(
      await output.containerContext(controller.route())
    )
  })
  action(tools, 'Copy Excel image', 'copy-excel-image', () =>
    capturedCopy('excel-image')
  )
  action(tools, 'Copy values', 'copy-values', (target) =>
    copied(target, () => capturedCopy('values'), { onError: failure })
  )
  const copyHost = el('div', undefined, 'container-copy-actions')
  tools.append(copyHost)
  const columns = action(
      copyHost,
      'Copy columns',
      'copy-container-columns',
      () => capturedCopy('columns')
    ),
    codes = action(
      copyHost,
      'Copy group codes',
      'copy-group-codes',
      (target) => {
        const scope = captureCopyScope()
        return copied(
          target,
          async () => {
            await controller.flush()
            const context = await selectedOutput(scope),
              codes = [
                ...new Set(
                  context.products.map((row) => row.baseCode).filter(Boolean)
                ),
              ]
            if (!codes.length)
              throw new Error('Review product codes in Orders first.')
            await navigator.clipboard.writeText(codes.join('\r\n'))
          },
          { onError: failure }
        )
      }
    ),
    photos = action(copyHost, 'Copy images', 'copy-container-images', () =>
      capturedCopy('images')
    ),
    cells = action(copyHost, 'Copy to Excel', 'copy-container-cells', () =>
      capturedCopy('cells')
    ),
    barcodes = action(
      copyHost,
      'Copy barcode images',
      'copy-container-barcodes',
      async () => {
        const scope = captureCopyScope()
        await controller.flush()
        return output.copyLabels('barcode', await selectedOutput(scope))
      }
    ),
    marks = action(
      copyHost,
      'Copy carton marks',
      'copy-container-marks',
      async () => {
        const scope = captureCopyScope()
        await controller.flush()
        return output.copyLabels('mark', await selectedOutput(scope))
      }
    ),
    copyMenu = mountProductCopyActions(copyHost, {
      columns,
      codes,
      photos,
      cells,
      barcodes,
      marks,
    })
  copyMenu.trigger.dataset.action = 'open-copy-menu'
  const printHost = el('div', undefined, 'container-print-actions')
  tools.append(printHost)
  const printButtons = [
    ['barcode', 'Print labels…', 'print-labels'],
    ['mark', 'Print carton marks…', 'print-carton-marks'],
  ].map(([kind, title, name]) =>
    action(printHost, title, name, async () => {
      const scope = captureCopyScope()
      await controller.flush()
      return output.printLabels(kind, await selectedOutput(scope))
    })
  )
  printButtons.push(
    action(printHost, 'Recent print jobs…', 'print-recent', () =>
      output.openRecentPrints()
    )
  )
  const printMenu = mountCopyActions(printHost, {
    label: 'Print…',
    ariaLabel: 'More print formats',
    panelLabel: 'Print formats',
    symbol: 'barcode',
    groups: [{ label: 'Print', actions: printButtons }],
  })
  printMenu.trigger.dataset.action = 'open-print-menu'
  const search = el('input')
  const selectionCount = el('span', undefined, 'container-selection-count')
  search.type = 'search'
  bindAttribute(search, 'aria-label', m('Filter container display'))
  search.oninput = () => {
    displayFilter = search.value.toLowerCase()
    renderRows()
  }
  tools.append(search, selectionCount)
  const virtual = createVirtualTable({
    scroller,
    body,
    render: (entries) => entries.map(({ row }) => renderRow(row)),
    paint: () => {
      for (const row of body.querySelectorAll('[data-container-row]')) {
        const check = row.querySelector('input[type="checkbox"]')
        if (check) check.checked = selected.has(row.dataset.containerRow)
      }
    },
    limit: 100,
  })
  function selectedDecisions(state) {
    if (!selected.size) throw new Error('Select actual cartons first.')
    return allRows
      .filter((row) => selected.has(row.key) && row.kind === 'carton')
      .map((row) => ({ cartonId: idFor(row.source), state }))
  }
  function updateSelectionControls() {
    for (const key of ['loaded', 'left', 'reset'])
      buttons.get(key).disabled = !selected.size || controller.busy()
    for (const row of body.querySelectorAll('[data-container-row]')) {
      const chosen = selected.has(row.dataset.containerRow)
      const check = row.querySelector('input[type="checkbox"]')
      if (check) check.checked = chosen
      row.setAttribute('aria-selected', String(chosen))
    }
    if (selectionBox) {
      const chosen = matchingKeys.filter((key) => selected.has(key)).length
      selectionBox.checked =
        matchingKeys.length > 0 && chosen === matchingKeys.length
      selectionBox.indeterminate = chosen > 0 && chosen < matchingKeys.length
    }
    selectionCount.dataset.selectedCount = String(selected.size)
    selectionCount.dataset.filteredCount = String(matchingKeys.length)
    bindText(selectionCount, m('Selected rows: {0}', { 0: selected.size }))
  }
  function selectAll() {
    selected = new Set(matchingKeys)
    updateSelectionControls()
  }
  function clearSelection() {
    selected.clear()
    updateSelectionControls()
  }
  function captureCopyScope() {
    return {
      route: clone(controller.route()),
      partial: selected.size > 0 && currentView !== 'loading',
      keys: [
        ...new Set(
          allRows
            .filter((row) => selected.has(row.key))
            .map((row) => refKey(row.source) + '/' + row.source.entryId)
        ),
      ],
    }
  }
  async function selectedOutput(scope = captureCopyScope()) {
    const context = await output.containerContext(scope.route)
    if (!scope.partial) return context
    const keys = new Set(scope.keys)
    const products = context.products.filter((row) =>
      keys.has(refKey(row) + '/' + row.entryId)
    )
    return { ...context, products, partial: true }
  }
  async function capturedCopy(format) {
    const scope = captureCopyScope()
    await controller.flush()
    return output.copy(await selectedOutput(scope), format)
  }
  async function reloadContainers(preferred) {
    const containers = await repository.listContainers({})
    const current = preferred || controller.route()?.containerId
    selector.replaceChildren(
      new Option(tMessage('Choose container'), ''),
      ...containers.map((container) => new Option(container.name, container.id))
    )
    selector.value = current || ''
    if (current && containers.some((container) => container.id === current))
      await open(current)
    else {
      heading.replaceChildren(el('h2', m('Choose or create a named container')))
      orders.replaceChildren()
      virtual.setItems([])
    }
  }
  function tMessage(source) {
    return String(m(source))
  }
  selector.onchange = () =>
    void (selector.value ? open(selector.value) : Promise.resolve()).catch(
      failure
    )
  revisions.onchange = () =>
    void open(selector.value, revisions.value || undefined).catch(failure)
  async function open(id, revisionId) {
    await controller.flush()
    selected.clear()
    expandedOrders.clear()
    if (await controller.open(id, revisionId)) {
      selector.value = id
      onRoute({
        ...controller.route(),
        workspace: 'packing',
        view: currentView,
      })
    }
  }
  function show(value) {
    currentView = value
    selected.clear()
    lastSelection = null
    render()
    onRoute({ ...controller.route(), workspace: 'packing', view: value })
  }
  function render() {
    if (painting) return
    painting = true
    try {
      const view = controller.view()
      if (!view) return
      const editable =
          Boolean(view.draft || view.container.amendment) &&
          !controller.route().revisionId,
        busy = controller.busy()
      heading.replaceChildren(
        el('h2', view.container.name),
        el('code', view.revisionId || '—')
      )
      bindText(
        notice,
        m(
          view.draft
            ? 'DRAFT — unsealed container'
            : 'Sealed container revision'
        )
      )
      const historical = view.container.revisions || []
      const revisionIds = historical.map((revision) =>
        typeof revision === 'string'
          ? revision
          : revision.id || revision.revisionId
      )
      revisions.replaceChildren(
        new Option(tMessage('Current revision'), ''),
        ...revisionIds.map((id) => new Option(id, id))
      )
      revisions.value = controller.route().revisionId || ''
      revisions.hidden = !revisionIds.length
      for (const button of tabButtons)
        button.setAttribute(
          'aria-current',
          button.dataset.view === currentView ? 'page' : 'false'
        )
      for (const [key, button] of buttons) {
        button.hidden = ['amend'].includes(key)
          ? editable
          : key === 'cancelAmendment'
            ? !view.container.amendment
            : !editable
        button.disabled =
          busy ||
          (['loaded', 'left', 'reset'].includes(key) && !selected.size) ||
          (key === 'undo' && !controller.canUndo()) ||
          (key === 'redo' && !controller.canRedo())
      }
      summary.replaceChildren()
      for (const [key, label] of [
        ['quantity', 'Loaded pieces'],
        ['cartons', 'Loaded cartons'],
        ['weight', 'Known kg'],
        ['volume', 'Known m³'],
        ['weightCoverage', 'Weight coverage'],
        ['volumeCoverage', 'Volume coverage'],
      ]) {
        const value = view.totals?.[key]
        const metric = el('div')
        metric.append(
          el('span', m(label)),
          el(
            'strong',
            value && typeof value === 'object'
              ? String(
                  m('{0} known · {1} missing · {2} unknown-count sets', {
                    0: value.knownCount ?? '—',
                    1: value.missingCount ?? '—',
                    2: value.unknownCountBatches ?? '—',
                  })
                )
              : String(value ?? '—')
          )
        )
        summary.append(metric)
      }
      for (const [state, label] of [
        ['unconfirmed', 'Unconfirmed'],
        ['loaded', 'Loaded'],
        ['left-behind', 'Left behind'],
      ]) {
        const metric = el('div')
        metric.append(
          el('span', m(label)),
          el(
            'strong',
            String(
              new Set(
                view.cartons
                  .filter((carton) => (carton.state || 'unconfirmed') === state)
                  .map(idFor)
              ).size
            )
          )
        )
        summary.append(metric)
      }
      orders.replaceChildren()
      for (const order of view.orders) {
        const ref = orderRef(order),
          card = el('article', undefined, 'container-order'),
          inspect = el(
            'button',
            order.sellerName || order.record?.snapshot.sellerName || ref.orderId
          )
        inspect.dataset.action = 'inspect-container-order'
        inspect.dataset.orderId = ref.orderId
        inspect.onclick = () => {
          targetOrder = targetOrder === refKey(ref) ? null : refKey(ref)
          renderRows()
        }
        card.append(inspect, el('small', ref.orderId))
        const expand = action(
          card,
          'Show cartons',
          'expand-container-order',
          () => {
            const key = refKey(ref)
            if (expandedOrders.has(key)) expandedOrders.delete(key)
            else expandedOrders.add(key)
            renderRows()
          }
        )
        expand.setAttribute(
          'aria-expanded',
          String(expandedOrders.has(refKey(ref)))
        )
        action(card, 'Edit in Orders', 'edit-in-orders', () =>
          editInOrders(
            { ...ref, view: 'cartons' },
            { ...controller.route(), workspace: 'packing', view: currentView }
          )
        )
        if (editable)
          action(card, 'Remove whole order', 'remove-container-order', () =>
            controller.removeOrder(order)
          )
        orders.append(card)
      }
      renderRows()
    } finally {
      painting = false
    }
  }
  function renderRows() {
    const view = controller.view()
    if (!view) return
    const source =
      currentView === 'loading'
        ? view.cartons
        : currentView === 'left-behind'
          ? view.leftBehind.products
          : view.products
    const kind = currentView === 'loading' ? 'carton' : 'product'
    allRows = source.map((row) => ({
      key:
        kind === 'carton'
          ? idFor(row)
          : JSON.stringify([
              row.accountId || 'local',
              row.orderId,
              row.entryId,
            ]),
      source: row,
      kind,
    }))
    const matching = allRows.filter(
      ({ source }) =>
        (!targetOrder || refKey(orderRef(source)) === targetOrder) &&
        (!displayFilter ||
          [
            source.entryId,
            source.id,
            source.cartonId,
            source.batchId,
            source.reference,
            source.label,
            source.cartonNumber,
            source.markCode,
            source.barcode,
            source.baseCode,
            source.spanishName,
            source.title,
            source.description,
            source.variantDescription,
            source.sourceSize,
            source.category,
            source.material,
            source.orderReference,
            source.orderId,
            source.sellerName,
            source.pattern,
            source.cartonReferenceText,
            source.quantity,
            source.loadedQuantity,
            source.remainingQuantity,
            source.price,
            source.weight,
            source.volume,
            source.len,
            source.wid,
            source.ht,
            source.state,
            source.contentsText,
            source.contents
              ?.map(
                (part) =>
                  `${part.entryId} ${part.barcode || ''} ${part.quantity}`
              )
              .join(' '),
          ]
            .filter((value) => value != null)
            .join('\n')
            .toLowerCase()
            .includes(displayFilter))
    )
    matchingKeys = matching.map((row) => row.key)
    visibleRows = []
    if (currentView === 'loading') {
      for (const order of view.orders) {
        const key = refKey(orderRef(order)),
          cartons = matching.filter(
            ({ source }) => refKey(orderRef(source)) === key
          )
        if (targetOrder && key !== targetOrder) continue
        visibleRows.push({ key: `order:${key}`, kind: 'order', source: order })
        if (expandedOrders.has(key) || targetOrder === key || displayFilter)
          visibleRows.push(...cartons)
      }
    } else visibleRows = matching
    head.replaceChildren()
    const tr = el('tr')
    for (const label of kind === 'carton'
      ? [
          'Select',
          'Carton reference',
          'Contents',
          'Quantity',
          'Weight (kg)',
          'Volume (m³)',
          'Loading state',
        ]
      : [
          'Select',
          'Photo',
          'Code',
          'Description',
          'Purchased',
          'Loaded here',
          'Remaining',
          'Price',
          'Packing pattern',
        ]) {
      const cell = el('th', m(label))
      if (label === 'Select') {
        selectionBox = el('input')
        selectionBox.type = 'checkbox'
        bindAttribute(selectionBox, 'aria-label', m('Select all'))
        selectionBox.onchange = () =>
          selectionBox.checked ? selectAll() : clearSelection()
        cell.replaceChildren(selectionBox)
      }
      tr.append(cell)
    }
    head.append(tr)
    virtual.setItems(visibleRows.map((row) => ({ key: row.key, row })))
    updateSelectionControls()
  }
  function renderRow(row) {
    if (row.kind === 'order') {
      const tr = el('tr', undefined, 'container-loading-order'),
        td = el('td'),
        source = row.source,
        key = refKey(orderRef(source))
      td.colSpan = 7
      td.append(
        el(
          'strong',
          source.sellerName ||
            source.record?.snapshot.sellerName ||
            orderRef(source).orderId
        )
      )
      const expand = action(
        td,
        expandedOrders.has(key) ? 'Hide cartons' : 'Show cartons',
        'expand-container-order',
        () => {
          if (expandedOrders.has(key)) expandedOrders.delete(key)
          else expandedOrders.add(key)
          renderRows()
        }
      )
      expand.setAttribute('aria-expanded', String(expandedOrders.has(key)))
      if (source.totals)
        td.append(
          el(
            'span',
            Object.entries(source.totals)
              .map(([name, value]) => `${name}: ${value ?? '—'}`)
              .join(' · ')
          )
        )
      tr.append(td)
      return tr
    }
    const tr = el('tr'),
      source = row.source
    tr.dataset.containerRow = row.key
    tr.tabIndex = 0
    const selection = el('td'),
      check = el('input')
    check.type = 'checkbox'
    check.checked = selected.has(row.key)
    bindAttribute(
      check,
      'aria-label',
      m('Select row {0}', { 0: source.barcode || source.label || row.key })
    )
    check.onclick = (event) => {
      if (
        event.shiftKey &&
        lastSelection &&
        matchingKeys.includes(lastSelection)
      ) {
        const keys = matchingKeys,
          a = keys.indexOf(lastSelection),
          b = keys.indexOf(row.key)
        for (const key of keys.slice(Math.min(a, b), Math.max(a, b) + 1))
          selected.add(key)
      } else if (check.checked) selected.add(row.key)
      else selected.delete(row.key)
      lastSelection = row.key
      updateSelectionControls()
    }
    selection.append(check)
    tr.append(selection)
    if (row.kind === 'product') {
      const cell = el('td', undefined, 'container-product-photo'),
        photo = el('button', undefined, 'product-photo-button'),
        image = el('img')
      photo.type = 'button'
      image.width = image.height = 74
      image.alt = source.title || source.description || ''
      photo.append(image)
      photo.disabled = !source.thumbnail
      photo.onclick = () => inspect()
      cell.append(
        photoCopyTile(
          photo,
          async () => copySingleImage(await loadImage(source.thumbnail)),
          { disabled: !source.thumbnail }
        )
      )
      if (source.thumbnail)
        void loadImage(source.thumbnail)
          .then((url) => {
            if (image.isConnected) image.src = url
          })
          .catch(() => {
            photo.disabled = true
          })
      tr.append(cell)
    }
    const values =
      row.kind === 'carton'
        ? [
            source.reference ||
              source.label ||
              source.cartonNumber ||
              idFor(source),
            source.contentsText ||
              source.pattern ||
              source.contents
                ?.map((entry) => `${entry.entryId}: ${entry.quantity}`)
                .join(' · ') ||
              String(m('Unknown contents')),
            source.quantity ?? source.pieces ?? source.totalPieces,
            source.weight ?? source.knownWeight,
            source.volume ?? source.knownVolume,
          ]
        : [
            source.barcode,
            source.spanishName || source.description,
            source.purchasedQuantity,
            source.loadedQuantity ?? source.quantity,
            source.remainingQuantity,
            source.sourcePrice ?? source.price,
            source.pattern || source.cartonReferenceText,
          ]
    for (const value of values)
      tr.append(
        el(
          'td',
          value == null
            ? '—'
            : Array.isArray(value)
              ? JSON.stringify(value)
              : String(value)
        )
      )
    if (row.kind === 'carton') {
      if (source.labelOrigin === 'internal')
        tr.children[1].append(el('small', m('Internal reference')))
      const state = el('td')
      state.append(
        el(
          'span',
          m(
            source.state === 'loaded'
              ? 'Loaded'
              : source.state === 'left-behind'
                ? 'Left behind'
                : 'Unconfirmed'
          )
        )
      )
      const view = controller.view()
      if (
        (view.draft || view.container.amendment) &&
        !controller.route().revisionId
      )
        for (const [value, title] of [
          ['loaded', '+ Loaded'],
          ['left-behind', '− Left behind'],
          ['unconfirmed', 'Unconfirmed'],
        ])
          action(state, title, 'set-carton-loading', () =>
            controller.setLoading([{ cartonId: idFor(source), state: value }])
          ).dataset.state = value
      const batchUnits = view.cartons.filter(
        (carton) => carton.batchId === source.batchId
      )
      const interchangeable = batchUnits.filter(
        (carton) =>
          carton.interchangeable === true || carton.canSelectCount === true
      )
      if (
        (view.draft || view.container.amendment) &&
        !controller.route().revisionId &&
        (source.interchangeable === true || source.canSelectCount === true) &&
        idFor(interchangeable[0] || source) === idFor(source)
      ) {
        const availableCount =
          source.count > 1 ? source.count : batchUnits.length
        const input = el('input')
        input.type = 'number'
        input.min = '0'
        input.max = String(availableCount)
        input.step = '1'
        bindAttribute(
          input,
          'aria-label',
          m('Left behind out of {0}', { 0: availableCount })
        )
        input.value = String(source.leftBehind ?? '')
        input.onchange = () =>
          void controller
            .setInterchangeableLoading(
              source.batchId || source.id,
              Number(input.value)
            )
            .catch(failure)
        state.append(input)
      }
      tr.append(state)
    }
    function inspect() {
      if (row.kind === 'product')
        inspectProduct(source, {
          readOnly: true,
          returnTo: {
            ...controller.route(),
            workspace: 'packing',
            view: currentView,
          },
        })
      else inspectCarton(source)
    }
    tr.onclick = (event) => {
      if (!event.target.closest('button,input,a,label,select,textarea'))
        inspect()
    }
    tr.onkeydown = (event) => {
      if (event.target === tr && event.key === 'Enter' && !event.isComposing)
        inspect()
    }
    return tr
  }
  function inspectCarton(carton) {
    const modal = el('dialog', undefined, 'container-carton-details'),
      close = el('button', m('Close'))
    modal.append(el('h2', carton.label || carton.cartonNumber || idFor(carton)))
    const facts = el('dl')
    for (const [label, value] of [
      [
        'Contents',
        carton.contentsText ||
          carton.contents
            ?.map((entry) => `${entry.entryId}: ${entry.quantity}`)
            .join(' · ') ||
          m('Unknown contents'),
      ],
      ['Quantity', carton.quantity ?? carton.pieces],
      ['Weight (kg)', carton.weight],
      ['Volume (m³)', carton.volume],
      [
        'Dimensions (cm)',
        carton.len && carton.wid && carton.ht
          ? `${carton.len}×${carton.wid}×${carton.ht}`
          : null,
      ],
    ]) {
      facts.append(el('dt', m(label)), el('dd', String(value ?? '—')))
    }
    if (carton.labelOrigin === 'internal')
      modal.append(el('p', m('Internal reference')))
    modal.append(facts)
    action(modal, 'Edit in Orders', 'edit-in-orders', () => {
      modal.close()
      return editInOrders(
        { ...orderRef(carton), cartonId: idFor(carton), view: 'cartons' },
        { ...controller.route(), workspace: 'packing', view: currentView }
      )
    })
    close.onclick = () => modal.close()
    modal.append(close)
    modal.onclose = () => modal.remove()
    document.body.append(modal)
    modal.showModal()
  }
  async function create() {
    const name = await textDialog(
      'Container name',
      'Create container',
      new Date().toLocaleDateString(getLocale(), {
        month: 'long',
        year: 'numeric',
      })
    )
    if (!name?.trim()) return
    const container = await repository.createContainer({
      name: name.trim(),
      intentId: crypto.randomUUID(),
    })
    await reloadContainers(container.container?.id || container.id)
  }
  async function include() {
    const backlog = await repository.getBacklog({}),
      chosen = new Set(),
      modal = el('dialog', undefined, 'container-inclusion-dialog'),
      content = el('div'),
      actions = el('div', undefined, 'dialog-actions'),
      status = el('p')
    modal.append(
      el('h2', m('Include whole orders')),
      el(
        'p',
        m(
          'Orders reserve their current available remainder. Inclusion never marks cartons loaded.'
        )
      )
    )
    for (const order of backlog.orders) {
      const ref = orderRef(order),
        label = el('label', undefined, 'container-inclusion-order'),
        check = el('input')
      check.type = 'checkbox'
      label.dataset.orderId = ref.orderId
      label.dataset.accountId = ref.accountId
      check.disabled = order.available === false || order.blocked === true
      check.onchange = () => {
        if (check.checked) chosen.add(refKey(ref))
        else chosen.delete(refKey(ref))
      }
      label.append(
        check,
        el('span', order.record?.snapshot.sellerName || ref.orderId),
        el(
          'small',
          `${ref.orderId} · ${order.remainingQuantity ?? '—'} · ${order.cartonsUnknown ? String(m('Cartons unknown')) : (order.knownCartons ?? '—')}`
        )
      )
      content.append(label)
    }
    const cancel = el('button', m('Cancel')),
      apply = el('button', m('Include selected orders'), 'primary')
    apply.dataset.action = 'confirm-container-orders'
    cancel.onclick = () => modal.close()
    apply.onclick = () =>
      void (async () => {
        apply.disabled = cancel.disabled = true
        try {
          await controller.includeOrders(
            backlog.orders
              .map(orderRef)
              .filter((ref) => chosen.has(refKey(ref)))
          )
          modal.close()
        } catch (error) {
          bindText(status, m(error.message))
        } finally {
          apply.disabled = cancel.disabled = false
        }
      })()
    status.setAttribute('role', 'status')
    actions.append(cancel, apply)
    modal.append(content, status, actions)
    modal.onclose = () => modal.remove()
    document.body.append(modal)
    modal.showModal()
  }
  async function confirm(title) {
    return reviewDialog(
      title,
      { ready: true, issues: [], warnings: [] },
      async () => true,
      'confirm-container-action'
    )
  }
  async function reviewDialog(title, review, apply, name) {
    const modal = el('dialog', undefined, 'container-review-dialog'),
      body = el('div'),
      status = el('p'),
      actions = el('div', undefined, 'dialog-actions'),
      cancel = el('button', m('Cancel')),
      confirm = el('button', m(title), 'primary')
    modal.append(el('h2', m(title)))
    for (const issue of [
      ...(review.issues || []),
      ...(review.warnings || []),
    ]) {
      const row = el('p', m(issue.message || issue))
      if (issue.orderId)
        action(row, 'Edit in Orders', 'edit-in-orders', () => {
          modal.close()
          return editInOrders(
            { ...orderRef(issue), view: 'cartons' },
            { ...controller.route(), workspace: 'packing', view: currentView }
          )
        })
      body.append(row)
    }
    if (review.before || review.after || review.changes)
      body.append(
        el(
          'pre',
          JSON.stringify(
            {
              before: review.before,
              after: review.after,
              changes: review.changes,
            },
            null,
            2
          )
        )
      )
    confirm.disabled = !apply
    confirm.dataset.action = name
    cancel.onclick = () => modal.close()
    confirm.onclick = () =>
      void (async () => {
        confirm.disabled = cancel.disabled = true
        try {
          await apply()
          modal.close('confirmed')
        } catch (error) {
          bindText(status, m(error.message))
        } finally {
          confirm.disabled = !apply
          cancel.disabled = false
        }
      })()
    status.setAttribute('role', 'status')
    actions.append(cancel, confirm)
    modal.append(body, status, actions)
    modal.oncancel = (event) => {
      if (cancel.disabled) event.preventDefault()
    }
    document.body.append(modal)
    modal.showModal()
    return new Promise((resolve) =>
      modal.addEventListener(
        'close',
        () => {
          const accepted = modal.returnValue === 'confirmed'
          modal.remove()
          resolve(accepted)
        },
        { once: true }
      )
    )
  }
  async function textDialog(title, actionTitle, value = '') {
    const modal = el('dialog'),
      input = el('input'),
      label = el('label', m(title)),
      cancel = el('button', m('Cancel')),
      apply = el('button', m(actionTitle), 'primary')
    input.value = value
    input.maxLength = 160
    label.append(input)
    modal.append(label, cancel, apply)
    cancel.onclick = () => modal.close()
    apply.onclick = () => {
      if (input.value.trim()) modal.close('saved')
    }
    document.body.append(modal)
    modal.showModal()
    input.focus()
    input.select()
    return new Promise((resolve) =>
      modal.addEventListener(
        'close',
        () => {
          const result = modal.returnValue === 'saved' ? input.value : null
          modal.remove()
          resolve(result)
        },
        { once: true }
      )
    )
  }
  return {
    open,
    show,
    reload: reloadContainers,
    flush: () => controller.flush(),
    route: () => ({
      ...controller.route(),
      workspace: 'packing',
      view: currentView,
    }),
    controller,
    selectAll,
    clearSelection,
    dispose() {
      controller.dispose()
      copyMenu.destroy()
      printMenu.destroy()
      virtual.destroy()
      host.replaceChildren()
    },
  }
}

/** Backlog displays only the repository's global projection. */
export async function mountBacklog(
  host,
  { repository, onOrder = () => {}, orderRefs = [], isCurrent = () => true }
) {
  const data = await repository.getBacklog({})
  if (!isCurrent()) return { destroy() {} }
  const scope = new Set(orderRefs.map(refKey)),
    heading = el('h2', m('Global Backlog')),
    summary = el('p'),
    scroller = el('div', undefined, 'smart-grid-scroll'),
    table = el('table'),
    head = el('thead'),
    body = el('tbody'),
    tr = el('tr')
  for (const title of [
    'Order',
    'Shipment status',
    'Packing readiness',
    'Remaining pieces',
    'Known cartons',
    'Reserved by',
  ])
    tr.append(el('th', m(title)))
  head.append(tr)
  table.append(head, body)
  scroller.append(table)
  summary.append(
    el(
      'span',
      m(
        data.totals.quantityComplete === false
          ? 'Known remaining pieces'
          : 'Remaining pieces'
      )
    ),
    el('strong', String(data.totals.quantity ?? '—')),
    el('span', m('Known cartons')),
    el('strong', String(data.totals.cartons ?? data.totals.knownCartons ?? '—'))
  )
  if (data.totals.quantityComplete === false)
    summary.append(
      el(
        'span',
        m('Unknown quantity in {0} orders', {
          0: data.totals.unknownQuantityOrders ?? '—',
        })
      )
    )
  host.replaceChildren(heading, summary, scroller)
  const virtual = createVirtualTable({
    scroller,
    body,
    render: (entries) =>
      entries.map(({ order }) => {
        const tr = el('tr'),
          ref = orderRef(order)
        tr.tabIndex = 0
        const statuses = {
          'not-shipped': 'Not shipped',
          'partially-shipped': 'Partially shipped',
          'fully-shipped': 'Fully shipped',
          'awaiting-report': 'Awaiting report',
          ready: 'Ready',
          'needs-reconciliation': 'Needs reconciliation',
          'needs-review': 'Needs review',
        }
        for (const value of [
          order.record?.snapshot.sellerName || ref.orderId,
          m(
            statuses[order.shipmentStatus] ||
              order.shipmentStatus ||
              'Not shipped'
          ),
          m(
            statuses[order.packingReadiness] ||
              order.packingReadiness ||
              'Awaiting report'
          ),
          order.remainingQuantity,
          order.cartonsUnknown
            ? order.knownCartons
              ? m('{0} known cartons · Total unknown', {
                  0: order.knownCartons,
                })
              : m('Cartons unknown')
            : order.knownCartons,
          order.reservation?.containerName ||
            order.reservation?.containerId ||
            '—',
        ])
          tr.append(el('td', String(value ?? '—')))
        if (order.carryover) tr.classList.add('backlog-carryover')
        tr.onclick = (event) => {
          if (!event.target.closest('button,input,a')) onOrder(ref)
        }
        tr.onkeydown = (event) => {
          if (event.key === 'Enter' && !event.isComposing) onOrder(ref)
        }
        return tr
      }),
    limit: 100,
  })
  virtual.setItems(
    data.orders
      .filter((order) => !scope.size || scope.has(refKey(orderRef(order))))
      .map((order) => ({ key: refKey(orderRef(order)), order }))
  )
  return {
    destroy() {
      virtual.destroy()
      host.replaceChildren()
    },
  }
}
