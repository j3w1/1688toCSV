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

Click/Enter inspects an item; native checkboxes select. Source text and IDs remain data, never translated interface strings. Logical keys include account/order/source identity; mounted DOM position does not identify inventory.

| `data-action`                 | Behavior                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `view-orders`                 | Open Orders / named-container Packing.                                                                                 |
| `view-packing`                | Open Orders / named-container Packing.                                                                                 |
| `orders-products`             | Choose the Orders subview.                                                                                             |
| `orders-cartons`              | Choose the Orders subview.                                                                                             |
| `orders-backlog`              | Choose the Orders subview.                                                                                             |
| `choose-order`                | Inspect the order identified by `data-order-id`; use its checkbox to select.                                           |
| `open-order-cartons`          | Open that order's reconciliation session.                                                                              |
| `carton-history`              | Inspect the complete virtual physical-evidence table in All Orders or a narrowed order scope.                          |
| `order-carton-history`        | Show the same retained evidence table for the current reconciliation order.                                            |
| `inspect-carton-history`      | Inspect original/current/retired carton evidence without selecting inventory.                                          |
| `review-purchase-evidence`    | Review original date/supplier facts and explicit inventory dispositions, retaining unfinished input.                   |
| `retry-evidence-refresh`      | Retry the view refresh after committed purchase evidence; never repeat its successful mutation.                        |
| `resolve-purchase-date`       | Save an authored original-date resolution with the observed source revision guard.                                     |
| `resolve-purchase-supplier`   | Save an operator-confirmed supplier identity; source evidence and issued codes remain guarded.                         |
| `save-inventory-disposition`  | Save documented non-goods/fee/payment-only/canceled evidence or an explicit guarded clear.                             |
| `edit-order-barcode`          | Open the existing label editor from an Orders source row.                                                              |
| `edit-order-carton-mark`      | Open the existing carton-mark editor from an Orders source row.                                                        |
| `select-all-rows`             | Select/clear the full filtered product scope.                                                                          |
| `clear-selection`             | Select/clear the full filtered product scope.                                                                          |
| `edit-order-product`          | Open contextual product authoring in Orders.                                                                           |
| `review-purchase-codes`       | Preview / commit purchase-month identities. Review reserves nothing.                                                   |
| `assign-purchase-codes`       | Preview / commit purchase-month identities. Review reserves nothing.                                                   |
| `group-order-products`        | Reviewed grouping in Orders.                                                                                           |
| `undo-order-products`         | Guarded Orders product/grouping history, including reviewed physical consequences.                                     |
| `redo-order-products`         | Reapply the next Orders history step only while captured revisions remain current.                                     |
| `reconciliation-products`     | Product calculations / physical evidence table.                                                                        |
| `reconciliation-cartons`      | Product calculations / physical evidence table.                                                                        |
| `preview-carton-paste`        | Capture and review keyed alignment / stage the complete paste. Invalid cells remain recovery data.                     |
| `apply-carton-paste`          | Capture and review keyed alignment / stage the complete paste. Invalid cells remain recovery data.                     |
| `cancel-carton-paste`         | Cancel local parsing.                                                                                                  |
| `select-grid-rows`            | Select visible logical rows / preview one explicit fill operation.                                                     |
| `fill-grid-range`             | Select visible logical rows / preview one explicit fill operation.                                                     |
| `separate-order-remainder`    | Use the planner's prefilled remainder; no quantity re-entry.                                                           |
| `place-order-remainder`       | Use the planner's prefilled remainder; no quantity re-entry.                                                           |
| `undo-order-cartons`          | One compound paste/fill/assignment per step.                                                                           |
| `redo-order-cartons`          | One compound paste/fill/assignment per step.                                                                           |
| `confirm-order-cartons`       | One order-level physical confirmation with current source/carton revisions.                                            |
| `review-carton-physical-mark` | Review the recorded physical mark beside the current product code in Orders.                                           |
| `review-physical-mark`        | Orders physical-mark dialog with the captured source, batch and amendment guards.                                      |
| `choose-physical-mark-owner`  | Explicit actual eligible owner choice when the previous mark owner is gone; no inferred target.                        |
| `physical-mark-decision`      | One fieldset identified by the actual batch ID.                                                                        |
| `choose-physical-mark`        | Explicit `keep-recorded-mark` or `relabel-reprint` choice.                                                             |
| `physical-mark-reason`        | Retain the operator's reason; composing text cannot confirm a decision.                                                |
| `confirm-physical-relabel`    | Fresh attestation of actual physical relabeling.                                                                       |
| `save-physical-mark-decision` | Guarded saved-mark resolution; no quantity, price or measurement re-entry.                                             |
| `retry-physical-mark-refresh` | Read-only refresh after a committed mark decision.                                                                     |
| `print-order-carton-mark`     | Existing A4 PDF pipeline; `data-mark-role` is `recorded` or `current-product`, guarded by captured source/batch/epoch. |
| `restore-packing`             | Review a historical scoped archive; return to Orders without reopening the retired preparation screen.                 |
| `open-copy-menu`              | Existing selected-source copy/print tools.                                                                             |
| `open-print-menu`             | Existing selected-source copy/print tools.                                                                             |
| `open-activity`               | Existing progress/history/report/retry drawer.                                                                         |
| `duplicate-import-warning`    | Nonblocking supplier workbook content-match notice.                                                                    |

