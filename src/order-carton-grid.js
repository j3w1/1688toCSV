import { element as el, copyTextButton, copied } from './ui.js'
import { message as m, bindText, bindAttribute, isMessage } from './i18n.js'
import { createVirtualTable } from './virtual-table.js'
import { cartonBatchMetrics } from './carton-batches.js'
import { physicalUnits, batchNeedsLegacyReview } from './inventory-model.js'
import { reviewPackingChanges } from './packing-review.js'
import { setCodeText } from './code-display.js'
import { decorateIcon } from './icons.js'
import { measurementWarningMessages } from './ui-messages-smart-cartons.js'
import { physicalMarkReadback } from './physical-mark-aliases.js'
import { makeOrderCartonPrintRef } from './print-store.js'
import { showErrorNotice } from './error-notice.js'

const clone = (value) => structuredClone(value)
export const sourceKey = ({ accountId = 'local', orderId, entryId }) =>
  JSON.stringify([accountId, orderId, entryId])

export const PRODUCT_GRID_COLUMNS = [
  { key: 'photo', label: 'Photo', readonly: true },
  { key: 'code', label: 'Code', readonly: true },
  { key: 'purchased', label: 'Purchased', readonly: true },
  { key: 'available', label: 'Available for packing', readonly: true },
  { key: 'capacity', label: 'Pcs/box', type: 'whole' },
  { key: 'proposedCount', label: 'Proposed cartons', readonly: true },
  { key: 'unassigned', label: 'Unassigned pieces', readonly: true },
  { key: 'pattern', label: 'Packing pattern', readonly: true },
]
export const CARTON_GRID_COLUMNS = [
  { key: 'label', label: 'Carton reference', readonly: true },
  { key: 'contents', label: 'Contents', readonly: true },
  { key: 'dimensions', label: 'Dimensions (cm)', type: 'dimensions' },
  { key: 'weight', label: 'Weight (kg)', type: 'decimal' },
  { key: 'suppliedCbm', label: 'Supplied volume (m³)', type: 'decimal' },
  { key: 'weightBasis', label: 'Weight basis', readonly: true },
  { key: 'volumeBasis', label: 'Volume basis', readonly: true },
  { key: 'count', label: 'Carton count', readonly: true },
  { key: 'physicalMarkCode', label: 'Recorded physical mark', readonly: true },
  { key: 'currentProductCode', label: 'Current product code', readonly: true },
  { key: 'provenance', label: 'Evidence', readonly: true },
]

function supersededMarkMessages(review) {
  return [
    m(
      review.physicalMarkConflictReason ||
        'The recorded carton mark is superseded. Print the current product mark and confirm physical relabeling.'
    ),
  ]
}

function appendSupersededMarkEvidence(card, review) {
  if (!review.physicalMarkRelabelOnly) return
  const evidence = el('div', undefined, 'physical-mark-supersession')
  evidence.dataset.markSupersession = 'true'
  evidence.dataset.markConflictKind = review.physicalMarkConflictKind || ''
  for (const message of supersededMarkMessages(review))
    evidence.append(el('p', message))
  evidence.append(el('strong', m('Retained ownership evidence')))
  for (const entry of review.physicalMarkSupersessions || []) {
    if (entry.reason) {
      const reason = el('p')
      reason.append(el('strong', m('Reason')), el('span', entry.reason))
      evidence.append(reason)
    }
    for (const conflict of entry.conflicts || [])
      evidence.append(
        el(
          'p',
          m('Retained code owner: {order} / {group}', {
            order: conflict.orderId,
            group: conflict.groupId,
          })
        )
      )
    for (const conflict of entry.conflicts || [])
      if (conflict.containerId)
        evidence.append(
          el(
            'p',
            m('Retained shipment {shipment} (revision {revision})', {
              shipment: conflict.containerId,
              revision: conflict.revisionId || '—',
            })
          )
        )
    for (const current of entry.currentProducts || [])
      evidence.append(
        el(
          'p',
          m('Recorded related product: {code} ({order} / {group})', {
            code: current.productCode,
            order: current.mark.orderId,
            group: current.mark.groupId,
          })
        )
      )
  }
  card.append(evidence)
}

/** Explicit Orders decisions; this control never writes or invents mark facts. */
export function mountPhysicalMarkChoices({
  host,
  apply,
  reviews,
  onChange,
  allowRelabel = true,
  onPrintMark,
  canPrintCurrent = () => true,
}) {
  const pending = reviews.filter((row) => row.resolutionRequired)
  if (!pending.length) {
    onChange?.({ valid: true, decisions: [] })
    return () => {}
  }
  const section = el('section', undefined, 'physical-mark-choices'),
    rows = [],
    composing = new Set()
  section.append(
    el('p', m('A verified seal requires a reviewed physical mark choice.'))
  )
  if (!allowRelabel)
    section.append(
      el(
        'p',
        m(
          'Relabeling must be confirmed on unsealed cartons. In an amendment, keep the recorded mark (shown beside the code) or finish the amendment first.'
        )
      )
    )
  for (const review of pending) {
    const id = review.id || review.batchId,
      groupName = `physical-mark-${crypto.randomUUID()}`,
      card = el('fieldset'),
      reason = el('textarea'),
      attestation = el(
        'label',
        m('I confirm this carton has been physically relabeled.')
      ),
      confirmed = el('input'),
      status = el('p'),
      choice = [],
      owner = el('select'),
      ownerChoices = review.physicalMarkOwnerChoices || [],
      allowedChoices = new Set(
        review.resolutionChoices ||
          review.physicalMarkResolutionChoices || [
            'keep-recorded-mark',
            'relabel-reprint',
          ]
      ),
      requiresOwner = !(
        review.currentProductCode || review.physicalMark?.productCode
      )
    card.dataset.action = 'physical-mark-decision'
    card.dataset.batchId = id
    card.append(
      el(
        'legend',
        m('{0}: {1}', {
          0: m('Carton reference'),
          1: review.cartonNumber || id,
        })
      )
    )
    for (const [label, value] of [
      [
        'Recorded physical mark',
        review.physicalMarkCode || review.physicalMark?.code || '—',
      ],
      [
        'Current product code',
        review.currentProductCode || review.physicalMark?.productCode || '—',
      ],
    ]) {
      const row = el('p'),
        code = el('code', undefined, 'ce-code')
      code.dataset.markCodeRole =
        label === 'Current product code' ? 'current-product' : 'recorded'
      setCodeText(code, value)
      row.append(el('strong', m(label)), code)
      card.append(row)
    }
    appendSupersededMarkEvidence(card, review)
    if (requiresOwner) {
      owner.dataset.action = 'choose-physical-mark-owner'
      bindAttribute(owner, 'aria-label', m('Choose the current product owner'))
      owner.append(
        new Option(String(m('Choose the current product owner')), '')
      )
      for (const candidate of ownerChoices)
        owner.append(
          new Option(
            `${candidate.productCode} · ${candidate.artwork?.spanishName || candidate.artwork?.title || ''}`,
            JSON.stringify(candidate.mark)
          )
        )
      owner.value = ''
      owner.onchange = () => {
        confirmed.checked = false
        update()
      }
      const ownerLabel = el('label', m('Choose the current product owner'))
      ownerLabel.append(owner)
      card.append(ownerLabel)
    }
    for (const [value, title] of [
      ['keep-recorded-mark', 'Keep the recorded physical mark'],
      ['relabel-reprint', 'Reprint and relabel with the current product code'],
    ]) {
      const label = el('label', m(title)),
        input = el('input')
      input.type = 'radio'
      input.name = groupName
      input.value = value
      input.disabled =
        !allowedChoices.has(value) ||
        (value === 'relabel-reprint' && !allowRelabel)
      input.dataset.action = 'choose-physical-mark'
      input.dataset.choice = value
      label.prepend(input)
      card.append(label)
      choice.push(input)
      input.onchange = () => {
        for (const other of choice) if (other !== input) other.checked = false
        confirmed.checked = false
        update()
      }
    }
    reason.maxLength = 2000
    reason.dataset.action = 'physical-mark-reason'
    bindAttribute(reason, 'aria-label', m('Reason for this mark decision'))
    const label = el('label', m('Reason for this mark decision'))
    label.append(reason)
    confirmed.type = 'checkbox'
    confirmed.dataset.action = 'confirm-physical-relabel'
    confirmed.onchange = update
    attestation.prepend(confirmed)
    attestation.hidden = true
    reason.addEventListener('input', update)
    reason.addEventListener('compositionstart', () => {
      composing.add(reason)
      update()
    })
    reason.addEventListener('compositionend', () => {
      composing.delete(reason)
      update()
    })
    status.setAttribute('role', 'status')
    card.append(label, attestation, status)
    section.append(card)
    const state = {
      id,
      review,
      choice,
      reason,
      confirmed,
      attestation,
      status,
      owner,
      ownerChoices,
      requiresOwner,
      allowedChoices,
      currentCode: card.querySelector(
        '[data-mark-code-role="current-product"]'
      ),
      printBusy: false,
      printButtons: [],
    }
    rows.push(state)
    if (onPrintMark) {
      const printing = el('div', undefined, 'physical-mark-print-actions')
      for (const [role, title] of [
        ['recorded', 'Print recorded mark'],
        ['current-product', 'Print current product mark'],
      ]) {
        const button = el('button', m(title))
        button.type = 'button'
        button.dataset.action = 'print-order-carton-mark'
        button.dataset.markRole = role
        button.onclick = () =>
          void (async () => {
            const target = ownerChoices.find(
              (candidate) => JSON.stringify(candidate.mark) === owner.value
            )
            if (
              state.printBusy ||
              (role === 'recorded' && review.physicalMarkRelabelOnly) ||
              (role === 'current-product' &&
                ((requiresOwner && !target) ||
                  !canPrintCurrent(review, target?.mark)))
            )
              return
            state.printBusy = true
            update()
            let failure
            try {
              await onPrintMark({ review, role, targetMark: target?.mark })
            } catch (error) {
              failure = error
              if (error.noticeOptions)
                showErrorNotice(error, { scope: host.closest('dialog') })
            } finally {
              state.printBusy = false
              update()
              if (failure) bindText(status, m(failure.message))
            }
          })()
        state.printButtons.push(button)
        printing.append(button)
      }
      card.append(printing)
    }
  }
  function update() {
    let valid = !composing.size && !rows.some((row) => row.printBusy)
    const decisions = rows.map((row) => {
      const choice = row.choice.find((input) => input.checked)?.value || '',
        relabel = choice === 'relabel-reprint',
        target = row.requiresOwner
          ? row.ownerChoices.find(
              (candidate) => JSON.stringify(candidate.mark) === row.owner.value
            )
          : null,
        ready = Boolean(
          choice &&
          row.allowedChoices.has(choice) &&
          row.reason.value.trim() &&
          row.reason.value.length <= 2000 &&
          (target?.productCode ||
            row.review.currentProductCode ||
            row.review.physicalMark?.productCode) &&
          (!relabel || (allowRelabel && row.confirmed.checked))
        )
      row.attestation.hidden = !relabel
      setCodeText(
        row.currentCode,
        target?.productCode ||
          row.review.currentProductCode ||
          row.review.physicalMark?.productCode ||
          '—'
      )
      for (const button of row.printButtons) {
        const superseded =
            button.dataset.markRole === 'recorded' &&
            row.review.physicalMarkRelabelOnly,
          unavailable =
            superseded ||
            (button.dataset.markRole === 'current-product' &&
              ((row.requiresOwner && !target) ||
                !canPrintCurrent(row.review, target?.mark)))
        button.disabled = row.printBusy || unavailable
        if (superseded)
          bindAttribute(button, 'title', supersededMarkMessages(row.review)[0])
        else if (unavailable)
          bindAttribute(
            button,
            'title',
            m('Save this grouping before printing the proposed mark.')
          )
      }
      valid &&= ready
      bindText(
        row.status,
        m(
          ready
            ? 'Review this mark decision before applying.'
            : row.requiresOwner && !target
              ? 'Choose the current product owner'
              : relabel && !row.confirmed.checked
                ? 'Confirm physical relabeling before applying this choice.'
                : 'Choose a physical mark decision and enter its reason.'
        )
      )
      return {
        batchId: row.id,
        choice,
        reason: row.reason.value,
        physicalRelabelConfirmed: relabel && row.confirmed.checked,
        ...(target ? { targetMark: clone(target.mark) } : {}),
      }
    })
    apply.disabled = !valid
    onChange?.({ valid, decisions })
  }
  host.append(section)
  update()
  return () => section.remove()
}

/** Review a saved transition against its complete captured repository token. */
export async function openPhysicalMarkReview({
  repository,
  orderRef,
  batchId,
  contextContainerId,
  loadImage,
  onSaved = async () => {},
  onPrintMark,
}) {
  const ref = {
      accountId: orderRef.accountId || 'local',
      orderId: orderRef.orderId,
      ...(contextContainerId ? { contextContainerId } : {}),
    },
    context = await repository.getOrderReconciliation(ref),
    batch = context.batches.find((batch) => batch.id === batchId),
    expectedRevisions = clone(context.revisions),
    expectedAmendment = clone(
      context.amendmentContext || context.revisions?.amendmentContext
    )
  if (!batch?.physicalMark)
    throw new Error('This edit session is no longer available.')
  const modal = el(
      'dialog',
      undefined,
      'product-authoring-dialog physical-mark-dialog'
    ),
    host = el('div'),
    status = el('p'),
    actions = el('div', undefined, 'dialog-actions'),
    save = el('button', m('Save physical mark decision'), 'primary'),
    retry = el('button', m('Retry')),
    close = el('button', m('Close'))
  modal.dataset.action = 'review-physical-mark'
  bindAttribute(modal, 'aria-label', m('Review physical mark'))
  modal.append(
    el('h2', m('Review physical mark')),
    el(
      'p',
      m(
        batch.physicalMarkRelabelOnly
          ? 'Print the current product mark and confirm actual relabeling. Original quantities, prices and carton measurements stay unchanged.'
          : 'Keep the recorded mark alongside the current product code, or confirm actual relabeling. Original quantities, prices and carton measurements stay unchanged.'
      )
    )
  )
  const recordedEntries =
      batch.physicalMark.artwork?.entryIds ||
      batch.physicalMark.originalArtwork?.entryIds,
    source = recordedEntries?.length
      ? context.record.snapshot.items.find((item) =>
          recordedEntries.includes(item.entryId)
        )
      : context.record.snapshot.items.find((item) =>
          batch.contents.some((part) => part.entryId === item.entryId)
        )
  if (source?.thumbnail) {
    const photo = el('img', undefined, 'physical-mark-source-photo')
    photo.width = photo.height = 96
    photo.alt = source.description || source.title || source.entryId
    const url = loadImage ? await loadImage(source.thumbnail) : source.thumbnail
    photo.src = typeof url === 'string' ? url : url.dataUrl
    modal.append(photo)
  }
  let decision,
    valid = false,
    busy = false,
    saved,
    operation
  const printButtons = []
  if (onPrintMark) {
    const printing = el('div', undefined, 'physical-mark-print-actions')
    for (const [role, title] of [
      ['recorded', 'Print recorded mark'],
      ['current-product', 'Print current product mark'],
    ]) {
      const button = el('button', m(title))
      button.type = 'button'
      button.dataset.action = 'print-order-carton-mark'
      button.dataset.markRole = role
      const missingOwner =
        role === 'current-product' &&
        !(batch.currentProductCode || batch.physicalMark?.productCode)
      const superseded = role === 'recorded' && batch.physicalMarkRelabelOnly
      button.disabled = missingOwner || superseded
      if (superseded) {
        button.dataset.recordedMarkSuperseded = 'true'
        bindAttribute(button, 'title', supersededMarkMessages(batch)[0])
      }
      if (missingOwner) {
        button.dataset.ownerRequired = 'true'
        bindAttribute(
          button,
          'title',
          m(
            'Choose an existing current product owner before printing its mark.'
          )
        )
      }
      button.onclick = () =>
        void (async () => {
          if (busy || button.disabled) return
          printButtons.forEach((button) => {
            button.disabled = true
          })
          try {
            const index = physicalUnits(batch)[0]?.index,
              ref = await makeOrderCartonPrintRef(context, {
                batchId,
                role,
                index,
                ...(role === 'current-product' && decision?.targetMark
                  ? { productGroupId: decision.targetMark.groupId }
                  : {}),
              })
            await onPrintMark(ref)
          } catch (error) {
            bindText(status, m(error.message))
            if (error.noticeOptions) showErrorNotice(error, { scope: modal })
          } finally {
            printButtons.forEach((button) => {
              button.disabled =
                busy ||
                button.dataset.ownerRequired === 'true' ||
                button.dataset.recordedMarkSuperseded === 'true'
            })
          }
        })()
      printButtons.push(button)
      printing.append(button)
    }
    modal.append(printing)
  }
  const stop = mountPhysicalMarkChoices({
    host,
    apply: save,
    allowRelabel: !expectedAmendment,
    reviews: [
      {
        id: batch.id,
        cartonNumber: batch.cartonNumber,
        physicalMark: batch.physicalMark,
        physicalMarkOwnerChoices: batch.physicalMarkOwnerChoices,
        physicalMarkCode: batch.physicalMarkCode || batch.physicalMark.code,
        physicalMarkRelabelOnly: batch.physicalMarkRelabelOnly,
        physicalMarkSupersessions: batch.physicalMarkSupersessions,
        physicalMarkConflictKind: batch.physicalMarkConflictKind,
        physicalMarkConflictReason: batch.physicalMarkConflictReason,
        physicalMarkHistoricalReviewRequired:
          batch.physicalMarkHistoricalReviewRequired,
        resolutionChoices: batch.physicalMarkResolutionChoices,
        currentProductCode:
          batch.currentProductCode || batch.physicalMark.productCode,
        resolutionRequired: true,
      },
    ],
    onChange: (value) => {
      valid = value.valid
      decision = value.decisions[0]
      save.disabled = busy || !valid
      for (const button of printButtons) {
        if (button.dataset.markRole !== 'current-product') continue
        const missing =
          !(batch.currentProductCode || batch.physicalMark.productCode) &&
          !context.preparation?.groups.some(
            (group) => group.id === decision?.targetMark?.groupId
          )
        button.dataset.ownerRequired = String(missing)
        button.disabled = busy || missing
      }
    },
  })
  const unavailable = new Set(
    [...host.querySelectorAll('input,textarea,select')].filter(
      (field) => field.disabled
    )
  )
  const lock = (value) => {
    busy = value
    save.disabled = value || !valid || Boolean(saved)
    close.disabled = value
    for (const field of host.querySelectorAll('input,textarea,select'))
      field.disabled = value || Boolean(saved) || unavailable.has(field)
    retry.disabled = value
    printButtons.forEach((button) => {
      button.disabled =
        value ||
        button.dataset.ownerRequired === 'true' ||
        button.dataset.recordedMarkSuperseded === 'true'
    })
  }
  const finish = async () => {
    await onSaved(saved)
    modal.close('saved')
  }
  const failed = (error) => {
    bindText(status, m(error.message))
    if (saved) retry.hidden = false
  }
  save.type = close.type = retry.type = 'button'
  save.dataset.action = 'save-physical-mark-decision'
  retry.dataset.action = 'retry-physical-mark-refresh'
  retry.hidden = true
  retry.onclick = () =>
    void (async () => {
      lock(true)
      try {
        await finish()
      } catch (error) {
        failed(error)
      } finally {
        lock(false)
      }
    })()
  save.onclick = () =>
    void (async () => {
      if (busy || saved || !valid) return
      const signature = JSON.stringify(decision)
      if (operation?.signature !== signature)
        operation = { signature, id: crypto.randomUUID() }
      lock(true)
      try {
        saved = await repository.resolveCartonPhysicalMark({
          ...ref,
          batchId,
          expectedRevisions,
          ...decision,
          ...(expectedAmendment ? { expectedAmendment } : {}),
          operationId: operation.id,
        })
        save.hidden = true
        bindText(status, m('Physical mark review saved'))
        await finish()
      } catch (error) {
        failed(error)
      } finally {
        lock(false)
      }
    })()
  status.setAttribute('role', 'status')
  close.onclick = () => {
    if (!busy) modal.close()
  }
  modal.oncancel = (event) => {
    if (busy) event.preventDefault()
  }
  modal.onclose = () => {
    stop()
    modal.remove()
  }
  actions.append(close, retry, save)
  modal.append(host, status, actions)
  document.body.append(modal)
  modal.showModal()
  return modal
}

