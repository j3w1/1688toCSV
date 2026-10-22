# Operating 1688toPL with an automation agent

[Documentation](README.md) · [Agent delivery rules](../AGENTS.md)

Prefer stable `data-action` selectors and labeled fields. Accessible names below are English examples and follow the local dialog language. Use authorized data and supported browser uploads; no host-path API or business API is implied. Sign-in/verification remains user-owned. This guide describes controls, not permission to operate the owner's library.

Popup language is local: inspect its `lang`, use its language controls and preserve workspace language. Nested/portalled previews inherit the opener's language. New assignment reviews show full before/after values or a large overview; choose a card for its complete comparison, arrows to move and Escape to close it. Other reviews scroll continuously.

## Orders from other sources

`add-other-order` opens a draft; manual entry and JSON use identical complete-order validation. Upload one shared-file JSON through `other-order-file`, review, then `other-order-save`. File import fills fields without saving. At least one product row remains. A failed validation or duplicate supplier/reference leaves the full draft and writes nothing; success selects the new order/month.

| `data-action`                | Accessible name / behavior                 |
| ---------------------------- | ------------------------------------------ |
| `add-other-order`            | Add order; opens draft.                    |
| `other-order-import-json`    | Import order JSON; opens the file chooser. |
| `other-order-file`           | Hidden JSON upload input.                  |
| `other-order-add-product`    | Add a draft product.                       |
| `other-order-remove-product` | Remove a draft product.                    |
| `other-order-clear-photo`    | Remove photo from draft.                   |
| `other-order-save`           | Save the complete order.                   |
| `other-order-cancel`         | Discard the unsaved draft.                 |

Fields: `other-order-supplier`, `other-order-reference`, `other-order-date`; per product: `other-order-description`, `other-order-specs`, `other-order-quantity`, `other-order-unit-price`, `other-order-photo`. Labels provide translated accessible names. Errors retain a stable `data-field` path, such as `products.1.quantity`, and set `aria-invalid` when that draft input exists.

One JSON document creates one order:

```json
{
  "format": "1688-order-entry",
  "version": 1,
  "supplier": "Synthetic supplier",
  "reference": "EXT-DEMO-1",
  "date": "2026-10-23",
  "products": [
    {
      "description": "Glass vase",
      "specs": "Clear · large",
      "quantity": "4",
      "unitPrice": "12.505"
    }
  ]
}
```

- Supplier/reference: nonempty single-line text, at most 160 characters each. Date: real `YYYY-MM-DD`.
- Products: 1–200; nonempty description, description/specs at most 2,000 characters each.
- Quantity: string of 1–12 digits, positive whole number. Price: nonnegative exact decimal string, at most 18 integer/6 fractional digits. Row amount rounds once to cents.
- Optional photo: inline PNG/JPEG/WebP/GIF data URL, at most 2,000,000 characters; no remote URLs. Decoded sides at most 8,192 pixels and area at most 16,777,216 pixels. Manual photo files are smaller than 1.4 MB; JSON file limit is 8 MB.
- Unknown fields/versions, malformed dates/values and duplicate normalized supplier/reference are refused. Restore validates uniqueness across the final library too.

Saved records retain generated internal `orderId`, `source: "other"` and human `reference`. Summaries include these fields; copied order-number cells display reference. No 1688 URL/login or payment/shipping status is invented. Existing ambiguous origins remain unchanged.

## 1688 list and import notices

| `data-action`         | Name / behavior                                      |
| --------------------- | ---------------------------------------------------- |
| `import-selected`     | Import selected; requests scope confirmation.        |
| `import-all`          | Import all matching…; requests confirmation.         |
| `confirm-import`      | Confirm the count-bearing import action.             |
| `cancel-import`       | Cancel the proposed import.                          |
| `pause-import`        | Pause import, or Resume / retry.                     |
| `open-workspace`      | Open Workspace in a new tab.                         |
| `open-workspace-here` | Open here only when no import is running.            |
| `open-attention-tab`  | Open the 1688 tab needing user attention.            |
| `resume-import`       | Resume after the user finishes sign-in/verification. |

Reader fallback is automatic: background tab → unfocused window → visible tab. Keep the list open. Only the owned reader is reused/closed; missing tab IDs recover through normal fallback/reopen. Real navigation failures remain errors. Do not turn a browser refusal into an alternate access route. Paused saved queues need explicit Resume/Refresh.

## Workspace: Orders

