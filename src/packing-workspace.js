import { createProductAuthoring } from './product-authoring.js'
import { createProductOutput } from './product-output.js'
import {
  createContainerWorkspace,
  mountBacklog,
} from './container-workspace.js'
import {
  createOrderCartonSession,
  mountOrderCartonGrid,
  mountCartonHistory,
  openPackingReportIntake,
} from './order-carton-grid.js'
import { element as el, copied } from './ui.js'
import { message as m, bindText } from './i18n.js'
import { readBackupFile, downloadBackup } from './backup-file.js'
import { groupPackingMonth } from './packing-model.js'
import { showErrorNotice } from './error-notice.js'
import { validateBackup } from './database.js'
import { reviewPackingChanges } from './packing-review.js'
import { orderSource } from './other-orders.js'

const $ = (id) => document.getElementById(id)

/** One shell. Orders owns authorship; Packing owns container decisions. */
export async function startPackingWorkspace({
  repository,
  getRecords,
  getRows,
  getSelectedRows = getRows,
  getSelectedOrders = () => [],
  headers,
  changed,
  feedback,
  loadImage,
  onProductDetails = () => {},
  onProductPhotoEdit,
  onReadOnlyProductDetails = () => {},
  planner,
  workbookAdapter,
  loadPlanner = () => import('./carton-reconciliation.js'),
  loadWorkbookAdapter = () => import('./container-export.js'),
  loadReportClient = () => import('./packing-report-client.js'),
}) {
  let workspace = 'orders',
    ordersView = 'products',
    returnTo,
    opening = false,
    grid,
    backlog,
    activeSession,
    currentOrder,
    modules,
    cartonHistory,
    cartonScope = '',
    cartonVersion = 0,
    containers
  const sessions = new Map()
  let backlogVersion = 0,
    backlogScope = ''
  const failure = (error) => {
    showErrorNotice(error)
  }
  async function modulesForOrders() {
    return (planner ||= await loadPlanner())
  }
  async function adapter() {
    if (workbookAdapter) return workbookAdapter
    const api = await loadWorkbookAdapter()
    return (workbookAdapter = {
      plan: api.planContainerWorkbook,
      create: api.createContainerWorkbook,
      summary: api.createContainerSummary,
      printRows: api.containerPrintRows,
      fileName: api.containerWorkbookFileName,
    })
  }
  const authoring = await createProductAuthoring({
    repository,
    getRecords,
    changed,
    feedback,
    loadImage,
    getSelectedRows,
    onCartons: openOrder,
    onPhotoEdit: onProductPhotoEdit,
    onAmend: (dependency) =>
      void showPacking({
        containerId: dependency.containerId,
        view: 'loading',
      }).catch(failure),
    getContextContainerId: () =>
      containers?.controller.view()?.container.amendment
        ? returnTo?.containerId
        : undefined,
  })
  const output = createProductOutput({
    repository,
    authoring,
    loadImage,
    headers,
    feedback,
    editInOrders,
    workbookAdapter: {
      plan: (...args) => {
        if (!modules)
          throw new Error('Container output is loading. Retry the export.')
        return modules.plan(...args)
      },
      create: async (...args) => (await adapter()).create(...args),
      summary: (...args) => modules.summary(...args),
      printRows: (...args) => {
        if (!modules)
          throw new Error('Container output is loading. Retry the export.')
        return modules.printRows(...args)
      },
      fileName: (...args) => modules.fileName(...args),
    },
  })
  containers = createContainerWorkspace({
    host: $('container-content'),
    repository,
    output: {
      ...output,
      async printLabels(...args) {
        modules = await adapter()
        return output.printLabels(...args)
      },
      async openWorkbook(context) {
        modules = await adapter()
        return output.openWorkbook(context)
      },
    },
    inspectProduct: onReadOnlyProductDetails,
    editInOrders,
    loadImage,
    onError: failure,
    onRoute(route) {
      if (workspace === 'packing') rememberRoute(route)
    },
  })
  function rememberRoute(route) {
    const url = new URL(location.href)
    url.hash = new URLSearchParams(
      Object.entries(route).filter(
        ([, value]) => value != null && typeof value !== 'object'
      )
    ).toString()
    history.replaceState(null, '', url)
  }
  function paint() {
    $('orders-view').hidden = workspace !== 'orders'
    $('packing-view').hidden = workspace !== 'packing'
    document.body.classList.toggle('packing-active', workspace === 'packing')
    for (const name of ['orders', 'packing']) {
      const button = $(`view-${name}`)
      if (!button) continue
      if (name === workspace) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    }
    for (const name of ['products', 'cartons', 'backlog'])
      $(`orders-${name}-view`).hidden = ordersView !== name
    $('orders-actions').hidden = ordersView !== 'products' && !returnTo
    for (const button of $('orders-subviews').querySelectorAll('button')) {
      if (button.dataset.ordersView === ordersView)
        button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    }
    $('return-to-container').hidden = !returnTo
  }
  async function flush() {
    await authoring.flush()
    if (activeSession) await activeSession.flush()
    await containers.flush()
  }
  async function showOrders(view = ordersView) {
    await flush()
    await authoring.reload()
    workspace = 'orders'
    ordersView = view
    paint()
    if (view === 'backlog') {
      await refreshBacklog()
    } else if (view === 'cartons') {
      const refs = getSelectedOrders()
      if (
        refs.length === 1 &&
        (!currentOrder ||
          JSON.stringify(currentOrder) !== JSON.stringify(refs[0]))
      )
        return openOrder(refs[0])
      if (refs.length !== 1) {
        currentOrder = undefined
        grid?.destroy()
        activeSession = undefined
        await showCartonHistory()
      }
    }
    rememberRoute({
      workspace: 'orders',
      view,
      orderId: currentOrder?.orderId,
      accountId: currentOrder?.accountId,
    })
  }
  async function refreshBacklog() {
    const version = ++backlogVersion,
      orderRefs = getSelectedOrders()
    backlogScope = JSON.stringify(orderRefs)
    backlog?.destroy()
    const next = await mountBacklog($('orders-backlog-view'), {
      repository,
      orderRefs,
      onOrder: openOrder,
      isCurrent: () =>
        version === backlogVersion &&
        workspace === 'orders' &&
        ordersView === 'backlog',
    })
    if (version === backlogVersion) backlog = next
    else next.destroy()
  }
  async function showPacking(route) {
    await flush()
    workspace = 'packing'
    paint()
    if (route?.containerId) {
      await containers.open(route.containerId, route.revisionId)
      containers.show(route.view || 'loading')
    } else await containers.reload()
    rememberRoute({ ...containers.route(), workspace: 'packing' })
  }
  async function showCartonHistory(
    host = $('orders-cartons-view'),
    refs = getSelectedOrders()
  ) {
    const version = ++cartonVersion
    cartonScope = JSON.stringify(refs)
    cartonHistory?.destroy()
    const next = await mountCartonHistory(host, {
      repository,
      contextContainerId: containers.controller.view()?.container.amendment
        ? returnTo?.containerId
        : undefined,
      onAmend: (dependency) =>
        void showPacking({
          containerId: dependency.containerId,
          view: 'loading',
        }).catch(failure),
      orderRefs: refs,
      onOrder: (ref) => void openOrder(ref).catch(failure),
      isCurrent: () =>
        version === cartonVersion &&
        workspace === 'orders' &&
        ordersView === 'cartons',
    })
    if (version === cartonVersion) cartonHistory = next
    else next.destroy()
  }
  async function openOrder(ref) {
    if (opening) return
    opening = true
    try {
      await flush()
      const orderRef = {
        accountId: ref.accountId || ref.record?.accountId || 'local',
        orderId: ref.orderId,
      }
      if (!orderRef.orderId) throw new Error('Choose an order to reconcile.')
      const amendmentId =
        containers.controller.view()?.container.amendment &&
        returnTo?.containerId
      const key = JSON.stringify([
        orderRef.accountId,
        orderRef.orderId,
        amendmentId || null,
        containers.controller.view()?.container.amendment?.epoch || null,
      ])
      let session = sessions.get(key)
      if (!session) {
        session = await createOrderCartonSession({
          repository,
          orderRef,
          planner: await modulesForOrders(),
          onError: failure,
          getContextContainerId: () => amendmentId,
        })
        sessions.set(key, session)
      }
      grid?.destroy()
      cartonHistory?.destroy()
      activeSession = session
      currentOrder = orderRef
      cartonScope = JSON.stringify(getSelectedOrders())
      workspace = 'orders'
      ordersView = 'cartons'
      paint()
      const host = $('orders-cartons-view'),
        heading = el('div', undefined, 'order-reconciliation-heading'),
        title = el(
          'h2',
          `${getRecords().find((record) => record.snapshot.orderId === ref.orderId)?.snapshot.sellerName || ''} · ${ref.orderId}`
        ),
        productView = el('button', m('Product calculations')),
        cartonView = el('button', m('Physical cartons')),
        historyView = el('button', m('Carton history')),
        mount = el('div')
      heading.append(title, productView, cartonView, historyView)
      const record =
        getRecords().find(
          (record) =>
            record.snapshot.orderId === ref.orderId &&
            (record.accountId || 'local') === orderRef.accountId
        ) || session.record()
      if (record && orderSource(record.snapshot) === '1688') {
        const report = el('button', m('Paste or import carton list'))
        report.dataset.action = 'paste-import-carton-list'
        report.onclick = () =>
          void (async () => {
            await flush()
            const { createPackingReportClient } = await loadReportClient()
            await openPackingReportIntake({
              repository,
              orderRef,
              contextContainerId: amendmentId,
              createClient: createPackingReportClient,
              onSaved: async () => {
                grid?.destroy()
                activeSession?.dispose()
                activeSession = undefined
                sessions.delete(key)
                await changed({ reload: true })
                await openOrder(orderRef)
              },
              onAmend: (dependency) =>
                showPacking({
                  containerId: dependency.containerId,
                  view: 'loading',
                }),
            })
          })().catch(failure)
        heading.append(report)
      }
      host.replaceChildren(heading, mount)
      function mountGrid(kind) {
        cartonVersion++
        cartonHistory?.destroy()
        grid?.destroy()
        grid = mountOrderCartonGrid(mount, {
          session,
          kind,
          loadImage,
          onInspect: (row) => {
            if (row.source) onProductDetails({ ...row.source, ...orderRef })
          },
          onError: failure,
        })
      }
      productView.dataset.action = 'reconciliation-products'
      cartonView.dataset.action = 'reconciliation-cartons'
      productView.onclick = () => mountGrid('products')
      cartonView.onclick = () => mountGrid('cartons')
      historyView.dataset.action = 'order-carton-history'
      historyView.onclick = () => {
        grid?.destroy()
        void showCartonHistory(mount, [orderRef]).catch(failure)
      }
      mountGrid(ref.cartonId ? 'cartons' : 'products')
      if (ref.entryId)
        grid.reveal(
          JSON.stringify([orderRef.accountId, orderRef.orderId, ref.entryId])
        )
      if (ref.cartonId) grid.reveal(ref.cartonId, 'dimensions')
      rememberRoute({ workspace: 'orders', view: 'cartons', ...orderRef })
    } finally {
      opening = false
    }
  }
  async function editInOrders(ref, route) {
    await flush()
    returnTo = structuredClone(route || containers.route())
    paint()
    if (ref.view === 'cartons' || ref.cartonId) return openOrder(ref)
    await showOrders('products')
    if (ref.entryId) await authoring.openEditor(ref)
  }
  for (const button of $('orders-subviews').querySelectorAll('button'))
    button.onclick = () =>
      void showOrders(button.dataset.ordersView).catch(failure)
  $('view-orders').onclick = () => void showOrders().catch(failure)
  $('view-packing').onclick = () => void showPacking().catch(failure)
  $('return-to-container').onclick = () =>
    void showPacking(returnTo)
      .then(() => {
        returnTo = undefined
        paint()
      })
      .catch(failure)
  $('review-purchase-codes').onclick = () =>
    void authoring.reviewCodes(getSelectedRows()).catch(failure)
  $('include-orders').onclick = () =>
    void (async () => {
      const refs = getSelectedOrders()
      await showPacking()
      if (!containers.route().containerId)
        throw new Error('Choose a container before including orders.')
      if (!refs.length)
        throw new Error('Select whole orders with their checkboxes first.')
      await containers.controller.includeOrders(refs)
    })().catch(failure)
  $('group-order-products').onclick = () =>
    void authoring.groupProducts?.(getSelectedRows()).catch(failure)
  $('copy-preparation').onclick = () =>
    void output.copyPreparation(getRows()).catch(failure)
  $('copy-group-codes').onclick = () =>
    void (async () => {
      const context = await output.ordersContext(getRows()),
        codes = [
          ...new Set(
            context.products.map((row) => row.baseCode).filter(Boolean)
          ),
        ]
      if (!codes.length)
        throw new Error('Review product codes in Orders first.')
      await copied($('copy-group-codes'), () =>
        navigator.clipboard.writeText(codes.join('\r\n'))
      )
    })().catch(failure)
  const restoreFile = $('restore-packing-file')
  $('backup-packing').onclick = () =>
    void (async () => {
      const rows = structuredClone(getRows()),
        selection = new Map()
      if (!rows.length) throw new Error('Select product rows to back up.')
      await flush()
      for (const row of rows) {
        const accountId = row.accountId || row.record?.accountId || 'local',
          key = JSON.stringify([accountId, row.orderId])
        if (!selection.has(key))
          selection.set(key, { accountId, orderId: row.orderId, entryIds: [] })
        selection.get(key).entryIds.push(row.entryId)
      }
      const preparations = await repository.listPreparations(),
        months = new Set()
      for (const order of selection.values()) {
        const preparation = preparations.find(
            (prep) =>
              prep.orderId === order.orderId &&
              (prep.accountId || 'local') === order.accountId
          ),
          ids = new Set(order.entryIds)
        if (
          !preparation ||
          order.entryIds.some(
            (id) =>
              !preparation.groups.some((group) =>
                group.variants.some((variant) => variant.entryIds.includes(id))
              )
          )
        )
          throw new Error('Review product codes in Orders first.')
        for (const group of preparation.groups)
          if (
            group.variants.some((variant) =>
              variant.entryIds.some((id) => ids.has(id))
            )
          )
            months.add(groupPackingMonth(preparation, group))
      }
      const scope = {
        orders: [...selection.values()],
        months: [...months].sort(),
      }
      let backup,
        fullLibrary = false
      try {
        backup = await repository.exportBackup({ packingScope: scope })
      } catch (error) {
        if (error.code !== 'PACKING_BACKUP_DEPENDENCY_REVIEW') throw error
        const required =
          error.requiredOrderRefs || error.detail?.requiredOrderRefs || []
        if (
          !(await reviewPackingChanges({
            title: m('Review backup dependencies'),
            explanation: m(
              'The selected products share retained report, carton or shipment history. Create a complete library backup to keep those dependencies and original media together. Restore this file through Settings → Data.'
            ),
            changes: required.map((ref) => ({
              name: ref.orderId,
              before: m('Partial product selection'),
              after: m('Complete library and historical dependencies'),
            })),
            proceed: m('Back up full library'),
          }))
        )
          return
        backup = await repository.exportBackup({})
        fullLibrary = true
      }
      if (
        backup.omittedCartonBatchIds?.length &&
        !(await reviewPackingChanges({
          title: m('Review scoped backup'),
          explanation: m(
            'Some carton evidence includes unselected source products. This scoped backup omits those physical records; a full library backup retains them.'
          ),
          changes: backup.omittedCartonBatchIds.map((id) => ({
            name: id,
            before: m('Physical carton evidence'),
            after: m('Omitted from this scoped backup'),
          })),
          proceed: m('Back up selection'),
        }))
      )
        return
      await downloadBackup(
        backup,
        fullLibrary
          ? '1688-order-library'
          : `1688-packing-${scope.months.length === 1 ? scope.months[0] : 'mixed-months'}`
      )
      feedback(m('Packing backup saved'))
    })().catch(failure)
  $('restore-packing').onclick = () => restoreFile.click()
  restoreFile.onchange = () =>
    void (async () => {
      const file = restoreFile.files[0]
      restoreFile.value = ''
      if (!file) return
      await flush()
      const input = await readBackupFile(file),
        backup = validateBackup(input)
      if (!backup.packingScope)
        throw new Error(
          'Choose a file created by Back up packing. Use Settings → Data → Restore for a full-library backup.'
        )
      if (
        !(await reviewPackingChanges({
          title: m('Restore packing backup?'),
          explanation: m(
            'Restore the scoped source and product evidence while preserving newer local edits. Containers and historical facts remain subject to revision validation.'
          ),
          changes: backup.packingScope.orders.map((order) => ({
            orderId: order.orderId,
            name: order.orderId,
            before: m('Current saved data'),
            after: m('Keep newer edits'),
          })),
          proceed: m('Restore packing'),
        }))
      )
        return
      await repository.restoreBackup(input)
      await changed({ reload: true })
      await showOrders('products')
    })().catch(failure)
  addEventListener('beforeunload', (event) => {
    if (
      !authoring.status().dirty &&
      ![...sessions.values()].some((session) => session.recoveryPending())
    )
      return
    event.preventDefault()
    event.returnValue = ''
  })
  addEventListener(
    'pagehide',
    () => {
      grid?.destroy()
      cartonHistory?.destroy()
      backlog?.destroy()
      for (const session of sessions.values()) session.dispose()
      containers.dispose()
      authoring.dispose()
    },
    { once: true }
  )
  paint()
  const hash = new URLSearchParams(location.hash.slice(1))
  if (hash.get('workspace') === 'packing' && hash.get('containerId'))
    await showPacking({
      containerId: hash.get('containerId'),
      revisionId: hash.get('revisionId') || undefined,
      view: hash.get('view') || 'loading',
    })
  else if (
    hash.get('workspace') === 'orders' &&
    hash.get('view') === 'cartons' &&
    hash.get('orderId')
  )
    await openOrder({
      accountId: hash.get('accountId') || 'local',
      orderId: hash.get('orderId'),
    })
  else if (hash.get('workspace') === 'orders' && hash.get('view') === 'backlog')
    await showOrders('backlog')
  else if (hash.get('workspace') === 'orders' && hash.get('view') === 'cartons')
    await showOrders('cartons')
  return {
    ...authoring,
    copyLabels: output.copyLabels,
    printLabels: output.printLabels,
    openRecentPrints: async () => {
      modules = await adapter()
      return output.openRecentPrints()
    },
    async reload() {
      await authoring.reload()
      if (workspace === 'packing') await containers.reload()
      if (workspace === 'orders' && ordersView === 'backlog') {
        await refreshBacklog()
      }
      if (workspace === 'orders' && ordersView === 'cartons' && !currentOrder)
        await showCartonHistory()
      else if (workspace === 'orders' && ordersView === 'cartons')
        await activeSession?.refresh()
    },
    updateActions() {
      if (
        workspace === 'orders' &&
        ordersView === 'cartons' &&
        JSON.stringify(getSelectedOrders()) !== cartonScope
      ) {
        cartonScope = JSON.stringify(getSelectedOrders())
        void showOrders('cartons').catch(failure)
      }
      if (
        workspace === 'orders' &&
        ordersView === 'backlog' &&
        JSON.stringify(getSelectedOrders()) !== backlogScope
      )
        void refreshBacklog().catch(failure)
    },
    openOrder,
    editInOrders,
    showOrders,
    showPacking,
    flush,
    output,
    containers,
    errorOptions: (error) => ({
      action: {
        label: m('Edit in Orders'),
        onClick: () => editInOrders(error.packingIssue || {}),
      },
    }),
  }
}