/** Quantity is the whole set total unless the planner explicitly supplies perCarton. */
export function formatOrderPackingPattern(product, cartons = []) {
  return (product.pattern || [])
    .map((part) => {
      const carton = cartons.find((carton) => carton.id === part.cartonId),
        shared = product.sharedReferences?.find(
          (entry) => entry.id === part.cartonId
        ),
        reference =
          carton?.cartonNumber ||
          shared?.cartonNumber ||
          `${m('Internal reference')} ${part.cartonId}`
      if (part.perCarton == null && carton?.unitContents) {
        const units = physicalUnits(carton)
        if (units.length && units.every((unit) => unit.contents !== null))
          return units
            .flatMap((unit) =>
              unit.contents
                .filter((entry) => entry.entryId === product.entryId)
                .map((entry) =>
                  String(
                    m('{0} pieces in {1}', {
                      0: entry.quantity,
                      1: unit.reference,
                    })
                  )
                )
            )
            .join(' + ')
      }
      const pattern =
        part.perCarton != null
          ? `${part.count ?? 1} × ${part.perCarton}`
          : String(
              m('{0} pieces in {1} cartons; per-carton contents unknown', {
                0: part.quantity ?? '—',
                1: part.count ?? '—',
              })
            )
      return shared
        ? `${pattern} · ${m('{0} of this product · {1} total in shared {2}', { 0: shared.quantity ?? '—', 1: shared.totalPieces ?? '—', 2: reference })}`
        : pattern
    })
    .join(' + ')
}

/** Display retained evidence, including retired and review-held records. Never infer stock. */
export function cartonHistoryRows(state, orderRefs = []) {
  const key = ({ accountId = 'local', orderId }) =>
    JSON.stringify([accountId, orderId])
  const scope = new Set(orderRefs.map(key))
  const records = new Map(
    (state.records || []).map((record) => [
      key({
        accountId: record.accountId || record.snapshot.accountId || 'local',
        orderId: record.snapshot.orderId,
      }),
      record,
    ])
  )
  const covered = new Set()
  const rows = []
  const evidence = [
    ...(state.batches || []).flatMap((batch) => [
      batch,
      ...(batch.cartonHistory || []),
    ]),
    ...(state.cartonHistory || []).map(
      (entry) => entry.batch || entry.after || entry
    ),
  ]
  const seenEvidence = new Set()
  for (const batch of evidence) {
    const evidenceKey = JSON.stringify(batch)
    if (seenEvidence.has(evidenceKey)) continue
    seenEvidence.add(evidenceKey)
    const orderIds = [
      ...new Set(
        [
          batch.orderId,
          ...(batch.contents || []).map((part) => part.orderId),
          ...(batch.groups || []).map((part) => part.orderId),
          batch.mark?.orderId,
        ].filter(Boolean)
      ),
    ]
    const refs = orderIds.map((orderId) => ({
      accountId: batch.accountId || 'local',
      orderId,
    }))
    if (scope.size && !refs.some((ref) => scope.has(key(ref)))) continue
    refs.forEach((ref) => covered.add(key(ref)))
    const record = refs.length === 1 ? records.get(key(refs[0])) : undefined
    let metrics
    try {
      metrics = cartonBatchMetrics(batch)
    } catch {
      /* Retain malformed legacy evidence for review. */
    }
    rows.push({
      key: JSON.stringify([
        'batch',
        batch.accountId || 'local',
        batch.id,
        batch.revision,
        batch.updatedAt,
        batch.deletedAt,
        evidenceKey,
      ]),
      batch: clone(batch),
      refs,
      record,
      label: batch.cartonNumber || batch.supplierLabel || batch.id,
      internal:
        batch.labelOrigin === 'internal' ||
        (!batch.cartonNumber && !batch.supplierLabel),
      supplier: record?.snapshot.sellerName || '',
      order: orderIds.join(' · '),
      contents: (batch.contents || [])
        .map((part) => `${part.entryId}: ${part.quantity}`)
        .join(' · '),
      count: batch.count,
      dimensions:
        batch.len && batch.wid && batch.ht
          ? `${batch.len}×${batch.wid}×${batch.ht}`
          : '',
      weight: metrics?.totalWeight || null,
      volume:
        batch.volumeBasis === 'batch' && !batch.len
          ? batch.suppliedCbm || null
          : metrics?.totalVolume || null,
      state: batch.deletedAt
        ? 'Retired evidence'
        : batch.needsReview ||
            batchNeedsLegacyReview(batch) ||
            refs.length !== 1
          ? 'Needs review'
          : 'Confirmed facts',
    })
  }
  for (const [identity, record] of records) {
    if (covered.has(identity) || (scope.size && !scope.has(identity))) continue
    const [accountId, orderId] = JSON.parse(identity)
    rows.push({
      key: JSON.stringify(['pending', accountId, orderId]),
      refs: [{ accountId, orderId }],
      record,
      label: '—',
      supplier: record.snapshot.sellerName,
      order: orderId,
      state: 'Awaiting packing data',
    })
  }
  return rows
}

/** All Orders and an individual order use this same virtual evidence table. */
export async function mountCartonHistory(
  host,
  {
    repository,
    orderRefs = [],
    onOrder = () => {},
    onInspect = () => {},
    isCurrent = () => true,
    contextContainerId,
    onAmend = () => {},
    onPrintMark,
    loadImage,
  }
) {
  let destroyed = false
  const state = await repository.getOperationalState({})
  if (!isCurrent()) return { destroy() {} }
  const rows = cartonHistoryRows(state, orderRefs)
  const search = el('input'),
    count = el('p'),
    scroller = el('div', undefined, 'smart-grid-scroll'),
    table = el('table'),
    head = el('thead'),
    heading = el('tr'),
    body = el('tbody')
  search.type = 'search'
  bindAttribute(search, 'aria-label', m('Filter carton history'))
  table.dataset.action = 'carton-history'
  bindAttribute(table, 'aria-label', m('Carton history'))
  for (const title of [
    'Supplier',
    'Order',
    'Carton reference',
    'Contents',
    'Carton count',
    'Dimensions (cm)',
    'Weight (kg)',
    'Volume (m³)',
    'Evidence',
  ])
    heading.append(el('th', m(title)))
  head.append(heading)
  table.append(head, body)
  scroller.append(table)
  host.replaceChildren(search, count, scroller)
  const virtual = createVirtualTable({
    scroller,
    body,
    limit: 100,
    render(entries) {
      return entries.map(({ row }) => {
        const tr = el('tr')
        tr.dataset.historyKey = row.key
        tr.tabIndex = 0
        for (const value of [
          row.supplier,
          row.order,
          row.label,
          row.contents || m('Unknown contents'),
          row.count ?? '—',
          row.dimensions || '—',
          row.weight ?? '—',
          row.volume ?? '—',
        ])
          tr.append(el('td', value))
        const evidence = el('td', m(row.state))
        if (row.batch?.revision !== undefined)
          evidence.append(
            el('small', m('Retained revision {0}', { 0: row.batch.revision }))
          )
        if (row.internal) evidence.append(el('small', m('Internal reference')))
        if (row.batch?.unresolvedContents?.length)
          evidence.append(el('small', m('Unresolved contents')))
        tr.append(evidence)
        const inspect = () => {
          if (!row.batch && row.refs.length === 1) return onOrder(row.refs[0])
          const modal = el(
              'dialog',
              undefined,
              'order-carton-details product-authoring-dialog'
            ),
            close = el('button', m('Close'))
          modal.dataset.action = 'inspect-carton-history'
          modal.append(
            el('h2', row.label),
            el('p', m(row.state)),
            el('p', row.contents || m('Unknown contents'))
          )
          const facts = el('pre')
          facts.textContent = JSON.stringify(row.batch, null, 2)
          const disclosure = el('details')
          disclosure.append(el('summary', m('Source evidence')), facts)
          modal.append(disclosure)
          if (row.batch?.physicalMark) {
            const review = el('button', m('Review physical mark'))
            review.dataset.action = 'review-carton-physical-mark'
            review.onclick = () =>
              void openPhysicalMarkReview({
                repository,
                orderRef: row.refs[0],
                batchId: row.batch.id,
                contextContainerId,
                onPrintMark,
                loadImage,
                onSaved: async () => {
                  await refresh()
                  modal.close('saved')
                },
              }).catch((error) => modal.append(el('p', m(error.message))))
            modal.append(review)
          }
          if (batchNeedsLegacyReview(row.batch)) {
            modal.append(
              el(
                'p',
                m(
                  'Legacy loading counts are retained evidence, not a verified shipment. Availability remains held until an explicit review.'
                )
              )
            )
            const review = el('button', m('Review legacy carton evidence'))
            review.dataset.action = 'review-legacy-carton'
            review.onclick = () =>
              void openLegacyCartonReview({
                repository,
                batch: row.batch,
                contextContainerId,
                onSaved: async () => {
                  await refresh()
                  modal.close('saved')
                },
                onReconcile: onOrder,
                onAmend,
              }).catch((error) => {
                modal.append(el('p', m(error.message)))
              })
            modal.append(review)
          }
          for (const ref of row.refs) {
            const edit = el(
              'button',
              `${m('Reconcile cartons')} · ${ref.orderId}`
            )
            edit.dataset.action = 'open-order-cartons'
            edit.onclick = () => {
              modal.close()
              onOrder({ ...ref, cartonId: row.batch.id })
            }
            modal.append(edit)
          }
          close.onclick = () => modal.close()
          modal.append(close)
          modal.onclose = () => modal.remove()
          document.body.append(modal)
          modal.showModal()
          onInspect(row)
        }
        tr.onclick = inspect
        tr.onkeydown = (event) => {
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault()
            inspect()
          }
        }
        return tr
      })
    },
  })
  const render = () => {
    if (destroyed) return
    const query = search.value.toLowerCase(),
      visible = rows.filter((row) =>
        `${row.supplier} ${row.order} ${row.label} ${row.contents || ''}`
          .toLowerCase()
          .includes(query)
      )
    bindText(count, m('{0} evidence records', { 0: visible.length }))
    virtual.setItems(visible.map((row) => ({ key: row.key, row })))
  }
  search.oninput = render
  async function refresh() {
    const state = await repository.getOperationalState({})
    if (destroyed || !isCurrent()) return
    rows.splice(0, rows.length, ...cartonHistoryRows(state, orderRefs))
    render()
  }
  render()
  return {
    destroy() {
      destroyed = true
      virtual.destroy()
    },
    rows: () => clone(rows),
  }
}

