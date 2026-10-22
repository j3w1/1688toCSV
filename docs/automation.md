# Operating 1688toCSV with an automation agent

An agent can import orders, prepare a packing list, export it and print labels and carton marks for the owner without hover, drag or timing tricks. Every control below carries a stable `data-action` attribute that does not change with redesigns; its accessible name is listed too, in English (it follows the workspace language). Prefer `data-action` selectors.

Popup language toggles are local to that popup and its exports. They do not change workspace language or another open popup; nested previews inherit their opener's language. Use the popup's own `lang` attribute and stable action selectors when switching its language. Assignment confirmation shows complete before → after comparisons directly for small reviews, a detailed grid when it fits, and a fitted all-group overview for large batches. It has no pager: activate any card for its complete comparison, use arrows between cards and Escape to close the comparison. Other change reviews use continuous comparison lists.

Use synthetic or the owner's own data only as the owner directs; this guide describes behaviour, not data.

## Controls

### Orders from other sources

In the workspace, `add-other-order` opens the entry dialog. Enter supplier, reference and date, add rows, then save. Alternatively set the `other-order-file` input through the browser file-upload mechanism with one JSON file from the shared folder. Import fills the dialog for review; it does not save automatically. Save uses the same complete-order validation for both paths. Do not request arbitrary host paths or a new business API.

| `data-action`                | Accessible name   | Does                                                 |
| ---------------------------- | ----------------- | ---------------------------------------------------- |
| `add-other-order`            | Add order         | Opens a new order draft.                             |
| `other-order-import-json`    | Import order JSON | Opens the JSON file picker.                          |
| `other-order-file`           | Hidden file input | Accepts the chosen JSON file through browser upload. |
| `other-order-add-product`    | Add product       | Adds an empty product row.                           |
| `other-order-remove-product` | Remove product    | Removes its draft row; at least one remains.         |
| `other-order-clear-photo`    | Remove photo      | Clears its draft photo.                              |
| `other-order-save`           | Save order        | Validates and atomically creates the complete order. |
| `other-order-cancel`         | Cancel            | Discards the unsaved draft.                          |

Stable field actions are `other-order-supplier`, `other-order-reference`, `other-order-date`, and, inside each product fieldset, `other-order-description`, `other-order-specs`, `other-order-quantity`, `other-order-unit-price` and `other-order-photo`. Their associated labels supply accessible names in the chosen language. The dialog's alert explains errors in the chosen language and carries the stable machine path in `data-field` (for example, `products.1.quantity`). If that field exists in the current draft, its input carries `aria-invalid=true`. The draft stays intact; no product or partial order is saved on validation/duplicate failure. After saving, the workspace selects the new order and its purchase month.

One JSON document creates one order:

