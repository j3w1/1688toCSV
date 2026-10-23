import { message as m } from './i18n.js'

/** The same physical consequences appear in grouping, month and repeat-purchase reviews. */
export function cartonBatchReviewChanges(plan) {
  return (plan?.reviews || []).map((review, index) => ({
    name: m('Carton batch {0}', { 0: index + 1 }),
    orderId: review.contents[0]?.orderId,
    batchId: review.id,
    ...(review.physicalMark
      ? {
          physicalMark: structuredClone(review.physicalMark),
          physicalMarkCode: review.physicalMark.code,
          currentProductCode: review.currentProductCode,
          currentProductArtwork: structuredClone(review.currentProductArtwork),
          physicalMarkOwnerChoices: structuredClone(
            review.physicalMarkOwnerChoices
          ),
          resolutionRequired: review.resolutionRequired,
          resolutionChoices: review.resolutionChoices,
        }
      : {}),
    values: [
      {
        label: m('Carton mark'),
        before: review.beforeMarkCode || review.beforeCodes.join(', '),
        after: review.physicalMark
          ? review.physicalMark.code
          : review.kind === 'reanchor'
            ? review.afterMarkCode || review.afterCodes.join(', ')
            : review.beforeMarkCode || review.beforeCodes.join(', '),
        kind: 'code',
      },
      ...(review.physicalMark
        ? [
            {
              label: m('Product code'),
              before: review.beforeProductCode || review.beforeMarkCode,
              after: review.currentProductCode || '—',
              kind: 'code',
            },
          ]
        : []),
      {
        label: m('Packing month'),
        before: review.month,
        after: review.month,
      },
      {
        label: m('Cartons'),
        before: review.count ?? '—',
        after: review.count ?? '—',
      },
      {
        label: m('Status'),
        before: m('Saved'),
        after: m(
          review.kind === 'reanchor' && !review.resolutionRequired
            ? 'Linked to the new group'
            : 'Review cartons'
        ),
      },
    ],
    detail: m(
      review.kind === 'reanchor'
        ? 'Carton contents, measurements and confirmations stay together under the new group.'
        : 'Original carton contents, measurements and month confirmations are kept for review. They are excluded from confirmed packing totals until resolved.'
    ),
  }))
}