/** Explicitly reviewed legacy recovery. The repository validates every affected budget. */
export async function openLegacyCartonReview({
  repository,
  batch,
  contextContainerId,
  onSaved = async () => {},
  onReconcile = () => {},
  onAmend = () => {},
}) {
  const review = await repository.reviewLegacyCarton({
      batchId: batch.id,
      expectedRevision: batch.revision,
    }),
    source = review.batch,
    contexts = review.orderContexts || [],
    modal = el(
      'dialog',
      undefined,
      'product-authoring-dialog legacy-carton-review'
    ),
    resolution = el('select'),
    owner = el('select'),
    contentsHost = el('div'),
    reason = el('textarea'),
    notShipped = el('input'),
    repacked = el('input'),
    status = el('p'),
    save = el('button', m('Confirm legacy evidence review')),
    close = el('button', m('Cancel')),
    recoveryKey = `1688-orders-legacy-arrangement:${JSON.stringify([source.accountId || 'local', source.id])}`
  modal.dataset.action = 'legacy-carton-review'
  modal.append(
    el('h2', m('Review legacy carton evidence')),
    el(
      'p',
      m(
        'Keep the original carton identity, count and measured evidence. Correct ownership only from actual evidence, or retire the original after physical repacking. No replacement cartons are created automatically.'
      )
    )
  )
  const original = el('pre')
  original.textContent = JSON.stringify(source, null, 2)
  const details = el('details')
  details.append(el('summary', m('Source evidence')), original)
  modal.append(details)
  const field = (title, control) => {
    const label = el('label', m(title))
    label.append(control)
    modal.append(label)
    return label
  }
  resolution.append(new Option(String(m('Choose a reviewed resolution')), ''))
  if (contexts.length === 1)
    resolution.append(
      new Option(
        String(m('Not shipped — reviewed legacy counts')),
        'not-shipped'
      )
    )
  resolution.append(
    new Option(
      String(m('Correct one source order from physical evidence')),
      'owner-corrected'
    ),
    new Option(
      String(m('Retire after physical repacking')),
      'retired-after-repack'
    )
  )
  field('Legacy resolution', resolution)
  owner.append(new Option(String(m('Choose the actual source order')), ''))
  for (const context of contexts)
    owner.append(
      new Option(
        `${context.record?.snapshot.sellerName || ''} · ${context.orderId}`,
        JSON.stringify([context.accountId || 'local', context.orderId])
      )
    )
  const ownerLabel = field('Actual source order', owner)
  modal.append(contentsHost)
  field('Legacy review reason', reason)
  notShipped.type = repacked.type = 'checkbox'
  field(
    'I reviewed the original evidence and confirm these legacy counts are not a verified shipment.',
    notShipped
  )
  const repackLabel = field(
    'I confirm these goods have actually been physically repacked into separate single-order cartons.',
    repacked
  )
  let values = {},
    inputs = [],
    saving = false,
    intent
  try {
    const recovered = JSON.parse(
      globalThis.localStorage?.getItem(recoveryKey) || 'null'
    )
    if (recovered) {
      resolution.value = recovered.resolution
      owner.value = recovered.owner
      reason.value = recovered.reason || ''
      values = recovered.values || {}
    }
  } catch {
    /* Recovery is UI-only; malformed drafts never become evidence. */
  }
  const retain = () =>
    globalThis.localStorage?.setItem(
      recoveryKey,
      JSON.stringify({
        resolution: resolution.value,
        owner: owner.value,
        reason: reason.value,
        values,
      })
    )
  function renderContents() {
    const selected = contexts.find(
      (context) =>
        JSON.stringify([context.accountId || 'local', context.orderId]) ===
        owner.value
    )
    ownerLabel.hidden = contentsHost.hidden =
      resolution.value !== 'owner-corrected'
    repackLabel.hidden = resolution.value !== 'retired-after-repack'
    contentsHost.replaceChildren(
      el(
        'p',
        m(
          'Confirmed whole-set product quantities. Blank cells assign no goods; source purchase quantities remain unchanged.'
        )
      )
    )
    inputs = []
    for (const item of selected?.record?.snapshot.items || []) {
      const label = el(
          'label',
          `${item.entryId} · ${item.description || item.title} · ${item.quantity}`
        ),
        input = el('input'),
        key = JSON.stringify([owner.value, item.entryId])
      input.type = 'text'
      input.inputMode = 'numeric'
      input.value =
        values[key] ??
        source.contents?.find(
          (part) =>
            part.orderId === selected.orderId && part.entryId === item.entryId
        )?.quantity ??
        ''
      input.dataset.legacyEntryId = item.entryId
      input.oninput = () => {
        values[key] = input.value
        retain()
      }
      label.append(input)
      contentsHost.append(label)
      inputs.push({ entryId: item.entryId, input })
    }
    retain()
  }
  resolution.onchange = renderContents
  owner.onchange = renderContents
  reason.oninput = retain
  renderContents()
  const amendmentRequired =
    review.affectedShipmentRevisions?.length && !contextContainerId
  for (const dependency of amendmentRequired
    ? review.affectedShipmentRevisions
    : []) {
    const amend = el('button', m('Open container amendment'))
    amend.onclick = () => {
      modal.close()
      onAmend(dependency)
    }
    modal.append(amend)
  }
  save.disabled = Boolean(amendmentRequired)
  save.dataset.action = 'resolve-legacy-carton'
  save.onclick = () =>
    void (async () => {
      if (saving) return
      if (!resolution.value || !notShipped.checked || !reason.value.trim())
        throw new Error(
          'Confirm the reviewed legacy evidence and document a reason.'
        )
      const selected = contexts.find(
          (context) =>
            JSON.stringify([context.accountId || 'local', context.orderId]) ===
            owner.value
        ),
        ownerRef = selected
          ? {
              accountId: selected.accountId || 'local',
              orderId: selected.orderId,
            }
          : undefined,
        contents = inputs
          .filter(({ input }) => input.value.trim())
          .map(({ entryId, input }) => ({
            orderId: ownerRef?.orderId,
            entryId,
            quantity: input.value.trim(),
          }))
      if (
        resolution.value === 'owner-corrected' &&
        (!ownerRef ||
          !contents.length ||
          contents.some((part) => !/^[1-9]\d*$/.test(part.quantity)))
      )
        throw new Error(
          'Choose the actual source order and its supported positive whole product quantities.'
        )
      if (resolution.value === 'retired-after-repack' && !repacked.checked)
        throw new Error(
          'Confirm that the physical repacking has already happened.'
        )
      const args = {
          batchId: source.id,
          expectedRevision: source.revision,
          expectedOrderRevisions: review.expectedOrderRevisions,
          resolution: resolution.value,
          attestNotShipped: true,
          ...(resolution.value === 'retired-after-repack'
            ? { attestRepacked: true }
            : {}),
          ...(resolution.value === 'owner-corrected'
            ? { ownerRef, contents }
            : {}),
          reason: reason.value.trim(),
          ...(contextContainerId ? { contextContainerId } : {}),
          ...(review.amendmentContext ||
          Object.values(review.expectedOrderRevisions || {}).find(
            (revision) => revision.amendmentContext
          )?.amendmentContext
            ? {
                expectedAmendment:
                  review.amendmentContext ||
                  Object.values(review.expectedOrderRevisions).find(
                    (revision) => revision.amendmentContext
                  ).amendmentContext,
              }
            : {}),
        },
        signature = JSON.stringify(args)
      if (intent?.signature !== signature)
        intent = { signature, intentId: crypto.randomUUID() }
      saving = true
      for (const control of modal.querySelectorAll(
        'button,input,select,textarea'
      ))
        control.disabled = true
      await repository.resolveLegacyCarton({
        ...args,
        intentId: intent.intentId,
      })
      globalThis.localStorage?.removeItem(recoveryKey)
      await onSaved()
      if (ownerRef && resolution.value === 'owner-corrected') {
        modal.close('saved')
        onReconcile(ownerRef)
      } else {
        modal.replaceChildren(
          el('h2', m('Legacy evidence review saved')),
          el(
            'p',
            m(
              'Record any newly repacked cartons through the normal order reconciliation. The original evidence remains in history.'
            )
          )
        )
        for (const context of contexts) {
          const open = el(
            'button',
            `${m('Reconcile cartons')} · ${context.orderId}`
          )
          open.onclick = () => {
            modal.close('saved')
            onReconcile({
              accountId: context.accountId || 'local',
              orderId: context.orderId,
            })
          }
          modal.append(open)
        }
        const done = el('button', m('Close'))
        done.onclick = () => modal.close('saved')
        modal.append(done)
      }
    })()
      .catch((error) => bindText(status, m(error.message)))
      .finally(() => {
        saving = false
        for (const control of modal.querySelectorAll(
          'button,input,select,textarea'
        ))
          control.disabled = false
        save.disabled = Boolean(amendmentRequired)
      })
  close.onclick = () => modal.close()
  status.setAttribute('role', 'status')
  modal.append(status, close, save)
  modal.oncancel = (event) => {
    if (saving) event.preventDefault()
  }
  modal.onclose = () => modal.remove()
  document.body.append(modal)
  modal.showModal()
  return modal
}

/** The captured logical keys, never mounted row positions, own a paste. */
export function captureGridTarget({
  orderRef,
  generation,
  viewVersion,
  visibleKeys,
  selectedKeys,
  columns,
  anchorKey,
  anchorColumn,
  keyed = false,
}) {
  const visible = [...visibleKeys]
  const selected = new Set(selectedKeys)
  return clone({
    orderRef,
    generation,
    viewVersion,
    visibleKeys: visible,
    selectedKeys: visible.filter((key) => selected.has(key)),
    columns: columns.map(({ key, readonly, type }) => ({
      key,
      readonly,
      type,
    })),
    anchorKey,
    anchorColumn,
    keyed,
  })
}

export function assertGridTarget(target, current) {
  for (const key of ['orderRef', 'generation', 'viewVersion', 'visibleKeys'])
    if (JSON.stringify(target[key]) !== JSON.stringify(current[key]))
      throw new Error('The paste target changed. Preview the alignment again.')
}

function numericCell(raw, column) {
  const value = raw.trim()
  if (!value) return null
  if (column.type === 'whole') {
    if (!/^\d+$/.test(value) || BigInt(value) === 0n)
      throw new Error('Pcs/box must be a positive whole number')
    return BigInt(value).toString()
  }
  if (column.type === 'dimensions') {
    const parts = value.split(/\s*[×xX*]\s*/)
    if (
      parts.length !== 3 ||
      parts.some(
        (part) => !/^\d+(?:[.,]\d+)?$/.test(part) || !/[1-9]/.test(part)
      )
    )
      throw new Error(
        'Enter three positive dimensions in cm, such as 60×50×40.'
      )
    return Object.fromEntries(
      ['len', 'wid', 'ht'].map((key, index) => [
        key,
        parts[index].replace(',', '.'),
      ])
    )
  }
  if (!/^\d+(?:[.,]\d+)?$/.test(value))
    throw new Error(
      'Enter a nonnegative decimal or leave the measurement unknown.'
    )
  return value.replace(',', '.')
}

/** Local bounded TSV parsing. Quoted cells retain tabs/newlines and source text. */
export async function parseGridCells(
  text,
  {
    signal,
    yieldWork = () => new Promise((resolve) => setTimeout(resolve, 0)),
  } = {}
) {
  if (typeof text !== 'string' || text.length > 4 * 1024 * 1024)
    throw new Error('Paste at most 4 MB of tabular cells.')
  const rows = []
  let row = [],
    cell = '',
    quoted = false
  for (let index = 0; index < text.length; index++) {
    if (index % 32768 === 0) {
      signal?.throwIfAborted()
      await yieldWork()
    }
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"'
        index++
      } else if (quoted || !cell) quoted = !quoted
      else cell += char
    } else if (!quoted && (char === '\t' || char === '\n' || char === '\r')) {
      row.push(cell)
      cell = ''
      if (char !== '\t') {
        rows.push(row)
        row = []
        if (char === '\r' && text[index + 1] === '\n') index++
      }
    } else cell += char
  }
  signal?.throwIfAborted()
  if (quoted) throw new Error('Close the quoted cell before pasting.')
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  if (!rows.length || rows.length > 20000)
    throw new Error('Paste between 1 and 20,000 rows.')
  const width = rows[0].length
  if (rows.some((row) => row.length !== width))
    throw new Error(
      'Paste a complete rectangle with the same number of columns in every row.'
    )
  return rows
}

/** Validate all cells before applying anything. Errors retain the entire raw plan. */
export async function planGridPaste(
  text,
  target,
  { rows, signal, yieldWork } = {}
) {
  const cells = await parseGridCells(text, { signal, yieldWork })
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const codeKeys = new Map()
  for (const row of rows) {
    const code = row.code || row.label
    if (!code) continue
    const keys = codeKeys.get(code) || []
    keys.push(row.key)
    codeKeys.set(code, keys)
  }
  const width = cells[0].length
  const keyed = target.keyed && width > 1
  const startColumn = target.columns.findIndex(
    ({ key }) => key === target.anchorColumn
  )
  const editable = target.columns.slice(startColumn)
  const start = target.visibleKeys.indexOf(target.anchorKey)
  const positionalKeys =
    width === 1
      ? target.selectedKeys
      : target.visibleKeys.slice(start, start + cells.length)
  const errors = [],
    changes = [],
    seen = new Set()
  if (startColumn < 0 || target.columns[startColumn].readonly)
    errors.push({ message: 'Choose an editable target column.' })
  if (
    !keyed &&
    (positionalKeys.length !== cells.length || (width !== 1 && start < 0))
  )
    errors.push({ message: 'Select the visible rows for every pasted value.' })
  for (const [index, source] of cells.entries()) {
    signal?.throwIfAborted()
    let key = positionalKeys[index],
      values = source
    if (keyed) {
      const matches = codeKeys.get(source[0]) || []
      if (matches.length !== 1)
        errors.push({
          row: index,
          raw: source[0],
          message: matches.length
            ? 'This code matches more than one source row. Choose a source key.'
            : 'This code is not in the selected order.',
        })
      key = matches.length === 1 ? matches[0] : null
      values = source.slice(1)
    }
    if (key && seen.has(key))
      errors.push({
        row: index,
        key,
        message: 'The same source row occurs twice in this paste.',
      })
    if (key) seen.add(key)
    for (const [offset, raw] of values.entries()) {
      const column = editable[offset]
      const change = {
        key,
        column: column?.key,
        raw,
        before: byKey.get(key)?.[column?.key] ?? null,
        sourceRow: index,
      }
      try {
        if (!key || !byKey.has(key))
          throw new Error('The target source row is unavailable.')
        if (!column || column.readonly)
          throw new Error('Derived values are read-only.')
        change.value = numericCell(raw, column)
      } catch (error) {
        errors.push({ ...change, message: error.message })
      }
      changes.push(change)
    }
  }
  return {
    target: clone(target),
    text,
    cells,
    changes,
    errors,
    valid: errors.length === 0,
  }
}

/** Dimensions are one column. A fill never copies kg as a side effect. */
export function planGridFill(rows, target, column, raw) {
  const descriptor = target.columns.find((entry) => entry.key === column)
  if (!descriptor || descriptor.readonly)
    throw new Error('Derived values are read-only.')
  const value = numericCell(raw, descriptor)
  const keys = new Set(target.selectedKeys)
  return {
    target: clone(target),
    valid: true,
    errors: [],
    changes: rows
      .filter((row) => keys.has(row.key))
      .map((row) => ({
        key: row.key,
        column,
        raw,
        before: row[column] ?? null,
        value,
      })),
  }
}

export function nextGridCell(
  keys,
  columns,
  key,
  column,
  { key: pressed, shiftKey } = {}
) {
  const editable = columns
    .filter((entry) => !entry.readonly)
    .map((entry) => entry.key)
  let row = keys.indexOf(key),
    col = editable.indexOf(column)
  if (row < 0 || col < 0) return null
  const direction = shiftKey ? -1 : 1
  if (pressed === 'Enter') row += direction
  else {
    col += direction
    if (col < 0) {
      col = editable.length - 1
      row--
    }
    if (col >= editable.length) {
      col = 0
      row++
    }
  }
  return row < 0 || row >= keys.length
    ? null
    : { key: keys[row], column: editable[col] }
}

/** Own raw/invalid input and asynchronous generations separately from physical facts. */
export function createGridDraftController({
  draft = {},
  persist,
  onChange = () => {},
}) {
  let state = {
    generation: 0,
    viewVersion: 0,
    rawCells: {},
    history: [],
    cursor: 0,
    ...clone(draft),
  }
  let parser,
    saveWork,
    savedGeneration = -1,
    disposed = false
  const status = { pending: false, error: null }
  const emit = () => onChange(clone(state), { ...status })
  function edit(operation, { history = true, alignment, baseline = {} } = {}) {
    parser?.abort()
    const before = { ...clone(baseline), ...clone(state.rawCells) }
    const beforeAlignment = clone(state.alignment || null)
    state.rawCells = { ...state.rawCells, ...clone(operation) }
    if (alignment !== undefined) state.alignment = alignment
    state.generation++
    if (history) {
      state.history.splice(state.cursor)
      state.history.push({
        before,
        after: clone(state.rawCells),
        beforeAlignment,
        afterAlignment: clone(state.alignment || null),
      })
      if (state.history.length > 50) state.history.shift()
      state.cursor = state.history.length
    }
    status.error = null
    emit()
  }
  async function flush() {
    if (saveWork) {
      await saveWork
      return flush()
    }
    if (savedGeneration === state.generation || disposed) return
    const submitted = clone(state)
    status.pending = true
    emit()
    saveWork = (async () => {
      const result = await persist(submitted)
      // An old acknowledgement only advances the persistence clock. It never
      // replaces raw cells, history, focus, or a newer operator generation.
      savedGeneration = submitted.generation
      return result
    })()
    try {
      await saveWork
      status.error = null
    } catch (error) {
      status.error = error
      throw error
    } finally {
      saveWork = null
      status.pending = false
      emit()
    }
    if (savedGeneration !== state.generation) return flush()
  }
  return {
    state: () => clone(state),
    status: () => ({ ...status }),
    dirty: () => savedGeneration !== state.generation,
    edit,
    flush,
    changeView() {
      parser?.abort()
      state.viewVersion++
      emit()
    },
    focusCell(key, column) {
      state.focus = { key, column }
      state.generation++
      emit()
    },
    async parse(text, target, options) {
      parser?.abort()
      parser = new AbortController()
      const generation = state.generation,
        version = state.viewVersion,
        controller = parser
      const plan = await planGridPaste(text, target, {
        ...options,
        signal: controller.signal,
      })
      controller.signal.throwIfAborted()
      if (
        disposed ||
        generation !== state.generation ||
        version !== state.viewVersion
      )
        throw new Error(
          'The paste target changed. Preview the alignment again.'
        )
      return plan
    },
    apply(plan, currentTarget) {
      assertGridTarget(plan.target, currentTarget)
      // Invalid plans are recovery data too; none of their cells become facts.
      edit(
        Object.fromEntries(
          plan.changes
            .filter(({ key, column }) => key && column)
            .map(({ key, column, raw }) => [JSON.stringify([key, column]), raw])
        ),
        {
          baseline: Object.fromEntries(
            plan.changes
              .filter(({ key, column }) => key && column)
              .map(({ key, column, before }) => [
                JSON.stringify([key, column]),
                String(before ?? ''),
              ])
          ),
          alignment: {
            target: clone(plan.target),
            text: plan.text ?? null,
            cells: clone(plan.cells || []),
            errors: clone(plan.errors || []),
          },
        }
      )
      return plan.valid
    },
    cancelParse() {
      parser?.abort()
    },
    restore(value) {
      parser?.abort()
      state = { ...clone(value), generation: state.generation + 1 }
      savedGeneration = -1
      emit()
    },
    acknowledgeCells(cells) {
      const next = { ...state.rawCells }
      for (const [key, value] of Object.entries(cells))
        if (next[key] === value) delete next[key]
      state.rawCells = next
      state.generation++
      const acknowledgedGeneration = state.generation
      emit()
      return acknowledgedGeneration
    },
    clearAcknowledged(generation) {
      if (state.generation !== generation) return false
      parser?.abort()
      state = {
        ...state,
        rawCells: {},
        alignment: null,
        history: [],
        cursor: 0,
        generation: state.generation + 1,
      }
      savedGeneration = -1
      emit()
      return true
    },
    undo() {
      if (!state.cursor) return false
      parser?.abort()
      const entry = state.history[--state.cursor]
      state.rawCells = clone(entry.before)
      state.alignment = clone(entry.beforeAlignment || null)
      state.generation++
      emit()
      return true
    },
    redo() {
      if (state.cursor >= state.history.length) return false
      parser?.abort()
      const entry = state.history[state.cursor++]
      state.rawCells = clone(entry.after)
      state.alignment = clone(entry.afterAlignment || null)
      state.generation++
      emit()
      return true
    },
    dispose() {
      disposed = true
      parser?.abort()
    },
  }
}