```json
{
  "format": "1688-order-entry",
  "version": 1,
  "supplier": "Synthetic supplier",
  "reference": "EXT-DEMO-1",
  "date": "2026-10-15",
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

Supplier/reference: nonempty single-line text, at most 160 characters each. Date: a real `YYYY-MM-DD` date. Include 1–200 products; each description is nonempty and each description/specs field is at most 2,000 characters. Quantities are **strings** of 1–12 digits representing positive whole numbers. CNY unit prices are nonnegative exact decimal **strings**, at most 18 integer digits and 6 decimal places. The existing calculation rounds each product-row amount once to cents. Unknown fields, versions, invalid dates and malformed values are refused.

An optional product `photo` is an inline `data:image/png;base64,...`, JPEG, WebP or GIF image, limited to 2,000,000 characters; remote image URLs are not accepted. It must decode as an image with each side at most 8,192 pixels and at most 16,777,216 pixels in total. The manual photo picker accepts files smaller than 1.4 MB. The JSON file is limited to 8 MB. File import and manual input have identical validation and duplicate-supplier/reference checks, ignoring case, surrounding whitespace and Unicode compatibility differences. A duplicate is refused rather than overwriting an existing order. Backup restore checks the final reconciled library for duplicates and refuses the entire restore if a collision would result.

These snapshots carry `source: "other"`, a separate human `reference` and an application-generated internal decimal ID. They have no 1688 member login, shop or source URL. Existing imported orders retain their source evidence; ambiguous legacy origins are not guessed or rewritten. Packing/print summaries preserve the internal `orderId` and additionally include `source: "other"` and `reference` for such orders. Copied/exported order-number cells display the human reference. Full and packing backups preserve source and reference along with products and optional photos. A manual order does not imply payment/shipping status or a supplier account.

### 1688 order list (floating toolbar)

| `data-action`         | Accessible name                        | Does                                                                         |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `import-selected`     | Import selected                        | Imports the orders ticked on the current list page (asks to confirm).        |
| `import-all`          | Import all matching…                   | Imports every order matching the current filters (asks to confirm).          |
| `confirm-import`      | Import _n_ selected orders, or similar | Confirms the pending import. The name includes the count; use the attribute. |
| `cancel-import`       | Cancel                                 | Cancels the pending confirmation.                                            |
| `pause-import`        | Pause import, or Resume / retry        | Pauses or resumes the import that started on this list.                      |
| `open-workspace`      | Open Workspace                         | Opens the workspace in a new tab.                                            |
| `open-workspace-here` | Open Workspace here                    | Opens the workspace in this tab when no import is running.                   |

Imports try a background tab, then a separate unfocused window, then a visible reader automatically if the browser requires it. No visible-tab permission prompt is shown. The same marked reader is reused and closed after import; unrelated tabs are preserved. Keep the list page open until the import finishes. Sign-in and verification still require a person.

### Workspace: Orders

| `data-action`          | Accessible name                       | Does                                                                                                                                                                        |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view-orders`          | Orders                                | Shows the Orders view.                                                                                                                                                      |
| `view-packing`         | Packing list                          | Opens the packing list of the chosen packing month.                                                                                                                         |
| `choose-order`         | Order _number_                        | One per listed order, with `data-order-id`. Focus it and press Space to choose it (click its meta line, not its links). Choosing orders narrows the products table to them. |
| `select-all-rows`      | Select all rows                       | Selects every filtered product, including unmounted rows.                                                                                                                   |
| `clear-selection`      | Clear selection                       | Clears the product selection.                                                                                                                                               |
| `packing-month`        | Packing month                         | The month input (`YYYY-MM`) for the packing list.                                                                                                                           |
| `prepare-packing-list` | Prepare packing list                  | Prepares the selected products; new products first show a review.                                                                                                           |
| `review-proceed`       | Assign codes and prepare (or similar) | Confirms the review and opens the packing list.                                                                                                                             |
| `review-assign-only`   | Assign only                           | Saves the codes and stays in Orders.                                                                                                                                        |
| `review-cancel`        | Cancel                                | Leaves everything unchanged.                                                                                                                                                |
| `restore-packing`      | Restore packing                       | Opens a packing backup file.                                                                                                                                                |
| `open-copy-menu`       | More copy formats                     | Opens the Copy menu.                                                                                                                                                        |
| `open-print-menu`      | More print formats                    | Opens the Print menu.                                                                                                                                                       |
| `open-activity`        | Activity                              | Opens import progress and history.                                                                                                                                          |

Orders and Products have no page controls. Scroll `#order-list` or `.table-scroll`, or use keyboard navigation, to reach every filtered entry. Around 100 cards or rows are mounted in each window. Locate orders by `data-order-id` and products by `data-selection-key` rather than their current DOM index. Month headings remain part of the continuous Orders list. Hover/focus helpers show item photos, codes, quantities, amounts and saved notes; they do not select an item.

Mouse-opened helpers follow the pointer; keyboard help stays beside the focused control. Trailing ellipsis menus use compact 24px controls. Prefer accessible names or stable actions over hover coordinates. Refresh verifies that a newly returned reader-tab ID exists; a phantom or missing ID uses the next supported reader mode or normal reopen recovery. Sign-in, user navigation and genuine browser failures remain actionable instead of being treated as successful reads.