| `data-action`              | Name / behavior                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `view-orders`              | Show Orders.                                                                                       |
| `view-packing`             | Show the Packing list.                                                                             |
| `choose-order`             | Order reference; `data-order-id` identifies it. Focus and Space selects; links remain independent. |
| `select-all-rows`          | Select the full filtered product scope.                                                            |
| `clear-selection`          | Clear product selection.                                                                           |
| `packing-month`            | Month input, `YYYY-MM`.                                                                            |
| `prepare-packing-list`     | Prepare selected products; new assignments require review.                                         |
| `review-proceed`           | Assign codes and open preparation.                                                                 |
| `review-assign-only`       | Assign codes and remain in Orders.                                                                 |
| `review-cancel`            | Cancel the review without writes.                                                                  |
| `restore-packing`          | Upload a scoped backup outside active preparation.                                                 |
| `open-copy-menu`           | Open more copy formats.                                                                            |
| `open-print-menu`          | Open more print formats.                                                                           |
| `open-activity`            | Progress, history, reports and retry.                                                              |
| `duplicate-import-warning` | Nonblocking matching-workbook notice; no click action.                                             |

Scroll `#order-list` / `.table-scroll` to logical entries. Use `data-order-id` and `data-selection-key`, never current DOM indices or mounted count. Around 100 cards/rows remain mounted; selection and output cover all filtered keys. Focused editors stay available. Hover/context helpers do not select products.

For store files, use the [marker guide](store-spreadsheets.md) and existing upload/review dialog. `duplicate-import-warning` identifies the nonblocking content-match banner: importing again creates another purchase; review date. **Check all** only acknowledges eligible items, never bypasses validation. Close terminates parsing; saves lock dismissal. Original photos/gallery/context and explicit variant allocation remain required.

## Workspace: Packing list

| `data-action`           | Name / behavior                                           |
| ----------------------- | --------------------------------------------------------- |
| `select-all-rows`       | Select the full displayed packing scope.                  |
| `clear-selection`       | Clear packing selection.                                  |
| `open-copy-menu`        | Open copy formats.                                        |
| `open-print-menu`       | Open print formats.                                       |
| `export-packing-list`   | Open workbook scope/columns/layout popup.                 |
| `download-packing-list` | Download Excel; optional detailed JSON only when enabled. |
| `open-grouping-menu`    | Grouping tools with eligibility explanations/review.      |
| `organize-packing`      | Open Organize.                                            |
| `organize-done`         | Flush valid edits and return to normal packing.           |

Export preferences independently remember Products/Cartons columns and common layout. Locate **Include detailed automation JSON** by its checkbox label; stored key `includeAutomationJson` accepts only literal true and starts false. Its help discloses full costs, charge reasons and source identifiers for chosen products/related cartons regardless of Excel columns. Do not infer redaction from visible XLSX fields.

Organize uses `.packing-organize-group[data-group-id]` and `.packing-organize-product[data-variant-id]`. Groups initially mounts no variant tables; Products focuses one group with a visual searchable chooser. Management selection is independent. Use `.reorder-handle`, Up/Down or Move up/down; orders move as blocks, groups within purchase, variants within group. Review removal and use Done/Escape to return. Normal groups/large variants are continuous virtual lists; use logical IDs and scroll, not DOM counts.

**Pcs/box** is an inline source-entry field in both views, including with physical cartons. Enter a positive whole value and commit by Enter/blur; blank means unknown. For 150 pieces at 10, verify 15 calculated cartons without opening a dialog. These edits never alter actual contents/confirmations. Failed/invalid drafts remain available.

`.carton-batch-dialog` uses Exact carton/Batch, Carton number, Actual carton mark and source/photo choices with remaining quantities. Enter complete L/W/H, count, received/loaded and weight basis. Paste a full xyz expression rather than entering calculated volume. New number/mode/mark/contents needs Apply carton contents; saved unchanged-allocation measurements autosave. Reuse measurements copies no counts/contents. See [physical rules](cartons.md) before changing them.

Code resolvers expose `.conflict-owner-card` and `.conflict-edit-card`; scope Product/Variant/Size textboxes to a card. Apply saves all affected orders atomically; Continue editing cancels. `.packing-value-table` uses shared before/arrow/after cells and omits unchanged conflict rows. `aria-invalid` identifies bad endings. Invalid or pending drafts cannot produce valid label previews.

## Settings, photos and workflow

Vocabulary `.vocabulary-scroll` tables retain a shared draft with about 100 mounted rules; search/Tab reveals logical rows. Save reveals errors across sections. There are no data pagers. Settings Tags manages separate order/product catalogs; save waits for pending rename operations.

| `data-action`  | Name / behavior                                                                      |
| -------------- | ------------------------------------------------------------------------------------ |
| `add-size-tag` | Save a recognized source-size annotation; unavailable/duplicate states include help. |

