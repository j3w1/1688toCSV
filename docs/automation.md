# Operating 1688toCSV with an automation agent

An agent can import orders, prepare a packing list, export it and print labels and carton marks for the owner without hover, drag or timing tricks. Every control below carries a stable `data-action` attribute that does not change with redesigns; its accessible name is listed too, in English (it follows the workspace language). Prefer `data-action` selectors.

Popup language toggles are local to that popup and its exports. They do not change workspace language or another open popup; nested previews inherit their opener's language. Use the popup's own `lang` attribute and stable action selectors when switching its language. The assignment confirmation uses a fitted all-group grid without a pager: activate a card for its complete comparison, use arrows between cards and Escape to close the comparison.

Use synthetic or the owner's own data only as the owner directs; this guide describes behaviour, not data.

## Controls

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

The packing export popup saves its column choices/order and layout controls immediately. Its language is local to the popup and its exports; workspace colors determine Excel-image and workbook styling. Choose all products or the selected products, photo size, maximum description width, order headings, totals, frozen headers and filters. Restoring default columns preserves scope and layout choices. Preview contains at most five rows; download contains the entire chosen scope.

### Product photo viewer

| `data-action`  | Accessible name       | Does                                                                                                          |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `add-size-tag` | Add size tag · _size_ | Saves the recognized source size on the current photo; disabled with help when unavailable or already tagged. |

### Store spreadsheet format guide

**Import spreadsheet** opens a local workbook review. Select `.xlsx` or `.xls`, choose a sheet, enter a purchase date and confirm the store name. Review every highlighted source-cell issue, shared photo and combined-variant allocation. Only a valid, explicitly reviewed order can be saved; successful import refreshes Products immediately. Closing during file parsing terminates its worker, while a database save locks dismissal. Every import creates a new order. Spreadsheet orders have no 1688 source link or refresh action. **Settings → Data → Store spreadsheet guide** opens the same keyboard-operated, copyable format documentation without starting an import or changing the Settings draft.

The canonical markers are `pic`, `desc`, `boxes`, `perbox`, `qty`, `price`, `amount`, `group`, `var`, `kg`, `cbm`, `cbmx`, `cbmy`, `cbmz` and `total`. `amount` checks a source row; exactly two `total` markers surround the whole-order control. Unknown columns are ignored. Failed formulas, missing cached results, inconsistent arithmetic and missing or unreadable pictures block saving. A photo anchored across multiple included rows or their merged `pic` cell is reused across all covered groups after shared-photo review; uncovered rows are never filled by proximity or group membership. Use actual quantities to split combined variants; source cartons stay shared. Weight and volume always describe one carton. **Carton details** edits local measurements; **Additional charges** reviews order-wide cost increases without replacing original prices. Photo viewers retain all original pictures and save square compositions separately.

The **Download template** icon beside Purchase date provides the blank Orders / Guide workbook. The Setup / Markers / Checks sidebar explains filenames and the format without leaving review. **Check all** acknowledges eligible warnings only; it does not bypass validation or allocate variants. In **Edit photo**, A–E and size buttons compose variant tags (including mixed codes) without a dropdown. Clicking a product starts its label in the nearest corner; **Tag size** scales every tag in that one photo together (60%–600%). **Pointer size** separately scales all pointing circles, preserving labels, leaders and positions. Both sliders use fixed percentage stops; accessible value text reports the percentage, not the internal slider index. Save commits the composition; Cancel preserves the previous version. The photo viewer's `add-size-tag` action (**Add size tag · {size}**) immediately saves a recognized source-size annotation with its label bottom-right and point at 75% across/50% down, retaining existing tags and composition. With no size its disabled **Add size tag** button has a focusable hover/help wrapper explaining the missing recognition. Duplicate size annotations are disabled. Edit photo can subsequently move, rename or remove the new annotation. Read the [China-store developer contract](development.md#china-store-spreadsheets) before automating store identity, shared cartons or photo persistence. A manually reviewed carton-print count does not track physical mixed-carton contents or shipped-unit allocations.