### Workspace: Packing list

| `data-action`           | Accessible name     | Does                                                                               |
| ----------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `select-all-rows`       | Select all          | Selects every product in the open packing list.                                    |
| `clear-selection`       | Clear selection     | Clears the selection.                                                              |
| `open-copy-menu`        | More copy formats   | Opens the Copy menu.                                                               |
| `export-packing-list`   | Export packing list | Opens persistent column, scope and layout choices from the bottom packing toolbar. |
| `download-packing-list` | Download Excel      | In the export popup: saves the configured editable XLSX and matching JSON summary. |
| `open-print-menu`       | More print formats  | Opens the Print menu.                                                              |
| `open-grouping-menu`    | Grouping tools      | Opens the grouping menu.                                                           |
| `organize-packing`      | Organize            | Opens the separate group/product organization view.                                |
| `organize-done`         | Done                | Flushes valid edits and restores normal packing with its selection and scroll.     |

The packing export popup remembers separate **Products / Cartons** column selections/order and common scope/layout choices. Its language affects only the popup and exports. Product columns have 14 available keys and 13 defaults, beginning Photo, Code, Carton mark; Cartons has 16 columns for physical contents/counts/dimensions/weight/volume. Restoring defaults preserves scope/layout choices. Existing custom physical columns migrate to Cartons. Preview remains bounded; download includes the full logical chosen scope. Excel and Excel-image surfaces always use the selected theme's light palette.

Normal packing has no grips/trash buttons or action gutters. Click **Organize** to expose structural controls. `.packing-organize-group` cards contain `data-group-id`; `.packing-organize-product` rows contain `data-variant-id`. The initial Groups projection does not mount variant tables. Products shows one chosen group, reached through its **Products** action or the searchable **Choose group** visual picker. Management checkboxes and Ctrl+A/Ctrl+D affect the management selection only; the previous export selection remains intact. Use dedicated `.reorder-handle` controls, ArrowUp/ArrowDown, or **Move up / Move down**. Whole orders move together, groups stay within their source purchase and products within their group. **Remove from packing** opens one review for selected rows and affected batches; confirmation saves atomically and supports one Undo. **Done** or Escape returns to normal packing. Large organizing lists retain about 100 mounted cards; DOM count is not logical scope.

Both Orders Products and Packing keep **Pcs/box** editable beside quantity, including prepared products with physical batches. Scope the textbox to its source product, enter a positive whole number and commit with Enter or blur; valid edits autosave and their calculated summary updates immediately. For 150 pieces enter 10 to display 15 calculated cartons; 155 at 10 retains 15 full cartons plus 5 loose pieces. No carton dialog, **Separate variants** or Apply action is needed for ordinary planning. Blank capacity remains unknown. A separate **Recorded cartons** action shows actual physical count/status and opens its editor; never treat the calculated count as a received/loaded confirmation. Editing capacity does not create or change physical batches or product receipts.

Prepared groups also expose **Cartons** and a compact physical summary. `.carton-batch-dialog` offers **Exact carton / Batch**, **Carton number** and **Actual carton mark**, followed by source-photo/code choices with purchase identity/remaining quantity. Exact carton fixes count at one; Batch records combined contents. **Pack together**, **Separate variants**, **Use all remaining** and **Reuse measurements** fill physical-content proposals. Short **Length / Width / Height**, **Cartons**, **Received boxes**, **Loaded boxes** and **Weight** controls retain visible labels; select **Per carton / Batch total** as appropriate. Paste a complete xyz expression into a dimension control; do not automate manual m³ entry. New contents, number, mode or mark require **Apply carton contents**; valid measurements on a saved unchanged allocation autosave. Incomplete/invalid entries remain drafts and failures preserve them. Reuse changes measurements only. Product-description sizes never supply carton dimensions.