Scroll `#order-list`, `.table-scroll` and `.smart-grid-scroll` to logical rows. About 100 ordinary rows remain mounted, with focused/dirty cells retained. Selection/totals cover the logical scope. A one-column paste captures selected **visible** keys in displayed order; rectangles prefer code matching inside one purchase. Unknown/duplicate codes, derived columns or stale generation/filter/sort/scope reject the whole operation while keeping raw cells. Never retarget a stale preview to a new DOM row.

For supplier purchases, retain the [marker guide](store-spreadsheets.md) and existing import review. Check all acknowledges eligible items and never bypasses financial/photo/structural validation. Report intake into an existing 1688 purchase is separate; it does not change China markers or create another purchase.

## Workspace: Packing list

| `data-action`                   | Behavior                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `choose-container`              | Select a named container / immutable historical revision.                                                  |
| `choose-container-revision`     | Select a named container / immutable historical revision.                                                  |
| `container-view`                | `data-view` selects `loading`, `packing-list` or `left-behind`.                                            |
| `create-container`              | Create a named draft; its name does not establish a code month.                                            |
| `include-container-orders`      | Reserve complete selected orders' eligible remainder, without loading cartons.                             |
| `confirm-container-orders`      | Reserve complete selected orders' eligible remainder, without loading cartons.                             |
| `expand-container-order`        | Expand/collapse physical references in Loading.                                                            |
| `remove-container-order`        | Release only that draft's order/draft reservations.                                                        |
| `cancel-container`              | Release only that draft's order/draft reservations.                                                        |
| `mark-all-loaded`               | Load the entire included logical scope, regardless of display filters.                                     |
| `set-carton-loading`            | Set one physical reference's `data-state`: loaded, left-behind or unconfirmed.                             |
| `mark-cartons-loaded`           | Apply one decision to explicitly selected actual references.                                               |
| `mark-cartons-left-behind`      | Apply one decision to explicitly selected actual references.                                               |
| `mark-cartons-unconfirmed`      | Apply one decision to explicitly selected actual references.                                               |
| `undo-container-loading`        | Revision-checked loading history.                                                                          |
| `redo-container-loading`        | Revision-checked loading history.                                                                          |
| `review-container-availability` | Explicit before/after refresh of reserved evidence; never silent inclusion.                                |
| `apply-container-availability`  | Explicit before/after refresh of reserved evidence; never silent inclusion.                                |
| `review-container-seal`         | Review readiness and commit the complete frozen revision with its review token.                            |
| `discard-loading-count-drafts`  | Explicitly keep saved loading decisions and discard retained raw count edits for this container/amendment. |
| `seal-container`                | Review readiness and commit the complete frozen revision with its review token.                            |
| `amend-container`               | Draft a reasoned correction / preserve the prior effective revision.                                       |
| `cancel-container-amendment`    | Draft a reasoned correction / preserve the prior effective revision.                                       |
| `edit-in-orders`                | Edit in Orders with retained container/revision return route.                                              |
| `return-to-container`           | Edit in Orders with retained container/revision return route.                                              |
| `export-packing-list`           | Configure / download the complete revision. Product selection/filtering cannot reduce it.                  |
| `download-packing-list`         | Configure / download the complete revision. Product selection/filtering cannot reduce it.                  |

Packing product/carton/photo views are read-only except loading/amendment. Interchangeable-count input appears only when the domain explicitly permits it; it must never select arbitrary differently measured boxes. Se quedó is that container's historical remainder, while Backlog is current global inventory.