/** One order owns a planner draft, recovery cells and compound history. */
export async function createOrderCartonSession({
  repository,
  orderRef,
  planner,
  onError = () => {},
  getContextContainerId = () => undefined,
  onPrintMark,
  applyUnitException = async (input) =>
    (await import('./carton-batches.js')).applyCartonUnitException(input),
}) {
  const repositoryRef = () => ({
    ...orderRef,
    ...(getContextContainerId()
      ? { contextContainerId: getContextContainerId() }
      : {}),
  })
  let context = await repository.getOrderReconciliation(repositoryRef())
  let latestContext = context,
    refreshGeneration = 0
  const amendmentContext = clone(
    context.amendmentContext || context.revisions?.amendmentContext
  )
  const mutationContext = () => ({
    ...(getContextContainerId()
      ? { contextContainerId: getContextContainerId() }
      : {}),
    ...(amendmentContext ? { expectedAmendment: amendmentContext } : {}),
  })
  let restored = context.draft?.value || context.draft || {}
  let expectedDraftRevision = context.draft?.revision ?? 0
  let localRecoveryKey
  try {
    let tab = globalThis.sessionStorage?.getItem('1688-orders-draft-tab')
    if (!tab) {
      tab = crypto.randomUUID()
      globalThis.sessionStorage?.setItem('1688-orders-draft-tab', tab)
    }
    localRecoveryKey = `1688-orders-carton-recovery:${JSON.stringify([
      orderRef.accountId || 'local',
      orderRef.orderId,
      getContextContainerId() || null,
      tab,
    ])}`
    const local = JSON.parse(
      globalThis.localStorage?.getItem(localRecoveryKey) || 'null'
    )
    if (local?.value) {
      if (
        local.revision === expectedDraftRevision &&
        JSON.stringify(local.sourceRevisions) ===
          JSON.stringify(context.revisions) &&
        JSON.stringify(local.amendmentContext || null) ===
          JSON.stringify(amendmentContext || null)
      )
        restored = local.value
      else context.recoveredDrafts = [...(context.recoveredDrafts || []), local]
    }
  } catch {}
  let clientRecovered = clone(restored.recoveredDrafts || [])
  const hasRecoveredEdits =
    Object.keys(restored.rawCells || {}).length ||
    Object.keys(restored.plannerDraft?.capacities || {}).length ||
    restored.plannerDraft?.cartons?.length ||
    restored.alignment?.text ||
    restored.history?.commandKinds?.length
  if (
    hasRecoveredEdits &&
    JSON.stringify(restored.basisRevisions || null) !==
      JSON.stringify(context.revisions || null)
  ) {
    const { recoveredDrafts: _older, ...value } = restored
    clientRecovered.push({
      id: context.draft?.id || localRecoveryKey || crypto.randomUUID(),
      revision: expectedDraftRevision,
      updatedAt: context.draft?.updatedAt || new Date().toISOString(),
      amendmentContext: value.amendmentContext,
      value,
    })
    restored = {}
  }
  context.recoveredDrafts = [
    ...new Map(
      [...(context.recoveredDrafts || []), ...clientRecovered].map((entry) => [
        JSON.stringify(entry),
        entry,
      ])
    ).values(),
  ]
  let domainDraft =
    restored.plannerDraft || planner.createReconciliationDraft(context)
  let history =
    restored.history?.domain || planner.createReconciliationHistory(domainDraft)
  const subscribers = new Set()
  const notify = (reason = 'change') => {
    for (const subscriber of subscribers) subscriber(reason)
  }
  let timer,
    writeWork,
    cellWork,
    confirmWork,
    confirmIntent,
    arrangementDirty = false,
    lastInputGeneration = 0
  const commandKinds = [...(restored.history?.commandKinds || [])]
  let commandCursor = restored.history?.commandCursor ?? commandKinds.length
  function retainLocal(value) {
    if (!localRecoveryKey) return
    try {
      if (!raw.dirty()) {
        globalThis.localStorage?.removeItem(localRecoveryKey)
        return
      }
      globalThis.localStorage?.setItem(
        localRecoveryKey,
        JSON.stringify({
          revision: expectedDraftRevision,
          amendmentContext,
          sourceRevisions: context.revisions,
          updatedAt: new Date().toISOString(),
          value: {
            ...value,
            basisRevisions: context.revisions,
            recoveredDrafts: clientRecovered,
            plannerDraft: domainDraft,
            history: {
              domain: history,
              raw: { history: value.history, cursor: value.cursor },
              commandKinds,
              commandCursor,
            },
            amendmentContext,
          },
        })
      )
    } catch {
      onError(new Error('The editing draft could not be saved for recovery.'))
    }
  }
  const raw = createGridDraftController({
    draft: {
      ...restored,
      focus: restored.alignment?.activeCell,
      history: restored.history?.raw?.history || [],
      cursor: restored.history?.raw?.cursor || 0,
    },
    async persist(value) {
      const saved = await repository.saveOrderCartonDraft({
        ...orderRef,
        ...mutationContext(),
        expectedRevision: expectedDraftRevision,
        draft: clone({
          version: 1,
          basisRevisions: context.revisions,
          recoveredDrafts: clientRecovered,
          ...(amendmentContext ? { amendmentContext } : {}),
          plannerDraft: domainDraft,
          rawCells: value.rawCells,
          generation: value.generation,
          alignment: {
            ...(value.alignment || {}),
            ...(value.focus ? { activeCell: value.focus } : {}),
          },
          history: {
            domain: history,
            raw: { history: value.history, cursor: value.cursor },
            commandKinds,
            commandCursor,
          },
        }),
      })
      expectedDraftRevision =
        saved.revision ?? saved.draft?.revision ?? expectedDraftRevision
    },
    onChange: (value) => {
      retainLocal(value)
      notify('input')
    },
  })
  function contextInput() {
    const capacities = { ...domainDraft.capacities }
    for (const [encoded, value] of Object.entries(raw.state().rawCells)) {
      const [key, column] = JSON.parse(encoded)
      if (column === 'capacity') {
        const [accountId, orderId, entryId] = JSON.parse(key)
        if (accountId === orderRef.accountId && orderId === orderRef.orderId)
          capacities[entryId] = value
      }
    }
    return {
      ...context,
      batches:
        latestContext.batches?.map((batch) => {
          const touched =
            domainDraft.cartons.some((entry) => entry.id === batch.id) ||
            Object.keys(raw.state().rawCells).some(
              (key) => JSON.parse(key)[0] === batch.id
            )
          return touched
            ? context.batches.find((entry) => entry.id === batch.id) || batch
            : batch
        }) || context.batches,
      capacities: latestContext.record?.unitsPerCarton,
      draft: { ...domainDraft, capacities },
    }
  }
  function projection() {
    const plan = planner.reconcileOrder(contextInput())
    const products = plan.products.map((product) => {
      const item = context.record.snapshot.items.find(
        (item) => item.entryId === product.entryId
      )
      const row = {
        ...orderRef,
        entryId: product.entryId,
        key: sourceKey({ ...orderRef, entryId: product.entryId }),
        code:
          product.code || product.barcode || item?.productNo || product.entryId,
        purchased: product.purchased,
        available: product.availableForPacking,
        capacity: product.rawCapacity ?? product.capacity,
        proposedCount: product.fullCartons,
        unassigned: product.unassignedPieces,
        pattern: formatOrderPackingPattern(product, plan.cartons),
        patternLabel: () => formatOrderPackingPattern(product, plan.cartons),
        source: item,
        states: product.states,
        issues: product.issues,
      }
      const group = context.preparation?.groups.find((group) =>
        group.variants.some((variant) =>
          variant.entryIds.includes(product.entryId)
        )
      )
      const variant = group?.variants.find((variant) =>
        variant.entryIds.includes(product.entryId)
      )
      if (group?.baseCode)
        row.code =
          group.baseCode +
          (variant?.variantSuffix || '') +
          (variant?.sizeSuffix || '')
      if (product.remainder != null && BigInt(product.remainder) > 0n)
        row.remainderCommand = { type: 'separate', entryId: product.entryId }
      return row
    })
    const cartons = [
      ...new Map(
        [...(plan.cartons || []), ...(plan.proposals || [])].map((carton) => [
          carton.id,
          carton,
        ])
      ).values(),
    ].map((carton) => ({
      ...carton,
      ...physicalMarkReadback(
        carton,
        context.preparation ? [context.preparation] : []
      ),
      key: carton.id,
      label: carton.cartonNumber || carton.supplierLabel || carton.id,
      contents:
        carton.contents
          ?.map((entry) => `${entry.entryId}: ${entry.quantity}`)
          .join(' · ') || String(m('Unknown contents')),
      contentEntries: clone(carton.contents || []),
      dimensions:
        carton.len && carton.wid && carton.ht
          ? `${carton.len}×${carton.wid}×${carton.ht}`
          : '',
      weight: carton.weight ?? '',
      suppliedCbm: carton.suppliedCbm ?? '',
      provenance:
        carton.provenance?.source ||
        carton.packingBasis ||
        carton.draftKind ||
        '',
    }))
    return { ...plan, products, cartons, summary: plan.summary || plan }
  }
  function remember(kind) {
    commandKinds.splice(commandCursor)
    commandKinds.push(kind)
    commandCursor = commandKinds.length
  }
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => void flush().catch(onError), 450)
  }
  function rawCell(key, column) {
    const value = raw.state().rawCells[JSON.stringify([key, column])]
    if (value !== undefined) return value
    const plan = projection(),
      row = [...plan.products, ...plan.cartons].find((row) => row.key === key)
    return row?.[column] ?? ''
  }
  async function applyDomain(command, { record = true } = {}) {
    if (record) {
      history = planner.commitReconciliationHistory(
        history,
        command,
        contextInput()
      )
      domainDraft = history.present
    } else
      domainDraft = planner.applyReconciliationCommand(
        domainDraft,
        command,
        contextInput()
      )
  }
  async function stageCells(
    changes,
    { rawAlreadyStaged = false, mergePrevious = false } = {}
  ) {
    const beforeHistory = clone(history)
    if (!rawAlreadyStaged) {
      raw.edit(
        Object.fromEntries(
          changes.map((change) => [
            JSON.stringify([change.key, change.column]),
            change.raw,
          ])
        )
      )
    }
    const capacity = {},
      measurements = new Map()
    for (const change of changes) {
      if (change.column === 'capacity') {
        const ref = JSON.parse(change.key)
        if (ref[0] !== orderRef.accountId || ref[1] !== orderRef.orderId)
          throw new Error('The target source row is unavailable.')
        capacity[ref[2]] = change.raw
      } else {
        const carton = measurements.get(change.key) || { id: change.key }
        if (change.column === 'dimensions')
          Object.assign(carton, change.value || { len: '', wid: '', ht: '' })
        else carton[change.column] = change.value
        measurements.set(change.key, carton)
      }
    }
    if (measurements.size) {
      // Facts are staged and confirmed once with the order. The domain owns
      // override/revision checks; rendering never edits a physical record.
      const next = clone(domainDraft)
      for (const [id, values] of measurements) {
        const existing =
          domainDraft.cartons.find((entry) => entry.id === id) ||
          context.batches.find((entry) => entry.id === id) ||
          planner
            .reconcileOrder(contextInput())
            .cartons.find((entry) => entry.id === id) ||
          planner
            .reconcileOrder(contextInput())
            .proposals.find((entry) => entry.id === id)
        if (!existing) throw new Error('The target carton is unavailable.')
        const original = context.batches.some((entry) => entry.id === id)
        const override = {
          ...clone(existing),
          ...values,
          ...(original
            ? {
                baseRevision: existing.revision,
                draftKind: 'override',
                requiresDomainReview: true,
              }
            : { draftKind: 'manual' }),
        }
        const index = next.cartons.findIndex((entry) => entry.id === id)
        if (index < 0) next.cartons.push(override)
        else next.cartons[index] = override
      }
      // The history helper's replace-draft command is intentionally not invented.
      // A compound UI snapshot stores measured overrides alongside planner history.
      history = {
        past: [...history.past, clone(history.present)],
        present: next,
        future: [],
      }
      domainDraft = next
      arrangementDirty = true
    }
    if (Object.keys(capacity).length)
      await applyDomain({ type: 'set-capacities', values: capacity })
    // Rectangular capacities and measurements share one history boundary.
    history = {
      past: mergePrevious
        ? beforeHistory.past
        : [...beforeHistory.past, clone(beforeHistory.present)],
      present: clone(domainDraft),
      future: [],
    }
    if (!mergePrevious) remember(measurements.size ? 'arrangement' : 'capacity')
    // Raw input may have been acknowledged before its parsed physical override
    // was staged. Persist the complete planner/history envelope too.
    raw.edit({}, { history: false })
    await raw.flush()
  }
  function currentCapacityValues() {
    const values = {}
    for (const [encoded, value] of Object.entries(raw.state().rawCells)) {
      const [key, column] = JSON.parse(encoded)
      if (column !== 'capacity') continue
      const [accountId, orderId, entryId] = JSON.parse(key)
      if (accountId !== orderRef.accountId || orderId !== orderRef.orderId)
        throw new Error('The target source row is unavailable.')
      numericCell(value, { type: 'whole' })
      values[entryId] = value.trim() || null
    }
    return values
  }
  async function flush() {
    clearTimeout(timer)
    if (cellWork) await cellWork
    await raw.flush() // Recovery is written even when validation fails below.
    if (writeWork) {
      await writeWork
      return flush()
    }
    const state = raw.state()
    if (state.alignment?.errors?.length)
      throw new Error(
        'Resolve the invalid paste cells before saving facts. The complete draft is retained.'
      )
    for (const [encoded, value] of Object.entries(state.rawCells)) {
      const [, column] = JSON.parse(encoded)
      const descriptor = [...PRODUCT_GRID_COLUMNS, ...CARTON_GRID_COLUMNS].find(
        (entry) => entry.key === column
      )
      if (descriptor && !descriptor.readonly)
        numericCell(String(value), descriptor)
    }
    if (state.generation === lastInputGeneration) return
    const values = currentCapacityValues()
    if (!Object.keys(values).length) {
      lastInputGeneration = state.generation
      return
    }
    const submittedGeneration = state.generation,
      expectedValues = Object.fromEntries(
        Object.keys(values).map((id) => [
          id,
          context.record.unitsPerCarton?.[id] ?? null,
        ])
      )
    const operation = (async () => {
      const result = await repository.updateOrderCapacities({
        ...orderRef,
        ...mutationContext(),
        values,
        expectedValues,
        expectedObservedAt: context.record.snapshot.observedAt,
      })
      // Accept the new baseline without replacing raw typing or planner commands.
      context = {
        ...context,
        record: result.record || (result.snapshot ? result : context.record),
        revisions: result.revisions || context.revisions,
      }
      latestContext = context
      const acknowledged = {}
      for (const [entryId, value] of Object.entries(values)) {
        const key = JSON.stringify([
          sourceKey({ ...orderRef, entryId }),
          'capacity',
        ])
        acknowledged[key] = String(value ?? '')
        if (
          String(domainDraft.capacities[entryId] ?? '') === String(value ?? '')
        )
          delete domainDraft.capacities[entryId]
      }
      history.present = clone(domainDraft)
      const changedWhileSaving = raw.state().generation !== submittedGeneration
      const acknowledgedGeneration = raw.acknowledgeCells(acknowledged)
      await raw.flush()
      lastInputGeneration = changedWhileSaving
        ? submittedGeneration
        : acknowledgedGeneration
    })()
    // Include acknowledgement/recovery persistence in the barrier. Waiting on
    // only the already-resolved mutation can spin microtasks while IDB awaits
    // its next event, starving a following capacity edit.
    writeWork = operation
    try {
      await operation
    } finally {
      if (writeWork === operation) writeWork = null
    }
    if (raw.state().generation !== submittedGeneration) return flush()
    notify()
  }
  const session = {
    orderRef,
    orderGroups: () => clone(context.preparation?.groups || []),
    identityDraft(batchId) {
      const value = raw.state().rawCells[JSON.stringify([batchId, 'identity'])]
      return value ? JSON.parse(value) : null
    },
    retainIdentityDraft(batchId, value) {
      raw.edit(
        {
          [JSON.stringify([batchId, 'identity'])]: JSON.stringify({
            ...value,
            reviewed: false,
          }),
        },
        { history: false }
      )
      void raw.flush().catch(onError)
    },
    async stageCartonIdentity({ batchId, cartonNumber, markGroupId }) {
      const batch =
        domainDraft.cartons.find((batch) => batch.id === batchId) ||
        context.batches.find((batch) => batch.id === batchId) ||
        [
          ...planner.reconcileOrder(contextInput()).cartons,
          ...planner.reconcileOrder(contextInput()).proposals,
        ].find((batch) => batch.id === batchId)
      if (!batch) throw new Error('The target carton is unavailable.')
      if (typeof cartonNumber !== 'string' || cartonNumber.length > 128)
        throw new Error('Enter a short carton reference, up to 128 characters.')
      const mark =
        markGroupId &&
        context.preparation?.groups.find((group) => group.id === markGroupId)
      if (markGroupId && !mark)
        throw new Error('The carton mark must belong to this order.')
      const next = clone(domainDraft),
        existing = context.batches.find((entry) => entry.id === batchId),
        after = {
          ...clone(batch),
          cartonNumber,
          ...(mark
            ? { mark: { orderId: orderRef.orderId, groupId: mark.id } }
            : {}),
          ...(existing
            ? {
                baseRevision: existing.revision,
                draftKind: 'override',
                requiresDomainReview: true,
              }
            : { draftKind: 'manual' }),
        },
        index = next.cartons.findIndex((entry) => entry.id === batchId)
      if (index < 0) next.cartons.push(after)
      else next.cartons[index] = after
      history = {
        past: [...history.past, clone(history.present)],
        present: next,
        future: [],
      }
      domainDraft = next
      raw.edit({
        [JSON.stringify([batchId, 'identity'])]: JSON.stringify({
          cartonNumber,
          markGroupId,
          reviewed: true,
        }),
      })
      remember('arrangement')
      arrangementDirty = true
      await raw.flush()
      notify()
    },
    async refresh() {
      const generation = ++refreshGeneration,
        latest = await repository.getOrderReconciliation(repositoryRef())
      if (generation !== refreshGeneration) return
      const token =
        latest.amendmentContext || latest.revisions?.amendmentContext
      if (
        JSON.stringify(token || null) !==
        JSON.stringify(amendmentContext || null)
      )
        return
      if (
        !Object.keys(raw.state().rawCells).length &&
        !arrangementDirty &&
        !commandCursor
      )
        context = {
          ...latest,
          recoveredDrafts: [
            ...new Map(
              [
                ...(latest.recoveredDrafts || []),
                ...(context.recoveredDrafts || []),
                ...clientRecovered,
              ].map((envelope) => [JSON.stringify(envelope), envelope])
            ).values(),
          ],
        }
      latestContext = latest
      notify('refresh')
    },
    record: () => clone(context.record),
    recoveredDrafts: () =>
      clone(context.recoveredDrafts || []).sort(
        (a, b) =>
          String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) ||
          (b.revision || 0) - (a.revision || 0)
      ),
    async discardRecovery(envelope) {
      clientRecovered = clientRecovered.filter(
        (entry) => JSON.stringify(entry) !== JSON.stringify(envelope)
      )
      context.recoveredDrafts = context.recoveredDrafts.filter(
        (entry) => JSON.stringify(entry) !== JSON.stringify(envelope)
      )
      raw.edit({}, { history: false })
      await raw.flush()
      notify()
    },
    async recoverReviewed(envelope) {
      if (
        !(context.recoveredDrafts || []).some(
          (entry) => JSON.stringify(entry) === JSON.stringify(envelope)
        )
      )
        throw new Error('The recovered draft is no longer available.')
      const value = clone(envelope.value || envelope)
      domainDraft =
        value.plannerDraft || planner.createReconciliationDraft(context)
      if (amendmentContext)
        domainDraft.amendmentContext = clone(amendmentContext)
      history =
        value.history?.domain ||
        planner.createReconciliationHistory(domainDraft)
      commandKinds.splice(
        0,
        commandKinds.length,
        ...(value.history?.commandKinds || [])
      )
      commandCursor = value.history?.commandCursor ?? commandKinds.length
      raw.restore({
        ...value,
        rawCells: value.rawCells || {},
        amendmentContext,
        history: value.history?.raw?.history || [],
        cursor: value.history?.raw?.cursor || 0,
      })
      arrangementDirty = true
      clientRecovered = clientRecovered.filter(
        (entry) => JSON.stringify(entry) !== JSON.stringify(envelope)
      )
      context.recoveredDrafts = context.recoveredDrafts.filter(
        (entry) => JSON.stringify(entry) !== JSON.stringify(envelope)
      )
      await raw.flush()
      notify()
    },
    unitEntitlements(batchId) {
      const batch =
        domainDraft.cartons.find((batch) => batch.id === batchId) ||
        context.batches.find((batch) => batch.id === batchId)
      if (!batch) throw new Error('The target carton is unavailable.')
      return physicalUnits(batch)
    },
    unitDraft(batchId, index) {
      const value =
        raw.state().rawCells[JSON.stringify([batchId, `unit:${index}`])]
      return value ? JSON.parse(value) : null
    },
    retainUnitDraft(batchId, index, value) {
      raw.edit(
        {
          [JSON.stringify([batchId, `unit:${index}`])]: JSON.stringify({
            ...value,
            reviewed: false,
          }),
        },
        { history: false }
      )
      void raw.flush().catch(onError)
    },
    async stageUnitFacts({ batchId, index, contents, measurements }) {
      const submittedGeneration = raw.state().generation
      if (contents?.some((part) => !/^[1-9]\d*$/.test(part.quantity)))
        throw new Error('Carton contents require positive whole quantities.')
      const batch =
        domainDraft.cartons.find((batch) => batch.id === batchId) ||
        context.batches.find((batch) => batch.id === batchId)
      if (!batch) throw new Error('The target carton is unavailable.')
      const after = await applyUnitException({
        batch: clone(batch),
        index,
        contents,
        measurements,
        expectedRevision: batch.baseRevision ?? batch.revision,
      })
      if (raw.state().generation !== submittedGeneration)
        throw new Error(
          'The carton draft changed. Review the current exception again.'
        )
      const next = clone(domainDraft),
        position = next.cartons.findIndex((batch) => batch.id === batchId)
      if (position < 0) next.cartons.push(after)
      else next.cartons[position] = after
      history = {
        past: [...history.past, clone(history.present)],
        present: next,
        future: [],
      }
      domainDraft = next
      raw.edit({
        [JSON.stringify([batchId, `unit:${index}`])]: JSON.stringify({
          contents,
          measurements,
          reviewed: true,
        }),
      })
      remember('arrangement')
      arrangementDirty = true
      await raw.flush()
      notify()
    },
    projection,
    async reviewPhysicalMark(batchId, options = {}) {
      await flush()
      return openPhysicalMarkReview({
        repository,
        orderRef,
        batchId,
        contextContainerId: getContextContainerId(),
        onPrintMark,
        ...options,
        onSaved: () => session.refresh(),
      })
    },
    rawCell,
    state() {
      const state = raw.state()
      return {
        ...state,
        canUndo: commandCursor > 0 || state.cursor > 0,
        canRedo:
          commandCursor < commandKinds.length ||
          state.cursor < state.history.length,
      }
    },
    dirtyKeys: () => [
      ...new Set(
        Object.keys(raw.state().rawCells).map((key) => JSON.parse(key)[0])
      ),
    ],
    editCell(key, column, value) {
      const before = rawCell(key, column)
      raw.edit(
        { [JSON.stringify([key, column])]: value },
        { baseline: { [JSON.stringify([key, column])]: String(before ?? '') } }
      )
      const values = {}
      if (column === 'capacity') {
        const [accountId, orderId, entryId] = JSON.parse(key)
        if (accountId !== orderRef.accountId || orderId !== orderRef.orderId)
          throw new Error('The target source row is unavailable.')
        values[entryId] = value
      }
      history = planner.commitReconciliationHistory(
        history,
        { type: 'set-capacities', values },
        contextInput()
      )
      domainDraft = history.present
      remember(column === 'capacity' ? 'capacity' : 'arrangement')
      void raw.flush().catch(onError)
      schedule()
    },
    retainPasteText(text) {
      raw.cancelParse()
      raw.edit(
        {},
        {
          history: false,
          alignment: { text, requirePreview: Boolean(text), errors: [] },
        }
      )
      void raw.flush().catch(onError)
    },
    clearPaste() {
      raw.cancelParse()
      raw.edit({}, { history: false, alignment: null })
      void raw.flush().catch(onError)
    },
    recoveryPending: () => raw.dirty() || raw.status().pending,
    setActiveCell(key, column) {
      const focus = raw.state().focus
      if (focus?.key === key && focus?.column === column) return
      raw.focusCell(key, column)
      void raw.flush().catch(onError)
    },
    commitCell(key, column, value) {
      if (column === 'capacity') return flush()
      const previous = cellWork,
        current = (async () => {
          if (previous) await previous.catch(() => {})
          const descriptor = CARTON_GRID_COLUMNS.find(
            (entry) => entry.key === column
          )
          await raw.flush()
          const currentRaw = raw.state().rawCells[JSON.stringify([key, column])]
          if (currentRaw !== undefined && currentRaw !== value) return
          const parsed = numericCell(value, descriptor)
          await stageCells([{ key, column, raw: value, value: parsed }], {
            rawAlreadyStaged: true,
            mergePrevious: true,
          })
          notify()
        })()
      cellWork = current
      return current.finally(() => {
        if (cellWork === current) cellWork = undefined
      })
    },
    async command(command) {
      await applyDomain(command)
      raw.edit({})
      remember('arrangement')
      arrangementDirty = true
      await raw.flush()
      notify()
    },
    previewPaste: (text, target, rows) => raw.parse(text, target, { rows }),
    async applyPaste(plan, currentTarget) {
      const valid = raw.apply(plan, currentTarget)
      if (valid) {
        await stageCells(plan.changes, { rawAlreadyStaged: true })
        await flush()
      } else {
        history = planner.commitReconciliationHistory(
          history,
          { type: 'set-capacities', values: {} },
          contextInput()
        )
        domainDraft = history.present
        remember('invalid')
      }
      await raw.flush()
      notify()
      return valid
    },
    cancelParse: () => raw.cancelParse(),
    changeView: () => raw.changeView(),
    flush,
    async undo() {
      raw.undo()
      if (commandCursor) {
        const kind = commandKinds[--commandCursor]
        history = planner.undoReconciliationHistory(history)
        domainDraft = history.present
        arrangementDirty = kind === 'arrangement'
      }
      await flush()
      notify()
    },
    async redo() {
      raw.redo()
      if (commandCursor < commandKinds.length) {
        const kind = commandKinds[commandCursor++]
        history = planner.redoReconciliationHistory(history)
        domainDraft = history.present
        arrangementDirty = kind === 'arrangement'
      }
      await flush()
      notify()
    },
    confirm() {
      if (confirmWork) return confirmWork
      confirmWork = (async () => {
        await raw.flush()
        if (raw.state().alignment?.requirePreview)
          throw new Error(
            'Preview the pasted cells before confirming physical facts.'
          )
        for (const [encoded, value] of Object.entries(raw.state().rawCells)) {
          const [key, column] = JSON.parse(encoded)
          if (column.startsWith('unit:') || column === 'identity') {
            if (!JSON.parse(value).reviewed)
              throw new Error(
                'Review the pending carton exception before confirming. The complete draft is retained.'
              )
            continue
          }
          if (column !== 'capacity')
            await session.commitCell(key, column, value)
        }
        await flush()
        const input = contextInput(),
          plan = planner.reconcileOrder(input),
          generation = raw.state().generation
        if (plan.issues?.some((issue) => issue.severity === 'error'))
          throw new Error(
            'Resolve the order reconciliation issues before confirming.'
          )
        const contextContainerId = getContextContainerId()
        if (contextContainerId)
          input.draft.contextContainerId = contextContainerId
        if (amendmentContext) input.draft.amendmentContext = amendmentContext
        const signature = JSON.stringify([input.draft, context.revisions])
        if (confirmIntent?.signature !== signature)
          confirmIntent = { signature, intentId: crypto.randomUUID() }
        await repository.confirmOrderCartons({
          ...orderRef,
          draft: input.draft,
          expectedRevisions: context.revisions,
          intentId: confirmIntent.intentId,
        })
        context = await repository.getOrderReconciliation(repositoryRef())
        latestContext = context
        expectedDraftRevision = context.draft?.revision ?? 0
        if (raw.state().generation === generation) {
          // clearAcknowledged emits synchronously. Its observers must see the
          // new physical baseline before they persist focus/recovery state.
          domainDraft = planner.createReconciliationDraft(context)
          history = planner.createReconciliationHistory(domainDraft)
          commandKinds.length = 0
          commandCursor = 0
          arrangementDirty = false
          raw.clearAcknowledged(generation)
          await raw.flush()
        }
        confirmIntent = undefined
        notify()
      })()
      notify()
      return confirmWork.finally(() => {
        confirmWork = undefined
        notify()
      })
    },
    busy: () => Boolean(confirmWork),
    subscribe(listener) {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    dispose() {
      clearTimeout(timer)
      raw.dispose()
      subscribers.clear()
    },
  }
  return session
}