Carton marks use group codes and source labels retain full variant codes. Contents can span groups within one purchase/account/store/month. Foreign purchase groups require explicit repeat-product links in that scope; matching text alone is insufficient. The physical mark is chosen independently and may contribute zero pieces. Record actual contents for each numbered carton or combined contents in Batch. For S3/M30/L30, six exact cartons may contain 13/12/11/9/9/9 pieces; references retain their actual distribution. Never infer 10.5 pieces/box or a uniform capacity from divisibility. Mixed contents use **Shared**; uneven exact single-product cartons use **Varies**. Source quantities/costs remain separate. Blank counts are unknown, zero confirms none, and independent received/loaded counts do not change product-piece receipts. Per-carton kg can multiply a confirmed count; partial batch-total weight remains unknown. Legacy/supplier volume is read-only until complete dimensions supersede it. Changed source quantities/context retain batches for review.

The pre-v4 database upgrade and older-backup conversion preserve historical carton defaults. In v4, capacity-only or measurement-only edits save as defaults, independently of physical allocation. Immediate capacity planning requires no Apply; only explicit physical-content changes do. Opening lists or exporting must not create physical contents from defaults. Runtime seeding preserves explicit supplier/local box counts and carton confirmations without deriving saved physical counts from capacity. Existing saved batches and original source orders remain intact.

Packing variants have no page controls. Large groups use a continuous `.variant-scroll` with about 100 mounted rows; find logical products by `data-variant-id`. Selection, code/issue reveal and keyboard ranges cover all variants, including unmounted rows. Active editors, dirty numeric drafts and reorder sources remain available during scrolling.

### Settings rule tables

Product names, Size codes, Product colors and Materials use searchable continuous `.vocabulary-scroll` tables. Small lists show every rule; large lists keep about 100 rows mounted, with an additional focused row when needed. Never use the DOM row count as the full rule count. Search or scroll to an entry; Tab/Shift+Tab reaches neighboring logical rules beyond the mounted window. Add/remove/search preserves the shared draft, and **Save settings** reveals and focuses validation errors even after switching sections. The Tags review action stays clear of Close. There are no workspace data pagers; physical print-page and photo navigation remain available.

### Product photo viewer

| `data-action`  | Accessible name       | Does                                                                                                          |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `add-size-tag` | Add size tag · _size_ | Saves the recognized source size on the current photo; disabled with help when unavailable or already tagged. |

### Store spreadsheet format guide

**Import spreadsheet** opens a local workbook review. Select `.xlsx` or `.xls`, choose a sheet, enter a purchase date and confirm the store name. Review every highlighted source-cell issue, shared photo and combined-variant allocation. Only a valid, explicitly reviewed order can be saved; successful import refreshes Products immediately. Closing during file parsing terminates its worker, while a database save locks dismissal. Every import creates a new order. Spreadsheet orders have no 1688 source link or refresh action. **Settings → Data → Store spreadsheet guide** opens the same keyboard-operated, copyable format documentation without starting an import or changing the Settings draft.

The canonical markers are `pic`, `desc`, `boxes`, `perbox`, `qty`, `price`, `amount`, `group`, `var`, `kg`, `cbm`, `cbmx`, `cbmy`, `cbmz` and `total`. `amount` checks a source row; exactly two `total` markers surround the whole-order control. Unknown columns are ignored. Failed formulas, missing cached results, inconsistent arithmetic and missing or unreadable pictures block saving. A photo anchored across multiple included rows or their merged `pic` cell is reused across all covered groups after shared-photo review; uncovered rows are never filled by proximity or group membership. Use actual quantities to split combined variants; source cartons stay shared. Workbook kg/cbm markers describe one carton. After preparation, **Cartons** records physical batches with an explicit weight basis; **Additional charges** reviews order-wide cost increases without replacing original prices. Photo viewers retain all original pictures and save square compositions separately.