Edit photo labels/dots have keyboard movement and separate tag/pointer scales. Source/barcode values stay intact; Cancel preserves composition. See [photo rules](settings-and-photos.md#product-photos).

`.operations-strip` controls have translated names and `data-operation`. Use labeled Product/Order/Store fields and Save workflow. Linked payments use explicit source/target review and Save reviewed links. Repeat purchase requires eligible target radio card, review checkbox and Use the original codes. Never infer financial or shared-code links from tag text. [Workflow and cost rules](operations.md) preserve source evidence.

Full/packing backup uses `.json.gz` archives and [atomic scope rules](data-and-backups.md). Decode/validate before writes, retain actual mark owners and honor `omittedCartonBatchIds`; job reports and export summaries are different formats.

## Print menu and dialog

| `data-action`              | Name / behavior                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `print-labels`             | Open labels for the selected prepared scope.                                          |
| `print-carton-marks`       | Open carton marks for the selected prepared scope.                                    |
| `print-recent`             | Recent five jobs.                                                                     |
| `export-pdf`               | Save PDF plus summary.                                                                |
| `print-calibration`        | Save calibration PDF without summary.                                                 |
| `close-print-dialog`       | Cancel; abandon an in-progress export.                                                |
| `print-preview`            | Page N preview; zoom/pan changes no export dimensions.                                |
| `apply-print-quantities`   | Apply to all: Multiply/Divide by integer 1–9999; division rounds up, zero stays zero. |
| `increment-print-quantity` | Add N for CODE: five labels or one mark, within 0–9999.                               |

`data-preview-state` is loading/ready/empty/error; `aria-busy` marks rendering. Layout updates need no blur. Dashed safe areas are an unexported overlay. Physical page navigation remains. Unknown/partial carton counts retain the explicit Carton count reviewed for CODE flow; request overrides never change physical records or receipts.

## Status line

Read `#workspace-status[data-status]`; text is for people. Priority is importing, needs-sign-in, export-finished, then idle. `importing` includes progress; `needs-sign-in` requires user attention; `export-finished` supplies a JSON array of actual saved filenames in `data-files`; `idle` means no current job/export since opening or starting another import. The extension does not switch to the attention tab itself. A ready preview alone does not establish a completed download.

## Export files

Browser downloads use local `YYYY-MM-DD-HHMMSS`, with `-2` for same-second repeats. Popup language localizes print prefixes/product words, while format keys remain stable.

| Export           | English example                                                      | Companion                                                   |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Packing workbook | `packing-list-2026-10-23-153012-Habitat.xlsx` or seller-count suffix | Same-stem JSON only if detailed automation JSON is enabled. |
| Labels           | `CE-labels-2026-10-23-153012-3-products.pdf`                         | Same-stem JSON.                                             |
| Carton marks     | `CE-carton-marks-2026-10-23-153012-3-products.pdf`                   | Same-stem JSON.                                             |
| Calibration      | `CE-print-calibration-2026-10-23-153012.pdf`                         | None.                                                       |

Current packing summaries use `format: "1688-export-summary"`, `version: 2`, `kind: "packing-list"`, `exportedAt`, actual `files`, source `orders`, source-line `products`, `cartonBatches`, physical coverage and `totals`. Older summaries without authoritative physical batches use version 1. Full cost evidence includes original/effective amounts, additional/feature/linked costs, reasons and IDs independently of workbook columns. [Workbook scope](exports.md#packing-workbook) keeps complete batches in totals and intersecting shared context outside totals; purchases sharing codes remain separate financial rows.

Label/mark summaries use kind `labels` / `carton-marks`, pages/perPage, orders with orderId/seller and products with code/name/order IDs/requested/extra (labels)/total. Totals include orders, requested and printed. Quantities are JSON numbers or exact decimal strings beyond 2^53. Other-source orders additionally carry source/reference. File/summary format names are backward-compatible and do not follow display branding.

## Typical run

1. Select 1688 orders, invoke import-selected and confirm-import, and inspect completion/attention in Activity. Ask the user to finish sign-in when required.
2. Set packing-month, choose orders/rows, prepare-packing-list and review-proceed after checking the proposal.
3. Open export-packing-list; explicitly choose scope/columns. Leave detailed JSON off unless requested; enable when its full data is appropriate. Use download-packing-list and verify actual files from status.
4. Select packing products, open-print-menu, print-labels/export-pdf; repeat for marks after carton review.
5. Inspect downloaded XLSX/PDF and any requested summaries; back up through the authorized route. Never equate preview readiness with file completion or physical-print acceptance.