Retired public actions are `packing-month`, `prepare-packing-list`, `review-proceed`, `review-assign-only`, Packing `open-grouping-menu`, `organize-packing` and `organize-done`. There is no per-carton Exact/Batch/Pack together/Apply loop or product-removal route in Packing. Existing legacy readers remain for evidence and archive compatibility.

Export preferences retain advanced columns/layout. Default sheets are Packing list, Cartons and Se quedó. **Include detailed automation JSON** starts false for each export and requires a deliberate checkbox choice. It contains full costs, charge reasons and source identifiers for the complete revision regardless of visible Excel columns. Display choices do not redact JSON. Draft exports are labelled; amended/history output identifies its revision and uses snapshot prices/names/photos.

## Order report intake and exceptional cartons

`retry-evidence-refresh` refreshes the Orders view after a purchase-evidence mutation committed but its subsequent read failed. It never repeats the already committed mutation.

| `data-action`                    | Behavior                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inspect-order-carton`           | Read the selected stable carton and stage exceptional measurements/contents in the same order draft.                                                                                                         |
| `choose-carton-entitlement`      | Choose a retained physical unit for an exceptional correction; known facts are prefilled and unknown aggregate contents stay unknown. Closing stages the correction; the one order confirmation persists it. |
| `move-order-carton-contents`     | Move prefilled pieces atomically between supported same-order destinations.                                                                                                                                  |
| `accept-carton-suggestion`       | Explicitly confirm one suggested actual arrangement.                                                                                                                                                         |
| `reject-carton-suggestion`       | Restore the same unassigned pool by rejecting that suggestion.                                                                                                                                               |
| `paste-import-carton-list`       | Open separate packing-report intake inside an existing 1688 purchase.                                                                                                                                        |
| `review-recovered-carton-draft`  | Review a retained older amendment draft against the current order before deliberately recovering its raw cells and physical proposals; old delayed writes keep their original epoch.                         |
| `review-recovered-carton-report` | Review exact retained report source and scoped decisions from a canceled amendment before starting a fresh report review in the current epoch.                                                               |
| `packing-report-intake`          | Marker on the source/review dialog.                                                                                                                                                                          |
| `review-carton-report`           | Persist original TSV/workbook source locally, then parse/analyze with cancellation.                                                                                                                          |
| `report-review-decision`         | Scoped meaning decision identified by `data-decision-id`; source cell/heading remains visible.                                                                                                               |
| `update-carton-report-review`    | Reanalyze scoped decisions and review added/changed/removed/unchanged evidence.                                                                                                                              |
| `commit-carton-report`           | Commit a ready reviewed payload atomically; identical reports remain unchanged.                                                                                                                              |

Report originals are saved before worker transfer. Changed source text/file cancels older parsing; recovery retains source references and unresolved decisions. Formula caches, zeros in identifiers, per-carton/combined bases and unknown contents remain evidence. Unknown aliases can remain unresolved; optional complete-set coverage requires actual confirmed product totals, never purchase-total equality. Historically used corrections route to container amendment. There is no source-quantity rewrite or marker-parser fallback.

`resolve-legacy-carton` requires a reason and explicit attestation before releasing an uncertain loading hold. A reviewed owner correction selects one actual purchase and supported whole-set contents. Retirement requires confirmation that physical repacking already happened, retains the original tombstoned evidence and opens normal order reconciliation; it never generates replacement cartons. Original identities, counts, measurements, contents and history remain evidence. Historical shipment dependencies require amendment.

| `data-action`                      | Reviewed legacy recovery                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `review-legacy-carton`             | Load authoritative old carton facts and every affected purchase revision for review.                                                        |
| `legacy-carton-review`             | Marker on explicit owner correction/repack retirement review; it never creates replacement cartons.                                         |
| `review-legacy-supplier-identity`  | Compare issued owner/codes with canonical supplier identity.                                                                                |
| `confirm-legacy-supplier-identity` | Explicit equivalence attestation with a required operator reason and current revision guards; consumed identities require active amendment. |

## Shared output and retained evidence controls

| `data-action`              | Behavior                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `copy-values`              | Copy the captured source/revision rows as values.                                                                                              |
| `copy-container-columns`   | Choose columns from captured immutable revision rows; explicit Copy writes the clipboard.                                                      |
| `copy-group-codes`         | Copy unique base codes in captured source/revision order with completion feedback.                                                             |
| `copy-container-images`    | Open the proven source-photo copy dialog using captured revision photos.                                                                       |
| `copy-container-cells`     | Copy the captured revision's source cells and photos through the existing dialog.                                                              |
| `copy-container-barcodes`  | Preview/copy read-only barcode artwork from captured revision settings.                                                                        |
| `copy-container-marks`     | Preview/copy read-only physical carton marks from captured revision settings.                                                                  |
| `backup-packing`           | Back up the captured Orders source/preparation scope, original media and supported evidence; explicitly review omitted partial carton records. |
| `copy-excel-image`         | Prepare an Excel-image preview; explicit Copy writes the clipboard.                                                                            |
| `resolve-legacy-carton`    | Confirm a documented single-order legacy not-shipped review with the retained batch revision.                                                  |
| `purchase-code-review`     | Marker on the purchase-code review dialog, not a mutation.                                                                                     |
| `inspect-container-order`  | Filter/inspect included order context without changing membership.                                                                             |
| `review-saved`             | Explicitly discard a stale recovered authoring draft and retain the newer saved version.                                                       |
| `confirm-container-action` | Confirm draft cancellation/release after its review.                                                                                           |
| `review-cancel`            | Cancel a generic grouping/restore/source review without writes.                                                                                |
| `review-proceed`           | Confirm that generic review; it never starts the retired Preparation workflow.                                                                 |
| `organize-done`            | Retained inactive legacy component name; no active Orders/Packing route or shortcut mounts it.                                                 |

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

Pending size mappings expose visible `[data-issue-code="SIZE_MAPPING_REQUIRED"]` notices in Orders and Backlog. Review uses `PURCHASE_SIZE_REQUIRED` as a warning: a base product identity can be assigned while its variant barcode stays blank. Use the existing Orders size controls to resolve it; barcode copy and print refuse pending variants. Source rows, prices and quantities stay available.

## Export files

Browser downloads use local `YYYY-MM-DD-HHMMSS`, with `-2` for same-second repeats. Popup language localizes print prefixes/product words, while format keys remain stable.

| Export           | English example                                                      | Companion                                                   |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Packing workbook | `packing-list-2026-10-23-153012-Habitat.xlsx` or seller-count suffix | Same-stem JSON only if detailed automation JSON is enabled. |
| Labels           | `CE-labels-2026-10-23-153012-3-products.pdf`                         | Same-stem JSON.                                             |
| Carton marks     | `CE-carton-marks-2026-10-23-153012-3-products.pdf`                   | Same-stem JSON.                                             |
| Calibration      | `CE-print-calibration-2026-10-23-153012.pdf`                         | None.                                                       |

Packing summaries use `1688-export-summary` version 3 with `scope: "container-revision"`. They name the actual workbook/JSON files and identify the container and immutable revision, complete loaded logical membership, source-line costs and physical coverage. Se quedó uses that revision’s frozen included-order remainder; later purchases and shipments cannot rewrite it. Historical version 1/2 summary files remain readable evidence. A summary is not a restorable backup. Full cost evidence includes original/effective amounts, additional/feature/linked costs, reasons and IDs independently of workbook columns. [Workbook scope](exports.md#packing-workbook) follows the full loaded revision regardless of UI selection/filter; distinct physical cartons count once and purchases sharing codes remain separate financial rows. Detailed JSON is off for every newly opened export and includes full costs, reasons and identifiers independently of chosen workbook columns.

Label/mark summaries use kind `labels` / `carton-marks`, pages/perPage, orders with orderId/seller and products with code/name/order IDs/requested/extra (labels)/total. Totals include orders, requested and printed. Quantities are JSON numbers or exact decimal strings beyond 2^53. Other-source orders additionally carry source/reference. File/summary format names are backward-compatible and do not follow display branding.

## Typical run

1. Import selected purchases and inspect completion/attention in Activity. Sign-in remains user-owned.
2. In Orders review purchase-month codes, edit products, then reconcile an order's capacities/report facts. Preview paste alignment; confirm the physical arrangement once.
3. Create/choose a container, include whole orders from Backlog and make loading decisions. Review availability explicitly if evidence changed.
4. Review & seal. Export the complete revision regardless of display selection. Detailed JSON stays off unless requested. Check actual filenames in status.
5. Inspect XLSX/PDF and requested summaries. Back up through the authorized route. Preview readiness does not prove a completed file, native Excel or physical-print acceptance.