The **Download template** icon beside Purchase date provides the blank Orders / Guide workbook. The Setup / Markers / Checks sidebar explains filenames and the format without leaving review. **Check all** acknowledges eligible warnings only; it does not bypass validation or allocate variants. In **Edit photo**, A–E and size buttons compose variant tags (including mixed codes) without a dropdown. Clicking a product starts its label in the nearest corner; **Tag size** scales every tag in that one photo together (60%–600%). **Pointer size** separately scales all pointing circles, preserving labels, leaders and positions. Both sliders use fixed percentage stops; accessible value text reports the percentage, not the internal slider index. Save commits the composition; Cancel preserves the previous version. The photo viewer's `add-size-tag` action (**Add size tag · {size}**) immediately saves a recognized source-size annotation with its label bottom-right and point at 75% across/50% down, retaining existing tags and composition. With no size its disabled **Add size tag** button has a focusable hover/help wrapper explaining the missing recognition. Duplicate size annotations are disabled. Edit photo can subsequently move, rename or remove the new annotation. Read the [China-store developer contract](development.md#china-store-spreadsheets) before automating store identity, shared cartons or photo persistence. Physical contents are recorded explicitly with their actual mark in numbered cartons or aggregate batches; print-request overrides do not change those contents or product receipts.

### Tags and backups

**Settings → Appearance** offers Classic brown in both palette selectors. Save the shared draft to apply; native Excel and Excel images use that selected theme’s light version in either workspace mode. Existing selections are not automatically changed.