### Tags and backups

**Settings → Tags** manages the Order tags and Product tags catalogs. Appearance handles theme/workspace colors; its explicit all-label/tag reset also refreshes tag colors in Tags. Switching sections or languages preserves the shared draft; Save waits for pending tag operations. **Review operational tags** previews selected, confirmed conversions into store/order/product workflow fields; unresolved tags and original wording remain. Read the [workflow contract](development.md#operational-workflow) before automating it.

Small `.operations-strip` buttons have translated accessible names and `data-operation` values. Their native **Operations workflow** dialog separates Product, Order and Store; use labeled fields and **Save workflow**. Status edits do not prepare products or rewrite the source supplier status. **Linked payments** in store details opens an explicit review: select an existing source, optional fee row, amount/reason and receiving scope, confirm, then **Save reviewed links**. The chain control on assigned products opens a repeat-purchase review; **Use the original codes** applies only after its checkbox is confirmed. Never infer financial links or shared code identity from a tag alone.

Full-library **Back up** and **Back up packing** download `.json.gz` files, using a lossless image dictionary and gzip. Pass either the new file or a legacy `.json` directly to its existing restore picker. Full-library restore stays in Settings Data; a packing restore stays in Orders. Decoding and all normal validation must finish before any database write. Import-report and output-metadata JSON files are not these archives.

### Print menu and dialog (both views)

Products rows expose a compact **Pcs/box** spinbutton in its own column beside **Quantity**; **Price** and **Discount** are adjacent. The field stores units inside one full carton. Valid changes autosave after a short idle or on blur/Enter; invalid drafts are reported on blur/Enter and keep the last saved value. Preparation shows the stored capacity read-only with a copyable value beside its other numeric facts. The chosen-columns key remains `unitsPerCarton`. Exact source-row divisions initialize carton-mark counts; remainders, partial shared-carton selection or conflicting counts require an explicit count and the **Carton count reviewed for CODE** checkbox. Changing that count resets review. Export stays disabled until affected rows are reviewed. Fully unknown groups retain a clearly manual starting count.

Code-conflict dialogs expose `.conflict-owner-card` and `.conflict-edit-card`; scope **Product code**, **Variant code** and **Size code** textbox locators to the relevant card. Both cards can edit assignments, including same-group suffixes. Shared base fields synchronize in the proposal. **Apply corrections** saves all changed orders atomically; **Continue editing** cancels popup edits. Comparison tables use `.packing-value-table` with one shared header, `.packing-value-before`, `.packing-value-arrow` and `.packing-value-after`; conflict comparisons hide unchanged rows. Swapped variant/size inputs expose `aria-invalid` only on the affected field, preserve saved assignments, and hide invalid label previews. Storage regressions exercise both preview/save and custom/legacy suffixes.

The compact checkmark button retains the accessible name **Apply to all** and the `apply-print-quantities` action. Paper and layout inputs update without blur. The print canvas exposes `data-preview-state` as `loading`, `ready`, `empty` or `error`; `aria-busy` is present while it renders. Dashed safe-area outlines are a separate SVG overlay and are not part of exported artwork. Fitted viewers disable horizontal scrolling; zoomed viewers keep native scrolling and panning.

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

The packing workbook uses its own complete 31-column layout, independently of **Copy → Chosen columns**. It includes Chinese/current-language headings, small embedded photos and standard code badges, native values and received/loaded weight and volume formulas. Payment/deposit/balance columns are omitted. The companion JSON retains detailed cost evidence and carton batch/month identities. The **Received boxes** and **Loaded boxes** fields in Packing autosave nonnegative whole confirmations; blank is unknown and zero confirms none. Export flushes these pending edits before freezing the file. Physical counts belong to the source carton batch and packing month, not the barcode or 1688 delivery status.

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