/** A single keyed table mounts at most 100 ordinary rows plus focused editors. */
export function mountOrderCartonGrid(
  host,
  {
    session,
    kind = 'products',
    loadImage = async (source) => source,
    onInspect = () => {},
    onError = () => {},
  }
) {
  const columns =
    kind === 'cartons' ? CARTON_GRID_COLUMNS : PRODUCT_GRID_COLUMNS
  const toolbar = el('div', undefined, 'smart-grid-tools'),
    status = el('p'),
    summary = el('div', undefined, 'reconciliation-summary'),
    issuesHost = el('div', undefined, 'reconciliation-issues'),
    suggestionsHost = el('div', undefined, 'reconciliation-suggestions')
  issuesHost.setAttribute('role', 'status')
  const scroller = el('div', undefined, 'smart-grid-scroll'),
    table = el('table'),
    head = el('thead'),
    body = el('tbody'),
    heading = el('tr')
  table.setAttribute('role', 'grid')
  table.setAttribute('aria-multiselectable', 'true')
  bindAttribute(
    table,
    'aria-label',
    m(kind === 'cartons' ? 'Physical cartons' : 'Order reconciliation')
  )
  status.setAttribute('role', 'status')
  summary.setAttribute('aria-live', 'polite')
  heading.append(el('th', m('Select')))
  for (const column of columns) heading.append(el('th', m(column.label)))
  head.append(heading)
  table.append(head, body)
  scroller.append(table)
  const selected = new Set()
  let rows = [],
    mountedKeys = [],
    visibleKeys = [],
    filter = '',
    viewVersion = 0,
    active = session.state().focus || {},
    parseWork,
    currentPlan
  function action(title, name, run) {
    const button = el('button', m(title))
    button.type = 'button'
    button.dataset.action = name
    button.onclick = () => void Promise.resolve().then(run).catch(onError)
    toolbar.append(button)
    return button
  }
  const undo = action('Undo', 'undo-order-cartons', () => session.undo()),
    redo = action('Redo', 'redo-order-cartons', () => session.redo())
  const recovered = session.recoveredDrafts?.() || []
  if (recovered.length) {
    const choice = el('select')
    bindAttribute(choice, 'aria-label', m('Recovered carton draft'))
    recovered.forEach((entry, index) =>
      choice.append(
        new Option(
          `${entry.updatedAt || ''} · ${entry.amendmentContext?.epoch || entry.value?.amendmentContext?.epoch || index + 1}`,
          String(index)
        )
      )
    )
    choice.value = '0'
    toolbar.append(choice)
    const recover = action(
      'Review recovered carton draft',
      'review-recovered-carton-draft',
      async () => {
        const envelope = recovered[Number(choice.value)],
          value = envelope.value || envelope
        const accepted = await reviewPackingChanges({
          title: m('Review recovered carton draft'),
          explanation: m(
            'This draft uses an earlier order revision or amendment. Review every retained value against the current order before using it. Physical identities and revision checks still apply.'
          ),
          changes: [
            {
              name: m('Recovered carton draft'),
              before: JSON.stringify(session.projection()),
              after: JSON.stringify(value),
            },
          ],
          proceed: m('Use these reviewed edits'),
          alternate: { label: m('Keep saved version'), value: 'saved' },
        })
        if (!accepted) return
        if (accepted === 'saved') await session.discardRecovery(envelope)
        else await session.recoverReviewed(envelope)
        choice.hidden = recover.hidden = true
      }
    )
  }
  action('Select visible rows', 'select-grid-rows', () => {
    selected.clear()
    visibleKeys.forEach((key) => selected.add(key))
    paintSelection()
  })
  action('Fill selected rows', 'fill-grid-range', () => {
    if (!active.key || !active.column)
      throw new Error('Choose an editable target column.')
    const raw = session.rawCell(active.key, active.column)
    const plan = planGridFill(rows, target(), active.column, raw)
    return preview(plan)
  })
  const confirm = action('Confirm order cartons', 'confirm-order-cartons', () =>
    session.confirm()
  )
  const paste = el('textarea')
  paste.rows = 2
  paste.value = session.state().alignment?.text || ''
  paste.oninput = () => {
    session.cancelParse()
    currentPlan = null
    session.retainPasteText?.(paste.value)
  }
  bindAttribute(paste, 'aria-label', m('Paste carton or capacity cells'))
  const keyedLabel = el(
      'label',
      m(
        kind === 'cartons'
          ? 'First column contains carton references'
          : 'First column contains product codes'
      )
    ),
    keyed = el('input')
  keyed.type = 'checkbox'
  keyedLabel.prepend(keyed)
  keyed.checked = true
  action('Preview paste', 'preview-carton-paste', async () => {
    const captured = target()
    parseWork = session.previewPaste(paste.value, captured, rows)
    const plan = await parseWork
    return preview(plan)
  })
  action('Cancel paste', 'cancel-carton-paste', () => {
    session.cancelParse()
    session.clearPaste?.()
    paste.value = ''
    currentPlan = null
  })
  const search = el('input')
  search.type = 'search'
  bindAttribute(search, 'aria-label', m('Filter reconciliation rows'))
  search.oninput = () => {
    filter = search.value.toLowerCase()
    viewVersion++
    session.changeView()
    render()
  }
  toolbar.append(search, paste, keyedLabel)
  host.replaceChildren(
    summary,
    toolbar,
    issuesHost,
    suggestionsHost,
    status,
    scroller
  )
  // Raw/invalid drafts live in the keyed session; mounting every dirty row
  // would defeat virtualization after a large paste. The table pins focus.
  const grid = createVirtualTable({
    scroller,
    body,
    render: (entries) => entries.map(({ row }) => renderRow(row)),
    paint: paintSelection,
    limit: 100,
  })
  function target() {
    const state = session.state()
    return captureGridTarget({
      orderRef: session.orderRef,
      generation: state.generation,
      viewVersion,
      visibleKeys,
      selectedKeys: selected,
      columns,
      anchorKey: active.key || visibleKeys[0],
      anchorColumn:
        active.column || columns.find((column) => !column.readonly).key,
      keyed: keyed.checked,
    })
  }
  function paintSelection() {
    for (const tr of body.querySelectorAll('[data-grid-key]')) {
      const isSelected = selected.has(tr.dataset.gridKey)
      tr.setAttribute('aria-selected', String(isSelected))
      tr.querySelector('input[type="checkbox"]').checked = isSelected
    }
  }
  function renderRow(row) {
    const tr = el('tr')
    tr.dataset.gridKey = row.key
    tr.tabIndex = 0
    const selection = el('td'),
      check = el('input')
    check.type = 'checkbox'
    check.checked = selected.has(row.key)
    bindAttribute(
      check,
      'aria-label',
      m('Select row {0}', { 0: row.code || row.label || row.key })
    )
    check.onchange = () => {
      if (check.checked) selected.add(row.key)
      else selected.delete(row.key)
      paintSelection()
    }
    selection.append(check)
    tr.append(selection)
    for (const column of columns) {
      const td = el('td')
      td.dataset.column = column.key
      if (column.key === 'photo') {
        const photo = el('button', undefined, 'product-photo-button'),
          image = el('img')
        image.width = image.height = 74
        image.alt = row.source?.title || ''
        photo.append(image)
        photo.onclick = () => onInspect(row)
        td.append(photo)
        if (row.source?.thumbnail)
          void loadImage(row.source.thumbnail)
            .then((url) => {
              if (image.isConnected) image.src = url
            })
            .catch(() => {
              photo.disabled = true
            })
        else photo.disabled = true
      } else if (column.readonly) {
        if (kind === 'cartons' && column.key === 'label') {
          const reference = el('span', row.label, 'carton-reference-text'),
            copy = decorateIcon(el('button'), 'copy', {
              iconOnly: true,
              label: m('Copy value'),
            })
          copy.classList.add('carton-reference-copy')
          bindAttribute(
            copy,
            'aria-label',
            () => `${m('Copy value')}: ${row.label}`
          )
          copy.onclick = (event) => {
            event.stopPropagation()
            void copied(copy, () =>
              navigator.clipboard.writeText(row.label)
            ).catch(onError)
          }
          td.append(reference, copy)
          tr.append(td)
          continue
        }
        if (column.key === 'pattern' && row.patternLabel) {
          const readout = el('span', undefined, 'pattern-readout'),
            copy = el('button', m('Copy value'))
          td.patternLabel = row.patternLabel
          bindText(readout, () => td.patternLabel())
          copy.onclick = () =>
            void copied(copy, () =>
              navigator.clipboard.writeText(td.patternLabel())
            ).catch(onError)
          td.append(readout, copy)
          tr.append(td)
          continue
        }
        const labels = {
          uniform: 'Uniform',
          uneven: 'Uneven',
          shared: 'Shared',
          unassigned: 'Unassigned',
          'needs-review': 'Needs review',
          carton: 'Per carton',
          batch: 'Combined set',
          aggregate: 'Combined set',
          exact: 'Confirmed facts',
        }
        const value =
          ['weightBasis', 'volumeBasis', 'provenance'].includes(column.key) &&
          labels[row[column.key]]
            ? m(labels[row[column.key]])
            : row[column.key]
        const readout = copyTextButton(value ?? '—', {
          label: m('Copy value'),
        })
        if (isMessage(value)) {
          const text = el('span')
          bindText(text, value)
          readout.firstChild.replaceWith(text)
        }
        if (
          ['code', 'physicalMarkCode', 'currentProductCode'].includes(
            column.key
          ) &&
          /^CE\d{8}/.test(String(value))
        ) {
          const status = readout.querySelector('[role="status"]')
          readout.classList.add('ce-code')
          setCodeText(readout, value)
          if (status) readout.append(status)
        }
        if (column.key === 'provenance' && row.physicalMark) {
          const review = el('button', m('Review physical mark'))
          review.dataset.action = 'review-carton-physical-mark'
          review.onclick = () =>
            void session
              .reviewPhysicalMark(row.key, { loadImage })
              .catch(onError)
          td.append(review)
        }
        td.append(readout)
        if (column.key === 'code' && row.states?.length) {
          const states = el('span', undefined, 'packing-state-chips')
          for (const state of row.states)
            states.append(el('small', m(labels[state] || 'Needs review')))
          td.append(states)
        }
        if (column.key === 'unassigned' && row.remainderCommand) {
          const button = el(
            'button',
            m('Separate box for these {0}', { 0: row[column.key] })
          )
          button.dataset.action = 'separate-order-remainder'
          button.onclick = () =>
            void session.command(row.remainderCommand).catch(onError)
          td.append(button)
          const destinations = session
            .projection()
            .cartons.filter(
              (carton) =>
                !carton.removalRequested &&
                (carton.count === 1 || carton.kind === 'capacity')
            )
          if (destinations.length) {
            const destination = el('select'),
              place = el('button', m('Place remainder in carton')),
              index = el('input')
            index.type = 'number'
            index.min = '1'
            index.step = '1'
            index.value = '1'
            bindAttribute(
              index,
              'aria-label',
              m('Carton within the uniform proposal')
            )
            const updateIndex = () => {
              const count =
                destinations.find((carton) => carton.key === destination.value)
                  ?.count ?? 1
              index.hidden = count <= 1
              index.max = String(count)
              index.value = '1'
            }
            bindAttribute(destination, 'aria-label', m('Destination carton'))
            for (const carton of destinations)
              destination.append(
                new Option(carton.label || carton.key, carton.key)
              )
            destination.onchange = updateIndex
            updateIndex()
            place.dataset.action = 'place-order-remainder'
            place.onclick = () =>
              void session
                .command({
                  type: 'place',
                  entryId: row.remainderCommand.entryId,
                  destinationId: destination.value,
                  ...(!index.hidden
                    ? { destinationIndex: Number(index.value) - 1 }
                    : {}),
                })
                .catch(onError)
            td.append(destination, index, place)
          }
        }
      } else {
        const input = el('input')
        input.type = 'text'
        input.inputMode = column.type === 'whole' ? 'numeric' : 'decimal'
        input.value =
          session.rawCell(row.key, column.key) ?? row[column.key] ?? ''
        try {
          numericCell(input.value, column)
        } catch {
          input.setAttribute('aria-invalid', 'true')
        }
        bindAttribute(
          input,
          'aria-label',
          m('{0}: {1}', {
            0: m(column.label),
            1: row.code || row.label || row.key,
          })
        )
        input.dataset.gridColumn = column.key
        let composing = false
        input.onfocus = () => {
          active = { key: row.key, column: column.key }
          session.setActiveCell?.(row.key, column.key)
        }
        input.oncompositionstart = () => {
          composing = true
        }
        input.oncompositionend = () => {
          composing = false
          input.dispatchEvent(new Event('input'))
        }
        input.oninput = () => {
          if (!composing) {
            session.editCell(row.key, column.key, input.value)
            try {
              numericCell(input.value, column)
              input.removeAttribute('aria-invalid')
              bindText(status, m('Pending changes'))
            } catch (error) {
              input.setAttribute('aria-invalid', 'true')
              bindText(status, m(error.message))
            }
            renderSummary()
          }
        }
        input.onblur = () =>
          void (
            session.commitCell
              ? session.commitCell(row.key, column.key, input.value)
              : session.flush()
          ).catch(onError)
        input.onkeydown = (event) => {
          if (
            event.isComposing ||
            composing ||
            !['Tab', 'Enter'].includes(event.key) ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          )
            return
          const next = nextGridCell(
            visibleKeys,
            columns,
            row.key,
            column.key,
            event
          )
          if (!next) return
          event.preventDefault()
          grid
            .ensureVisible(next.key)
            ?.querySelector(`[data-grid-column="${next.column}"]`)
            ?.focus()
        }
        td.append(input)
      }
      tr.append(td)
    }
    function inspect() {
      if (kind === 'cartons') openCartonDetails(row)
      else onInspect(row)
    }
    tr.onclick = (event) => {
      if (!event.target.closest('button, input, a, label, select, textarea'))
        inspect()
    }
    tr.onkeydown = (event) => {
      if (event.target === tr && event.key === 'Enter' && !event.isComposing)
        inspect()
    }
    return tr
  }
  function openCartonDetails(row) {
    const modal = el(
        'dialog',
        undefined,
        'order-carton-details product-authoring-dialog'
      ),
      status = el('p'),
      close = el('button', m('Close'))
    modal.dataset.action = 'inspect-order-carton'
    modal.append(
      el('h2', row.label),
      el('p', row.provenance || ''),
      el('p', row.contents || m('Unknown contents'))
    )
    if (row.physicalMark) {
      const review = el('button', m('Review physical mark'))
      review.dataset.action = 'review-carton-physical-mark'
      review.onclick = () =>
        void session
          .reviewPhysicalMark(row.key, { loadImage })
          .then((dialog) => {
            if (dialog) modal.close()
          })
          .catch(onError)
      modal.append(review)
    }
    const fields = el('div', undefined, 'product-authoring-fields')
    for (const column of CARTON_GRID_COLUMNS.filter(
      (column) => !column.readonly
    )) {
      const label = el('label', m(column.label)),
        input = el('input')
      input.type = 'text'
      input.value =
        session.rawCell(row.key, column.key) ?? row[column.key] ?? ''
      input.inputMode = 'decimal'
      let composing = false
      input.oncompositionstart = () => {
        composing = true
      }
      input.oncompositionend = () => {
        composing = false
        session.editCell(row.key, column.key, input.value)
      }
      input.oninput = () => {
        if (!composing) session.editCell(row.key, column.key, input.value)
      }
      input.onblur = () =>
        void session
          .commitCell(row.key, column.key, input.value)
          .catch((error) => bindText(status, m(error.message)))
      label.append(input)
      fields.append(label)
    }
    modal.append(fields)
    let flushIdentity = async () => {}
    if (session.stageCartonIdentity) {
      const recovery = session.identityDraft(row.key),
        numberLabel = el('label', m('Carton reference')),
        number = el('input'),
        markLabel = el('label', m('Carton mark')),
        mark = el('select')
      number.type = 'text'
      number.value = recovery?.cartonNumber ?? row.cartonNumber ?? ''
      number.dataset.cartonIdentity = 'reference'
      mark.dataset.cartonIdentity = 'mark'
      bindAttribute(mark, 'aria-label', m('Carton mark'))
      mark.append(new Option(String(m('Keep current carton mark')), ''))
      for (const group of session.orderGroups())
        mark.append(new Option(group.baseCode, group.id))
      mark.value = recovery?.markGroupId ?? row.mark?.groupId ?? ''
      let dirty = recovery?.reviewed === false
      const retain = () => {
        dirty = true
        session.retainIdentityDraft(row.key, {
          cartonNumber: number.value,
          markGroupId: mark.value,
        })
      }
      number.oninput = (event) => {
        if (!event.isComposing) retain()
      }
      number.oncompositionend = retain
      mark.onchange = retain
      numberLabel.append(number)
      markLabel.append(mark)
      fields.append(numberLabel, markLabel)
      flushIdentity = async () => {
        if (!dirty) return
        await session.stageCartonIdentity({
          batchId: row.key,
          cartonNumber: number.value,
          markGroupId: mark.value,
        })
        dirty = false
      }
    }
    let flushUnit = async () => {}
    if (
      row.count > 1 &&
      row.draftKind !== 'proposal' &&
      row.kind !== 'capacity' &&
      session.unitEntitlements
    ) {
      const units = session.unitEntitlements(row.key),
        section = el('section', undefined, 'carton-unit-exception'),
        picker = el('select'),
        unitFields = el('div'),
        evidence = el('p'),
        caption = el('label', m('Physical carton entitlement'))
      picker.dataset.action = 'choose-carton-entitlement'
      bindAttribute(picker, 'aria-label', m('Physical carton entitlement'))
      caption.append(picker)
      section.append(
        el('h3', m('Exceptional carton contents')),
        caption,
        evidence,
        unitFields,
        el(
          'p',
          m(
            'Known facts are prefilled. Unknown aggregate contents stay blank; untouched cartons are never divided by an average. Changed contents require new weight evidence.'
          )
        )
      )
      for (const unit of units)
        picker.append(
          new Option(`${unit.reference} · ${unit.id}`, String(unit.index))
        )
      let selected = units[0],
        dirty = false,
        contentInputs = [],
        measurementInputs = [],
        restoring = false,
        contentsChanged = false
      const pending = units.find(
        (unit) => session.unitDraft?.(row.key, unit.index)?.reviewed === false
      )
      if (pending) selected = pending
      picker.value = String(selected.index)
      function inputValue() {
        return {
          ...(contentsChanged
            ? {
                contents: contentInputs
                  .filter(({ input }) => input.value.trim())
                  .map(({ entryId, input }) => ({
                    orderId: session.orderRef.orderId,
                    entryId,
                    quantity: input.value.trim(),
                  })),
              }
            : {}),
          measurements: Object.fromEntries(
            measurementInputs
              .filter(({ changed }) => changed)
              .map(({ key, input }) => [key, input.value.trim()])
          ),
        }
      }
      const retain = () => {
        if (restoring) return
        dirty = true
        session.retainUnitDraft(row.key, selected.index, inputValue())
      }
      function renderUnit() {
        restoring = true
        contentInputs = []
        measurementInputs = []
        const recovered = session.unitDraft?.(row.key, selected.index),
          known = recovered?.contents ?? selected.contents
        contentsChanged = recovered?.contents !== undefined
        bindText(
          evidence,
          m(known === null ? 'Unknown contents' : 'Confirmed facts')
        )
        unitFields.replaceChildren()
        for (const product of session.projection().products) {
          const label = el('label', `${product.code} · ${product.entryId}`),
            input = el('input')
          input.type = 'text'
          input.inputMode = 'numeric'
          input.value =
            known?.find((part) => part.entryId === product.entryId)?.quantity ||
            ''
          input.dataset.entryId = product.entryId
          let composing = false
          input.oncompositionstart = () => {
            composing = true
          }
          input.oncompositionend = () => {
            composing = false
            contentsChanged = true
            retain()
          }
          input.oninput = () => {
            if (!composing) {
              contentsChanged = true
              retain()
            }
          }
          label.append(input)
          unitFields.append(label)
          contentInputs.push({ entryId: product.entryId, input })
        }
        for (const [key, title] of [
          ['len', 'Length (cm)'],
          ['wid', 'Width (cm)'],
          ['ht', 'Height (cm)'],
          ['weight', 'Weight (kg)'],
          ['suppliedCbm', 'Supplied volume (m³)'],
        ]) {
          const label = el('label', m(title)),
            input = el('input'),
            model = {
              key,
              input,
              changed: Object.hasOwn(recovered?.measurements || {}, key),
            }
          input.type = 'text'
          input.inputMode = 'decimal'
          input.value = recovered?.measurements?.[key] ?? selected[key] ?? ''
          input.dataset.unitMeasurement = key
          input.oninput = () => {
            model.changed = true
            retain()
          }
          label.append(input)
          unitFields.append(label)
          measurementInputs.push(model)
        }
        dirty = recovered?.reviewed === false
        restoring = false
      }
      flushUnit = async () => {
        if (!dirty) return
        const value = inputValue()
        if (value.contents?.some((part) => !/^[1-9]\d*$/.test(part.quantity)))
          throw new Error('Carton contents require positive whole quantities.')
        await session.stageUnitFacts({
          batchId: row.key,
          index: selected.index,
          ...value,
        })
        dirty = false
      }
      picker.onchange = () => {
        const next = picker.value
        picker.disabled = true
        void flushUnit()
          .then(() => {
            selected = session
              .unitEntitlements(row.key)
              .find((unit) => String(unit.index) === next)
            renderUnit()
          })
          .catch((error) => {
            picker.value = String(selected.index)
            bindText(status, m(error.message))
          })
          .finally(() => {
            picker.disabled = false
          })
      }
      renderUnit()
      modal.append(section)
    }
    if (row.count === 1) {
      for (const part of row.contentEntries) {
        const section = el('section'),
          title = el(
            'p',
            `${session.projection().products.find((product) => product.entryId === part.entryId)?.code || part.entryId}: ${part.quantity}`
          ),
          destination = el('select'),
          quantity = el('input'),
          move = el('button', m('Move these pieces'))
        bindAttribute(destination, 'aria-label', m('Destination carton'))
        quantity.type = 'text'
        quantity.inputMode = 'numeric'
        quantity.value = part.quantity
        bindAttribute(quantity, 'aria-label', m('Pieces to move'))
        for (const target of session
          .projection()
          .cartons.filter(
            (carton) =>
              carton.key !== row.key &&
              carton.count === 1 &&
              !carton.removalRequested
          ))
          destination.append(new Option(target.label, target.key))
        move.dataset.action = 'move-order-carton-contents'
        move.disabled = !destination.children.length
        move.onclick = () =>
          void session
            .command({
              type: 'move',
              entryId: part.entryId,
              fromId: row.key,
              destinationId: destination.value,
              quantity: quantity.value,
            })
            .then(() => {
              modal.close()
              render()
            })
            .catch((error) => bindText(status, m(error.message)))
        section.append(title, destination, quantity, move)
        modal.append(section)
      }
    }
    const finish = () =>
      void flushIdentity()
        .then(flushUnit)
        .then(() => session.flush())
        .then(() => modal.close())
        .catch((error) => bindText(status, m(error.message)))
    close.onclick = finish
    status.setAttribute('role', 'status')
    modal.append(status, close)
    modal.oncancel = (event) => {
      event.preventDefault()
      finish()
    }
    modal.onclose = () => modal.remove()
    document.body.append(modal)
    modal.showModal()
  }
  function preview(plan) {
    currentPlan = plan
    const dialog = el('dialog', undefined, 'grid-paste-preview'),
      body = el('div', undefined, 'grid-paste-preview-body'),
      actions = el('div', undefined, 'dialog-actions')
    dialog.append(el('h2', m('Review paste alignment')))
    for (const change of plan.changes) {
      const row = rows.find((row) => row.key === change.key)
      const line = el('p'),
        column = columns.find((entry) => entry.key === change.column)
      bindText(
        line,
        () =>
          `${row?.code || row?.label || change.key || '—'} · ${column ? m(column.label) : change.column || '—'}: ${change.before ?? '—'} → ${change.raw}`
      )
      body.append(line)
    }
    for (const error of plan.errors)
      body.append(el('p', m(error.message), 'error'))
    const cancel = el('button', m('Cancel')),
      apply = el(
        'button',
        m(plan.valid ? 'Use this alignment' : 'Keep invalid draft'),
        'primary'
      )
    apply.dataset.action = 'apply-carton-paste'
    cancel.onclick = () => dialog.close()
    apply.onclick = () =>
      void (async () => {
        assertGridTarget(plan.target, target())
        await session.applyPaste(plan, target())
        dialog.close()
        currentPlan = null
        render()
      })().catch((error) => {
        bindText(status, m(error.message))
        onError(error)
      })
    actions.append(cancel, apply)
    dialog.append(body, actions)
    dialog.onclose = () => dialog.remove()
    document.body.append(dialog)
    dialog.showModal()
  }
  function render() {
    const projection = session.projection()
    rows = kind === 'cartons' ? projection.cartons : projection.products
    const visible = rows.filter(
      (row) => !filter || JSON.stringify(row).toLowerCase().includes(filter)
    )
    visibleKeys = visible.map((row) => row.key)
    renderSummary(projection)
    const state = session.state()
    undo.disabled = !state.canUndo
    redo.disabled = !state.canRedo
    confirm.disabled = Boolean(session.busy?.())
    const editing =
      document.activeElement?.matches?.('input[data-grid-column]') &&
      scroller.contains(document.activeElement)
    if (
      !editing ||
      JSON.stringify(mountedKeys) !== JSON.stringify(visibleKeys)
    ) {
      grid.setItems(visible.map((row) => ({ key: row.key, row })))
      mountedKeys = [...visibleKeys]
    } else {
      for (const element of body.querySelectorAll('[data-grid-key]'))
        for (const input of element.querySelectorAll('input[data-grid-column]'))
          if (input !== document.activeElement)
            input.value = session.rawCell(
              element.dataset.gridKey,
              input.dataset.gridColumn
            )
    }
  }
  function renderSummary(projection = session.projection()) {
    summary.replaceChildren()
    for (const [key, label] of [
      ['reportedCount', 'Reported carton total'],
      ['confirmedCount', 'Confirmed cartons'],
      ['proposedCount', 'Proposed cartons'],
      ['unassignedPieces', 'Unassigned pieces'],
      ['unresolvedPieces', 'Unresolved contents'],
      ['countDifference', 'Count difference'],
      ['knownWeight', 'Known kg'],
      ['weightCoverage', 'Weight coverage'],
      ['knownVolume', 'Known m³'],
      ['volumeCoverage', 'Volume coverage'],
    ]) {
      const metric = el('div'),
        value = projection.summary?.[key]
      const text =
        value && typeof value === 'object'
          ? String(
              m('{0} known · {1} missing · {2} unknown-count sets', {
                0: value.knownCount,
                1: value.missingCount,
                2: value.unknownCountBatches,
              })
            )
          : String(value ?? '—')
      metric.append(el('span', m(label)), el('strong', text))
      summary.append(metric)
    }
    const state = session.state()
    undo.disabled = !state.canUndo
    redo.disabled = !state.canRedo
    issuesHost.replaceChildren()
    const issueText = {
      'invalid-capacity': 'Pcs/box must be a positive whole number',
      'product-overallocated':
        'Reported and proposed contents exceed eligible purchase quantities.',
      'coverage-infeasible':
        'Reported and proposed contents exceed eligible purchase quantities.',
      'negative-carton-budget':
        'Carton counts disagree with the reported total.',
      'reported-count-conflict':
        'Carton counts disagree with the reported total.',
      'invalid-measurement':
        'Complete or clear the carton dimensions and measurement values.',
      'incomplete-dimensions':
        'Complete or clear the carton dimensions and measurement values.',
      'volume-discrepancy':
        'Supplied and dimension-derived volumes differ; both are retained.',
    }
    for (const issue of projection.issues || []) {
      if (issue.code === 'volume-discrepancy') {
        const notice = el('div', undefined, 'measurement-warning')
        notice.dataset.issueCode = issue.code
        notice.dataset.issueSeverity = issue.severity
        const carton = projection.cartons.find(
          (row) => row.id === issue.cartonId || row.id === issue.batchId
        )
        if (carton)
          notice.append(
            el(
              'strong',
              m('{0}: {1}', {
                0: m('Carton reference'),
                1: carton.label || carton.id,
              })
            )
          )
        for (const text of measurementWarningMessages(issue, m))
          notice.append(el('p', text))
        issuesHost.append(notice)
        continue
      }
      const line = el(
        'p',
        m(
          issue.message ||
            issueText[issue.code] ||
            'Review the affected source and carton evidence.'
        )
      )
      if (issue.entryId) {
        const reveal = el('button', m('Show affected row'))
        reveal.onclick = () => {
          const row = projection.products.find(
            (row) => row.entryId === issue.entryId
          )
          if (row)
            grid
              .ensureVisible(row.key)
              ?.querySelector('input:not([type="checkbox"])')
              ?.focus()
        }
        line.append(reveal)
      }
      issuesHost.append(line)
    }
    suggestionsHost.replaceChildren()
    for (const suggestion of projection.suggestions || []) {
      const card = el('article')
      card.append(
        el(
          'p',
          m(
            'Suggested contents require confirmation of actual packing. Physical fit remains unknown.'
          )
        )
      )
      for (const [choiceIndex, choice] of suggestion.choices.entries()) {
        const button = el(
          'button',
          choice.map((part) => `${part.entryId}: ${part.quantity}`).join(' + ')
        )
        button.dataset.action = 'accept-carton-suggestion'
        button.onclick = () =>
          void session
            .command({
              type: 'accept-suggestion',
              id: suggestion.id,
              choiceIndex,
              confirmed: true,
            })
            .catch(onError)
        card.append(button)
      }
      const reject = el('button', m('Reject suggestion'))
      reject.dataset.action = 'reject-carton-suggestion'
      reject.onclick = () =>
        void session
          .command({ type: 'reject', id: suggestion.id })
          .catch(onError)
      card.append(reject)
      suggestionsHost.append(card)
    }
    for (const row of projection.products) {
      const element = [...body.querySelectorAll('[data-grid-key]')].find(
        (element) => element.dataset.gridKey === row.key
      )
      if (!element) continue
      for (const key of [
        'available',
        'proposedCount',
        'unassigned',
        'pattern',
      ]) {
        const td = element.querySelector(`[data-column="${key}"]`)
        if (
          key === 'pattern' &&
          td?.querySelector('.pattern-readout') &&
          row.patternLabel
        ) {
          td.patternLabel = row.patternLabel
          bindText(td.querySelector('.pattern-readout'), () =>
            td.patternLabel()
          )
          continue
        }
        if (td?.firstElementChild)
          td.firstElementChild.replaceWith(
            copyTextButton(String(row[key] ?? '—'), { label: m('Copy value') })
          )
      }
      const separate = element.querySelector(
        '[data-action="separate-order-remainder"]'
      )
      if (separate) {
        separate.hidden = !row.remainderCommand
        bindText(
          separate,
          m('Separate box for these {0}', { 0: row.unassigned })
        )
      }
    }
  }
  const unsubscribe = session.subscribe((reason) => {
    if (reason === 'input') return
    render()
  })
  render()
  if (active.key)
    grid
      .ensureVisible(active.key)
      ?.querySelector(`[data-grid-column="${active.column}"]`)
      ?.focus()
  return {
    render,
    target,
    reveal(key, column = 'capacity') {
      active = { key, column }
      grid
        .ensureVisible(key)
        ?.querySelector(`[data-grid-column="${column}"]`)
        ?.focus()
    },
    destroy() {
      unsubscribe()
      grid.destroy()
      session.cancelParse()
      host.replaceChildren()
    },
  }
}