**Settings → Tags** manages the Order tags and Product tags catalogs. Appearance handles theme/workspace colors; its explicit all-label/tag reset also refreshes tag colors in Tags. Switching sections or languages preserves the shared draft; Save waits for pending tag operations. **Review operational tags** previews selected, confirmed conversions into store/order/product workflow fields; unresolved tags and original wording remain. Read the [workflow contract](development.md#operational-workflow) before automating it.

Small `.operations-strip` buttons have translated accessible names and `data-operation` values. Their native **Operations workflow** dialog separates Product, Order and Store; use labeled fields and **Save workflow**. Status edits do not prepare products or rewrite the source supplier status. **Linked payments** in store details opens an explicit review: select an existing source, optional fee row, amount/reason and receiving scope, confirm, then **Save reviewed links**. The chain control on assigned products opens a repeat-purchase review. When one new variant matches an original multi-size group, choose its original target radio card before confirming the review checkbox and **Use the original codes**. Store/account/month and variant/size/feature compatibility still apply; other original variants remain unchanged. Never infer financial links or shared code identity from a tag alone.

Full-library **Back up** and **Back up packing** use the existing lossless image-dictionary `.json.gz` transport. Inner library backups are version 4, including `cartonBatches`; versions 1–3 and legacy plain JSON remain supported. Full restore stays in Settings Data and packing restore in Orders. Decode/validate the complete input before any write. Scoped backups require every content item, the packing month and the actual carton-mark group; `omittedCartonBatchIds` reports intersecting exclusions, including a missing zero-piece mark owner. Full backups preserve that independent mark context. Batch tombstones/provenance prevent old files or refresh from recreating removals; newer batch state is preserved independently. Import reports and export summaries are not these archives.

### Print menu and dialog (both views)

Orders Products and Packing retain the compact autosaved **Pcs/box** default beside Quantity, with calculated cartons or full/loose pieces below it. The chosen-columns key stays `unitsPerCarton`. Recorded physical counts/status remain separate, and shared product measurement readouts retain their physical references. Carton-mark printing aggregates complete unique records by their actual mark, including a mark owner contributing no pieces and linked purchases sharing one code. Recent print references retain `cartonBatchIds`. Unknown counts, partial coverage or unresolved packing retain the explicit **Carton count reviewed for CODE** flow; editing print counts changes requested artwork only, not physical contents or confirmations.

Known capacities display `/box` in English, `/ctn` in Spanish or `/箱` in Chinese; unknown values have no suffix. Copying keeps the numeric value. Edit directly in the current Orders or Packing source-entry field; no cross-view navigation is required. Shared barcode rows retain individual source-purchase capacities and calculations. Pending or invalid edits remain available through virtual scrolling, and failed saves retain the field draft rather than discarding it.

Code-conflict dialogs expose `.conflict-owner-card` and `.conflict-edit-card`; scope **Product code**, **Variant code** and **Size code** textbox locators to the relevant card. Both cards can edit assignments, including same-group suffixes. Shared base fields synchronize in the proposal. **Apply corrections** saves all changed orders atomically; **Continue editing** cancels popup edits. Comparison tables use `.packing-value-table` with one shared header, `.packing-value-before`, `.packing-value-arrow` and `.packing-value-after`; conflict comparisons hide unchanged rows. Swapped variant/size inputs expose `aria-invalid` only on the affected field, preserve saved assignments, and hide invalid label previews. Storage regressions exercise both preview/save and custom/legacy suffixes.

The compact checkmark button retains the accessible name **Apply to all** and the `apply-print-quantities` action. Paper and layout inputs update without blur. The print canvas exposes `data-preview-state` as `loading`, `ready`, `empty` or `error`; `aria-busy` is present while it renders. Dashed safe-area outlines are a separate SVG overlay and are not part of exported artwork. Fitted viewers disable horizontal scrolling; zoomed viewers keep native scrolling and panning. Previous/next print controls navigate physical output pages and remain available.

Each requested-quantity field also has an `increment-print-quantity` button named **Add N to requested quantity for CODE**. It adds five for labels or one for carton marks, treats an empty field as zero, and refuses invalid values or results above 9999. It never changes another row or exports a file.

| `data-action`              | Accessible name                      | Does                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `print-labels`             | Print labels…                        | Opens the label dialog for the selected products.                                                                                                                                                                         |
| `print-carton-marks`       | Print carton marks…                  | Opens the carton-mark dialog for the selected products.                                                                                                                                                                   |
| `print-recent`             | Recent print jobs…                   | Lists the five most recent exports to regenerate.                                                                                                                                                                         |
| `export-pdf`               | Export PDF                           | Saves the PDF and its summary.                                                                                                                                                                                            |
| `print-calibration`        | Calibration sheet                    | Saves a one-page calibration PDF (no summary).                                                                                                                                                                            |
| `close-print-dialog`       | Cancel                               | Closes the dialog; an export in progress is abandoned.                                                                                                                                                                    |
| `print-preview`            | Page N preview                       | Preview only: scroll or +/− to zoom, drag or arrows to pan, 0 to fit. Exported dimensions do not change.                                                                                                                  |
| `apply-print-quantities`   | Apply to all                         | Both print dialogs: applies Operation (Multiply/Divide) and Factor to every requested quantity, rounding division up. Preview totals update before Apply; values stay within 0–9999 and source packing data is unchanged. |
| `increment-print-quantity` | Add N to requested quantity for CODE | Adds five for labels or one for carton marks and refreshes the preview. Disabled for invalid counts or when the result would exceed 9999.                                                                                 |

### Import notices

| `data-action`        | Accessible name   | Does                                                                                      |
| -------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `open-attention-tab` | Open the 1688 tab | Brings the tab that needs a sign-in or verification forward. A person finishes that step. |
| `resume-import`      | Resume import     | Resumes the paused import.                                                                |

## Status line

`#workspace-status` in the workspace header shows one state at a time, most urgent first. Read its `data-status` attribute; the text is for people.

| `data-status`     | Means                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `importing`       | An import is running. The text includes its progress.                                                         |
| `needs-sign-in`   | An import paused because 1688 asked for a sign-in or verification. Use `open-attention-tab` and ask a person. |
| `export-finished` | The latest export finished. `data-files` is a JSON array of the file names.                                   |
| `idle`            | Nothing is running and nothing was exported since the workspace opened or the last import started.            |

The sign-in need is shown once; the extension never switches tabs by itself.

## Export files

Files download through the browser's normal download folder. Names are predictable and carry the local date and time (`YYYY-MM-DD-HHMMSS`), so every export has its own files and the browser never renames one; a second export within the same second gets `-2`. The status line and the summary always name the files actually saved:

| Export       | File                                                                            | Summary            |
| ------------ | ------------------------------------------------------------------------------- | ------------------ |
| Packing list | `packing-list-2026-10-19-153012-<seller>.xlsx`, or `…-<n>-sellers.xlsx`         | same name, `.json` |
| Labels       | `CE-labels-2026-10-19-153012-<n>-products.pdf` (`-1-product.pdf` for one)       | same name, `.json` |
| Carton marks | `CE-carton-marks-2026-10-19-153012-<n>-products.pdf` (`-1-product.pdf` for one) | same name, `.json` |
| Calibration  | `CE-print-calibration-2026-10-19-153012.pdf`                                    | none               |

The packing workbook has localized **Products** and **Cartons** worksheets. Products preserves separate source purchase lines, quantities and financial values; its default fields include photo, full code, actual mark, description, size, quantity/capacity, carton references and cost. Numeric capacity requires complete identical exact single-content cartons, or an explicit saved capacity agreeing with all single-product aggregate contents/counts and full source quantity: 150 pieces in 15 cartons with saved Pcs/box 10 exports numeric 10. Divisibility alone is insufficient. No-batch rows retain the saved default; **Shared / Varies / Batch** explain mixed, uneven exact or unspecified/contradictory aggregate contents, while incomplete identical exact allocations leave capacity blank and review records retain review status. Cartons has one row per numbered carton or aggregate batch, full product/purchase contents, counts, xyz dimensions, weight basis and weight/volume formulas. Product references link to those rows and identify differing marks; contents link back to product data. Photos fill square cells, code artwork retains its 16px standard/underline and marks use the existing renderer. Numeric units remain formats; source 1688 Details uses 10pt left-aligned text, while China descriptions are centered.

Order bands contain store identity, selected purchase quantity, freight and goods amount. Physical totals live on Cartons, counting a cross-purchase batch once. Selected scope includes complete covered batches in totals; intersecting partial batches show their full contents in **Shared context — excluded from totals**. JSON retains source financial evidence and batch coverage. Dimension formulas use native numeric inputs and unrounded saved values, with cached results when dependencies are omitted. Unknown stays blank, explicit zero remains zero and batch-total kg is never prorated for partial loaded counts. Export flushes edits before freezing the file.

Each summary is JSON:

```json
{
  "format": "1688-export-summary",
  "version": 1,
  "kind": "packing-list",
  "exportedAt": "2026-10-19T10:00:00.000Z",
  "files": [
    "packing-list-2026-10-19-153012-Habitat.xlsx",
    "packing-list-2026-10-19-153012-Habitat.json"
  ],
  "orders": [{ "orderId": "…", "seller": "…" }],
  "products": [{ "orderId": "…", "code": "CE…", "name": "…", "quantity": 40 }],
  "totals": { "orders": 1, "products": 3, "quantity": 144 }
}
```

Label and carton-mark summaries use `"kind": "labels"` or `"carton-marks"` and list `pages`, `perPage`, the source `orders` (`orderId`, `seller`), and per product `code`, `name`, `orders` (order IDs), `requested`, `extra` (labels only) and `total`, with `totals.orders`, `totals.requested` and `totals.printed`. Quantities are JSON numbers, or decimal strings when beyond 2^53.

## Typical run

1. On the 1688 order list, tick orders, click `import-selected`, then `confirm-import`. Wait until `#workspace-status` leaves `importing`. If it shows `needs-sign-in`, stop and ask a person.
2. In the workspace, set `packing-month`, choose orders (`choose-order` + Space), click `select-all-rows` and `prepare-packing-list`, then `review-proceed` if a review appears.
3. In the packing list, click `export-packing-list` directly in the bottom toolbar.
4. `select-all-rows`, `open-print-menu` → `print-labels` → `export-pdf`; then `print-carton-marks` → `export-pdf`.
5. Read `data-files` on `#workspace-status`, then open each summary to check what was exported.
