import { message as m } from './i18n.js'

/** The same physical consequences appear in grouping, month and repeat-purchase reviews. */
export function cartonBatchReviewChanges(plan) {
  return (plan?.reviews || []).map((review, index) => ({
    name: m('Carton batch {0}', { 0: index + 1 }),
    orderId: review.contents[0]?.orderId,
    values: [
      {
        label: m('Carton mark'),
        before: review.beforeMarkCode || review.beforeCodes.join(', '),
        after:
          review.kind === 'reanchor'
            ? review.afterMarkCode || review.afterCodes.join(', ')
            : review.beforeMarkCode || review.beforeCodes.join(', '),
        kind: 'code',
      },
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
          review.kind === 'reanchor'
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