/** Report intake has no inventory model: originals, revisions and commits belong to the repository. */
export async function createPackingReportIntakeController({
  repository,
  orderRef,
  createClient,
  onChange = () => {},
  contextContainerId,
}) {
  const contextRef = {
    ...orderRef,
    ...(contextContainerId ? { contextContainerId } : {}),
  }
  const client = createClient(),
    context = await repository.getPackingReportContext(contextRef)
  const amendmentContext = clone(
    context.amendmentContext || context.expectedRevisions?.amendmentContext
  )
  let state = {
      context,
      source: null,
      analysis: null,
      review: null,
      plan: null,
      decisions: {},
      explicitMatches: { matches: {}, removals: [] },
      priorReport: null,
      generation: 0,
    },
    commitWork
  const recoveryKey = `1688-orders-report-draft:${JSON.stringify([orderRef.accountId, orderRef.orderId])}${contextContainerId ? `:amendment:${contextContainerId}` : ''}`
  try {
    const recovered = JSON.parse(globalThis.localStorage?.getItem(recoveryKey))
    if (
      recovered &&
      JSON.stringify(recovered.amendmentContext || null) !==
        JSON.stringify(amendmentContext || null)
    ) {
      const { recoveredDrafts = [], ...draft } = recovered
      state.recoveredDrafts = [draft, ...recoveredDrafts]
    } else if (recovered) {
      state = {
        ...state,
        ...recovered,
        context,
        analysis: null,
        review: null,
        plan: null,
      }
    }
  } catch {}
  function retain() {
    try {
      globalThis.localStorage?.setItem(
        recoveryKey,
        JSON.stringify({
          source: state.source,
          decisions: state.decisions,
          explicitMatches: state.explicitMatches,
          priorReport: state.priorReport,
          text: state.text,
          generation: state.generation,
          ...(state.recoveredDrafts?.length
            ? { recoveredDrafts: state.recoveredDrafts }
            : {}),
          ...(amendmentContext ? { amendmentContext } : {}),
        })
      )
    } catch {
      throw new Error('The editing draft could not be saved for recovery.')
    }
  }
  function emit() {
    onChange(clone(state))
  }
  function check(generation) {
    if (generation !== state.generation)
      throw new DOMException('Cancelled', 'AbortError')
  }
  async function run(operation, input, generation) {
    const result = await client.run({ operation, input })
    check(generation)
    return result.result
  }
  async function updateReview() {
    if (!state.source)
      throw new Error('Paste cells or choose a local carton report first.')
    const generation = ++state.generation
    client.cancel()
    state.plan = null
    state.review = null
    emit()
    const original = await repository.getPackingReportSource({
      rawAssetRef: state.source.rawAssetRef,
    })
    check(generation)
    const parsed = await run(
      original.kind === 'clipboard-tsv' ? 'parse' : 'workbook',
      {
        ...state.source,
        ...(original.kind === 'clipboard-tsv'
          ? { text: original.text }
          : {
              filename: original.filename,
              buffer:
                original.bytes instanceof ArrayBuffer
                  ? original.bytes
                  : original.bytes.buffer.slice(
                      original.bytes.byteOffset,
                      original.bytes.byteOffset + original.bytes.byteLength
                    ),
            }),
      },
      generation
    )
    const source = parsed.source || parsed
    if (parsed.source === null) {
      state.analysis = {
        candidates: [],
        decisionRequests: [],
        issues: parsed.issues || [],
      }
      emit()
      return clone(state.analysis)
    }
    state.analysis = await run(
      'analyze',
      { source, context: state.context, decisions: state.decisions },
      generation
    )
    retain()
    emit()
    return clone(state.analysis)
  }
  return {
    state: () => clone(state),
    recoverReviewed(recovered) {
      if (
        !state.recoveredDrafts?.some(
          (entry) => JSON.stringify(entry) === JSON.stringify(recovered)
        )
      )
        throw new Error('The recovered draft is no longer available.')
      client.cancel()
      const remaining = state.recoveredDrafts.filter(
        (entry) => JSON.stringify(entry) !== JSON.stringify(recovered)
      )
      state = {
        ...state,
        ...clone(recovered),
        context,
        amendmentContext,
        generation: state.generation + 1,
        analysis: null,
        review: null,
        plan: null,
        ids: undefined,
        intent: undefined,
        recoveredDrafts: remaining,
      }
      retain()
      emit()
    },
    inputText(text) {
      client.cancel()
      state.generation++
      state.text = text
      state.source = null
      state.analysis = null
      state.plan = null
      state.ids = undefined
      retain()
      emit()
    },
    async read({ text, filename, bytes, kind }) {
      const generation = ++state.generation
      client.cancel()
      const source = await repository.savePackingReportSource({
        ...orderRef,
        kind:
          kind ||
          (bytes
            ? /\.xls$/i.test(filename)
              ? 'xls'
              : 'xlsx'
            : 'clipboard-tsv'),
        ...(filename ? { filename } : {}),
        ...(bytes ? { bytes } : { text }),
      })
      check(generation)
      state.source = source
      state.text = text ?? ''
      state.ids = undefined
      state.decisions = {}
      state.explicitMatches = { matches: {}, removals: [] }
      retain()
      return updateReview()
    },
    choose(request, value) {
      client.cancel()
      state.generation++
      state.decisions[request.id] = {
        scope: clone(request.scope),
        value: clone(value),
      }
      state.ids = undefined
      state.review = null
      state.plan = null
      retain()
    },
    prior(id) {
      client.cancel()
      state.generation++
      state.priorReport = id || null
      state.plan = null
      retain()
    },
    match(candidateKey, batchId) {
      state.explicitMatches.matches[candidateKey] = batchId
      state.plan = null
      retain()
    },
    removal(batchId, checked) {
      state.explicitMatches.removals = state.explicitMatches.removals.filter(
        (id) => id !== batchId
      )
      if (checked) state.explicitMatches.removals.push(batchId)
      state.plan = null
      retain()
    },
    updateReview,
    async plan() {
      if (!state.analysis)
        throw new Error('Review the local report before saving facts.')
      const generation = state.generation,
        current = await repository.getPackingReportContext(contextRef)
      check(generation)
      const prior =
        current.previousReports?.find(
          (report) => report.id === state.priorReport
        ) ||
        (current.previousReports?.length === 1
          ? current.previousReports[0]
          : null)
      state.review = await run(
        'validate',
        {
          analysis: state.analysis,
          decisions: state.decisions,
          context: current,
          previousReportRevision: prior?.revision ?? null,
          expectedContextRevisions: state.context.expectedRevisions,
        },
        generation
      )
      if (!state.review.valid) {
        emit()
        return null
      }
      state.ids ||= state.review.interpretedReport.candidates.map(() =>
        crypto.randomUUID()
      )
      state.plan = await run(
        'plan',
        {
          interpretedReport: state.review.interpretedReport,
          priorReport: prior,
          physicalFacts: (current.batches || []).filter(
            (batch) => !batch.deletedAt
          ),
          manualFacts:
            current.manualFacts ||
            (current.batches || []).filter(
              (batch) => batch.provenance?.kind === 'manual-confirmed'
            ),
          tombstones: (current.batches || []).filter(
            (batch) => batch.deletedAt
          ),
          sealedDependencies: current.sealedDependencies || [],
          explicitMatches: state.explicitMatches,
          newIdentityPool: state.ids,
        },
        generation
      )
      retain()
      emit()
      return clone(state.plan)
    },
    commit() {
      if (commitWork) return commitWork
      if (state.plan?.status !== 'ready')
        throw new Error(
          'Resolve the report review before saving physical facts.'
        )
      const plan = clone(state.plan),
        signature = JSON.stringify(plan),
        generation = state.generation
      if (state.intent?.signature !== signature)
        state.intent = { signature, intentId: crypto.randomUUID() }
      commitWork = repository.commitPackingReportUpdate({
        ...contextRef,
        plan,
        expectedRevisions: plan.expectedRevisions,
        intentId: state.intent.intentId,
      })
      return commitWork
        .then((result) => {
          if (result?.status === 'amendment-required') {
            state.plan = { ...plan, ...clone(result) }
            retain()
            emit()
            return result
          }
          if (state.generation === generation)
            globalThis.localStorage?.removeItem(recoveryKey)
          else retain()
          return result
        })
        .finally(() => {
          commitWork = undefined
        })
    },
    cancel() {
      client.cancel()
      state.generation++
    },
    dispose() {
      client.cancel()
      state.generation++
    },
  }
}

/** One compact source/review dialog; only unresolved meanings need a decision. */
export async function openPackingReportIntake({
  repository,
  orderRef,
  createClient,
  onSaved = () => {},
  onAmend = () => {},
  contextContainerId,
}) {
  const modal = el('dialog', undefined, 'packing-report-intake'),
    fieldset = el('fieldset'),
    input = el('textarea'),
    file = el('input'),
    requests = el('div', undefined, 'packing-report-review'),
    preview = el('div'),
    status = el('p'),
    actions = el('div', undefined, 'dialog-actions'),
    close = el('button', m('Cancel')),
    read = el('button', m('Review carton report')),
    update = el('button', m('Update review')),
    save = el('button', m('Save reviewed report'), 'primary'),
    prior = el('select')
  modal.dataset.action = 'packing-report-intake'
  input.rows = 5
  bindAttribute(input, 'aria-label', m('Supplier carton report cells'))
  file.type = 'file'
  file.accept = '.xlsx,.xls'
  bindAttribute(file, 'aria-label', m('Local carton report workbook'))
  bindAttribute(prior, 'aria-label', m('Report being updated'))
  modal.append(
    el('h2', m('Paste or import carton list')),
    el(
      'p',
      m(
        'This augments the selected 1688 purchase. Source quantities, prices and China import markers stay unchanged.'
      )
    )
  )
  fieldset.append(input, file, prior, requests, preview)
  status.setAttribute('role', 'status')
  actions.append(close, read, update, save)
  modal.append(fieldset, status, actions)
  const candidateScroll = el('div', undefined, 'smart-grid-scroll'),
    candidateTable = el('table'),
    candidateHead = el('thead'),
    candidateBody = el('tbody'),
    candidateHeading = el('tr')
  for (const label of [
    'Carton reference',
    'Carton count',
    'Contents',
    'Measurements',
  ])
    candidateHeading.append(el('th', m(label)))
  candidateHead.append(candidateHeading)
  candidateTable.append(candidateHead, candidateBody)
  candidateScroll.append(candidateTable)
  requests.after(candidateScroll)
  const candidateRows = createVirtualTable({
    scroller: candidateScroll,
    body: candidateBody,
    limit: 100,
    render: (entries) =>
      entries.map(({ candidate }) => {
        const row = el('tr'),
          measurements = el('td')
        for (const fact of candidate.measurementFacts || []) {
          const labels = {
              dimensions: 'Dimensions (cm)',
              weight: 'Weight (kg)',
              volume: 'Supplied volume (m³)',
              calculatedVolume: 'Calculated volume',
            },
            basis = {
              'per-carton': 'Per carton',
              'combined-set': 'Combined set',
              unknown: 'Unknown',
            }
          measurements.append(
            el(
              'p',
              `${m(labels[fact.field] || 'Measurements')}: ${Array.isArray(fact.value) ? fact.value.join('×') : (fact.value ?? '—')} ${fact.unit || ''} · ${m(basis[fact.basis] || 'Unknown')}`
            )
          )
        }
        const provenance = el('details'),
          summary = el('summary', m('Evidence'))
        provenance.append(summary)
        for (const source of candidate.sourceRefs || [])
          provenance.append(
            el(
              'p',
              `${source.sheet || ''} ${source.address || `${source.row}:${source.col}`}`
            )
          )
        measurements.append(provenance)
        row.append(
          el('td', candidate.supplierLabel || m('Internal reference')),
          el('td', String(candidate.count ?? '—')),
          el(
            'td',
            candidate.contentClaims
              ?.map(
                (claim) =>
                  `${claim.supplierCode || claim.entryIds?.join(',') || '?'}: ${claim.quantity ?? '—'}`
              )
              .join(' · ') || m('Unknown contents')
          ),
          measurements
        )
        return row
      }),
  })
  let busy = false,
    controller
  const failure = (error) => {
    if (error.name !== 'AbortError') bindText(status, m(error.message))
  }
  controller = await createPackingReportIntakeController({
    repository,
    orderRef,
    contextContainerId,
    createClient,
    onChange: render,
  })
  input.value = controller.state().text || ''
  const recovered = controller.state().recoveredDrafts || []
  if (recovered.length) {
    const recover = el('button', m('Review recovered carton report'))
    recover.dataset.action = 'review-recovered-carton-report'
    actions.prepend(recover)
    recover.onclick = () =>
      void (async () => {
        const accepted = await reviewPackingChanges({
          title: m('Review recovered carton report'),
          explanation: m(
            'This report draft belongs to an earlier amendment. Review its original source and decisions before using it in the current review.'
          ),
          changes: [
            {
              name: m('Supplier carton report cells'),
              before: '',
              after: recovered[0].text || JSON.stringify(recovered[0].source),
            },
            {
              name: m('Evidence'),
              before: '',
              after: JSON.stringify(recovered[0].decisions || {}),
            },
          ],
          proceed: m('Use these reviewed edits'),
        })
        if (!accepted) return
        controller.recoverReviewed(recovered[0])
        input.value = controller.state().text || ''
        await controller.updateReview()
        await controller.plan()
        recover.remove()
      })().catch(failure)
  }
  prior.append(
    new Option(String(m('New carton report')), ''),
    ...(controller.state().context.previousReports || []).map(
      (report) => new Option(report.source?.filename || report.id, report.id)
    )
  )
  prior.value = controller.state().priorReport || ''
  prior.onchange = () => {
    controller.prior(prior.value)
    save.disabled = true
  }
  input.oninput = () => {
    file.value = ''
    controller.inputText(input.value)
    save.disabled = true
  }
  file.onchange = () => {
    controller.inputText(input.value)
    save.disabled = true
  }
  read.dataset.action = 'review-carton-report'
  update.dataset.action = 'update-carton-report-review'
  save.dataset.action = 'commit-carton-report'
  read.onclick = () =>
    void (async () => {
      const chosen = file.files?.[0],
        generation = controller.state().generation
      const bytes = chosen ? await chosen.arrayBuffer() : null
      if (controller.state().generation !== generation) return
      await controller.read(
        chosen ? { filename: chosen.name, bytes } : { text: input.value }
      )
      await controller.plan()
    })().catch(failure)
  update.onclick = () =>
    void controller
      .updateReview()
      .then(() => controller.plan())
      .catch(failure)
  save.onclick = () =>
    void (async () => {
      busy = true
      fieldset.disabled =
        close.disabled =
        read.disabled =
        update.disabled =
        save.disabled =
          true
      try {
        const result = await controller.commit()
        if (result?.status === 'amendment-required') return
        await onSaved()
        modal.close('saved')
      } catch (error) {
        failure(error)
      } finally {
        busy = false
        fieldset.disabled =
          close.disabled =
          read.disabled =
          update.disabled =
            false
        render(controller.state())
      }
    })()
  close.onclick = () => {
    if (!busy) {
      controller.cancel()
      modal.close()
    }
  }
  modal.oncancel = (event) => {
    if (busy) event.preventDefault()
    else controller.cancel()
  }
  modal.onclose = () => {
    controller.dispose()
    candidateRows.destroy()
    modal.remove()
  }
  function render(state) {
    if (!controller) return
    requests.replaceChildren()
    preview.replaceChildren()
    save.disabled = busy || state.plan?.status !== 'ready'
    const labels = {
      selectSheet: 'Choose worksheet',
      selectTable: 'Choose header row',
      columnRole: 'Match this source column',
      numericLocale: 'Choose number format',
      basisConflict: 'Choose per-carton or combined basis',
      measurementBasis: 'Choose per-carton or combined basis',
      unsupportedUnit: 'Keep this measurement unknown',
      unitConflict: 'Confirm measurement unit',
      measurementUnit: 'Confirm measurement unit',
      lossyIdentifier: 'Confirm the exact supplier identifier',
      cartonRange: 'Review explicit carton range',
      alignedLists: 'Confirm aligned per-carton values',
      repeatedLabel: 'Review repeated carton numbers',
      codeAlias: 'Match supplier code to this order',
      completeSetCoverage: 'Optional complete-set product coverage',
    }
    const choices = {
      'per-carton': 'Per carton',
      'combined-set': 'Combined set',
      unknown: 'Unknown',
      'decimal-dot': 'Decimal point',
      'decimal-comma': 'Decimal comma',
      separate: 'Separate cartons',
      contents: 'Several contents of one carton',
      'retain-unknown': 'Keep unknown',
      label: 'Carton reference',
      code: 'Code',
      quantity: 'Quantity',
      count: 'Carton count',
      dimensions: 'Dimensions (cm)',
      weight: 'Weight (kg)',
      volume: 'Volume (m³)',
      ignore: 'Ignore column',
      section: 'Section',
    }
    for (const request of state.analysis?.decisionRequests || []) {
      const section = el('section'),
        title = el('h3', m(labels[request.code] || 'Review source meaning'))
      const premise =
        request.scope.header ||
        request.scope.label ||
        request.params?.code ||
        request.scope.cell?.display ||
        request.scope.cell?.raw ||
        request.params?.example ||
        request.scope.column?.header ||
        ''
      section.append(title, el('p', String(premise)))
      const choose = (value) => {
        controller.choose(request, value)
        save.disabled = true
      }
      let options =
        request.params?.choices ||
        request.params?.roles ||
        request.params?.headerRows ||
        request.scope.sheets
      if (options?.length) {
        const select = el('select')
        select.append(new Option(String(m('Choose…')), ''))
        for (const value of options)
          select.append(
            new Option(
              choices[value] ? String(m(choices[value])) : String(value),
              String(value)
            )
          )
        const selected = state.decisions[request.id]?.value
        select.value = selected == null ? '' : String(selected)
        select.onchange = () => {
          if (select.value)
            choose(
              request.code === 'selectTable'
                ? Number(select.value)
                : select.value
            )
        }
        section.append(select)
      } else if (request.code === 'codeAlias') {
        const select = el('select')
        select.append(new Option(String(m('Keep unresolved')), ''))
        const groups = new Map()
        for (const product of state.context.products) {
          const group = groups.get(product.groupId) || []
          group.push(product)
          groups.set(product.groupId, group)
        }
        for (const [groupId, products] of groups)
          select.append(
            new Option(
              products
                .map(
                  (product) =>
                    product.name || product.ceCodes?.[0] || product.entryId
                )
                .join(' · '),
              groupId
            )
          )
        select.onchange = () => {
          if (select.value)
            choose({
              accountId: orderRef.accountId,
              orderId: orderRef.orderId,
              entryIds: groups
                .get(select.value)
                .map((product) => product.entryId),
            })
        }
        section.append(select)
      } else if (request.code === 'completeSetCoverage') {
        section.append(
          el(
            'p',
            m(
              'Leave unresolved unless actual complete-set product totals are established. Matching purchase totals alone is not proof.'
            )
          )
        )
        const values = new Map()
        for (const product of state.context.products) {
          const label = el(
              'label',
              product.name || product.ceCodes?.[0] || product.entryId
            ),
            value = el('input')
          value.type = 'text'
          value.inputMode = 'numeric'
          value.value =
            state.decisions[request.id]?.value?.contents?.find(
              (part) => part.entryId === product.entryId
            )?.quantity || ''
          values.set(product.entryId, value)
          label.append(value)
          section.append(label)
        }
        const confirm = el('button', m('Confirm these actual product totals'))
        confirm.onclick = () => {
          choose({
            provenance: 'owner-confirmed',
            contents: [...values]
              .filter(([, input]) => input.value.trim())
              .map(([entryId, input]) => ({
                entryId,
                quantity: input.value.trim(),
              })),
          })
        }
        section.append(confirm)
      } else if (
        request.code === 'cartonRange' ||
        request.code === 'alignedLists'
      ) {
        const confirm = el(
          'button',
          m(
            request.code === 'cartonRange'
              ? 'Confirm these explicit carton references'
              : 'Confirm these aligned values'
          )
        )
        if (request.params?.proposed)
          section.append(el('p', request.params.proposed.join(', ')))
        confirm.onclick = () =>
          choose(
            request.code === 'cartonRange'
              ? { labels: request.params.proposed }
              : true
          )
        confirm.disabled =
          request.code === 'cartonRange' && !request.params?.proposed?.length
        section.append(confirm)
      } else {
        const text = el('input')
        text.type = 'text'
        text.value = state.decisions[request.id]?.value || ''
        text.onchange = () => choose(text.value)
        section.append(text)
      }
      for (const control of section.querySelectorAll('select,input,button')) {
        control.dataset.action = 'report-review-decision'
        control.dataset.decisionId = request.id
        if (!control.closest('label') && !control.hasAttribute('aria-label'))
          bindAttribute(
            control,
            'aria-label',
            m('{0}: {1}', {
              0: m(labels[request.code] || 'Review source meaning'),
              1: String(premise),
            })
          )
      }
      requests.append(section)
    }
    for (const issue of state.review?.issues || state.analysis?.issues || [])
      if (issue.severity === 'error')
        preview.append(
          el('p', m('Source facts require correction before import.')),
          el(
            'small',
            issue.sourceRefs
              ?.map(
                (ref) =>
                  `${ref.sheet || ''} ${ref.address || `${ref.row}:${ref.col}`}`
              )
              .join(' · ') || ''
          )
        )
    candidateRows.setItems(
      (state.analysis?.candidates || []).map((candidate) => ({
        key: candidate.candidateKey,
        candidate,
      }))
    )
    for (const match of state.plan?.unresolvedMatches || []) {
      const label = el('label', m('Review changed physical identity'))
      if (match.candidateKey) {
        const select = el('select')
        select.append(
          new Option(String(m('Choose…')), ''),
          new Option(String(m('New physical carton')), 'new'),
          ...(match.possibleBatchIds || []).map((id) => new Option(id, id))
        )
        select.onchange = () => {
          if (select.value) {
            controller.match(match.candidateKey, select.value)
            save.disabled = true
          }
        }
        label.append(select)
      } else if (match.batchId) {
        const check = el('input')
        check.type = 'checkbox'
        check.onchange = () => {
          controller.removal(match.batchId, check.checked)
          save.disabled = true
        }
        label.append(check, el('span', match.batchId))
      }
      preview.append(label)
    }
    if (state.plan) {
      const diff = state.plan.evidenceDiff || {}
      preview.append(
        el(
          'p',
          m('Added {0} · Changed {1} · Removed {2} · Unchanged {3}', {
            0: diff.added?.length ?? 0,
            1: diff.changed?.length ?? 0,
            2: diff.removed?.length ?? 0,
            3: diff.unchanged?.length ?? 0,
          })
        )
      )
      if (state.plan.status === 'unchanged')
        preview.append(
          el('p', m('This report is unchanged. No cartons were added.'))
        )
      if (state.plan.status === 'amendment-required')
        for (const dependency of state.plan.affectedShipmentRevisions || []) {
          const amend = el('button', m('Open container amendment'))
          amend.onclick = () => {
            modal.close()
            onAmend(dependency)
          }
          preview.append(amend)
        }
    }
  }
  document.body.append(modal)
  render(controller.state())
  modal.showModal()
  return { dialog: modal, controller }
}
