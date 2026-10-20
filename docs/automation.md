# Operating 1688toCSV with an automation agent

An agent can import orders, prepare a packing list, export it and print labels and carton marks for the owner without hover, drag or timing tricks. Every control below carries a stable `data-action` attribute that does not change with redesigns; its accessible name is listed too, in English (it follows the workspace language). Prefer `data-action` selectors.

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

Imports read each order in a background tab (or, if the browser refuses that, a separate unfocused window), so the visible tab never changes. Keep the list page open until the import finishes.

### Workspace: Orders

| `data-action`          | Accessible name                       | Does                                                                                                                                                                        |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view-orders`          | Orders                                | Shows the Orders view.                                                                                                                                                      |
| `view-packing`         | Packing list                          | Opens the packing list of the chosen packing month.                                                                                                                         |
| `choose-order`         | Order _number_                        | One per listed order, with `data-order-id`. Focus it and press Space to choose it (click its meta line, not its links). Choosing orders narrows the products table to them. |
| `select-all-rows`      | Select all rows                       | Selects every product row in the table (all pages).                                                                                                                         |
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

### Workspace: Packing list

| `data-action`         | Accessible name     | Does                                                                       |
| --------------------- | ------------------- | -------------------------------------------------------------------------- |
| `select-all-rows`     | Select all          | Selects every product in the open packing list.                            |
| `clear-selection`     | Clear selection     | Clears the selection.                                                      |
| `open-copy-menu`      | More copy formats   | Opens the Copy menu.                                                       |
| `export-packing-list` | Export packing list | In the Copy menu: saves the whole open packing list (no selection needed). |
| `open-print-menu`     | More print formats  | Opens the Print menu.                                                      |
| `open-grouping-menu`  | Grouping tools      | Opens the grouping menu.                                                   |

### Store spreadsheet format guide

**Import spreadsheet** opens a local workbook review. Select `.xlsx` or `.xls`, choose a sheet, enter a purchase date and confirm the store name. Review every highlighted source-cell issue, shared photo and combined-variant allocation. Only a valid, explicitly reviewed order can be saved; successful import refreshes Products immediately. Closing during file parsing terminates its worker, while a database save locks dismissal. Every import creates a new order. Spreadsheet orders have no 1688 source link or refresh action. **Settings → Data → Store spreadsheet guide** opens the same keyboard-operated, copyable format documentation without starting an import or changing the Settings draft.

The canonical markers are `pic`, `desc`, `boxes`, `perbox`, `qty`, `price`, `amount`, `group`, `var`, `kg`, `cbm`, `cbmx`, `cbmy`, `cbmz` and `total`. `amount` checks a source row; exactly two `total` markers surround the whole-order control. Unknown columns are ignored. Failed formulas, missing cached results, inconsistent arithmetic and missing or cross-group picture links block saving. Use actual quantities to split combined variants; source cartons stay shared. Weight and volume always describe one carton. **Carton details** edits local measurements; **Additional charges** reviews order-wide cost increases without replacing original prices. Photo viewers retain all original pictures and save square compositions separately.

**Download template** provides the blank Orders / Guide workbook beside the file chooser. The Setup / Markers / Checks sidebar explains filenames and the format without leaving review. **Check all** acknowledges eligible warnings only; it does not bypass validation or allocate variants. In **Edit photo**, variant tags identify products visually; **Tag size** scales every tag in that one photo together (60%–250%). Save commits the composition; Cancel preserves the previous version. Read the [China-store developer contract](development.md#china-store-spreadsheets) before automating store identity, shared cartons or photo persistence. A manually reviewed carton-print count does not track physical mixed-carton contents or shipped-unit allocations.

### Print menu and dialog (both views)

Products rows expose a compact **Pcs/box** spinbutton in its own column beside **Quantity**; **Price** and **Discount** are adjacent. The field stores units inside one full carton. Valid changes autosave after a short idle or on blur/Enter; invalid drafts are reported on blur/Enter and keep the last saved value. Preparation shows the stored capacity read-only with a copyable value beside its other numeric facts. The chosen-columns key remains `unitsPerCarton`. Exact source-row divisions initialize carton-mark counts; remainders, partial shared-carton selection or conflicting counts require an explicit count and the **Carton count reviewed for CODE** checkbox. Changing that count resets review. Export stays disabled until affected rows are reviewed. Fully unknown groups retain a clearly manual starting count.

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

| `data-action`          | Accessible name   | Does                                                                                                                |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `open-attention-tab`   | Open the 1688 tab | Brings the tab that needs a sign-in or verification forward. A person finishes that step.                           |
| `resume-import`        | Resume import     | Resumes the paused import.                                                                                          |
| `allow-visible-reader` | Use a visible tab | Only in browsers that refuse background tabs and windows: lets this import read in a visible tab. A person decides. |

## Status line

`#workspace-status` in the workspace header shows one state at a time, most urgent first. Read its `data-status` attribute; the text is for people.

| `data-status`       | Means                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `importing`         | An import is running. The text includes its progress.                                                                 |
| `needs-sign-in`     | An import paused because 1688 asked for a sign-in or verification. Use `open-attention-tab` and ask a person.         |
| `needs-visible-tab` | This browser refused a background tab and window for the import reader. A person decides with `allow-visible-reader`. |
| `export-finished`   | The latest export finished. `data-files` is a JSON array of the file names.                                           |
| `idle`              | Nothing is running and nothing was exported since the workspace opened or the last import started.                    |

The sign-in need is shown once; the extension never switches tabs by itself.

## Export files

Files download through the browser's normal download folder. Names are predictable and carry the local date and time (`YYYY-MM-DD-HHMMSS`), so every export has its own files and the browser never renames one; a second export within the same second gets `-2`. The status line and the summary always name the files actually saved:

| Export       | File                                                                            | Summary            |
| ------------ | ------------------------------------------------------------------------------- | ------------------ |
| Packing list | `packing-list-2026-10-19-153012-<seller>.xlsx`, or `…-<n>-sellers.xlsx`         | same name, `.json` |
| Labels       | `CE-labels-2026-10-19-153012-<n>-products.pdf` (`-1-product.pdf` for one)       | same name, `.json` |
| Carton marks | `CE-carton-marks-2026-10-19-153012-<n>-products.pdf` (`-1-product.pdf` for one) | same name, `.json` |
| Calibration  | `CE-print-calibration-2026-10-19-153012.pdf`                                    | none               |

The packing list uses the columns chosen in **Copy → Chosen columns** and one row per product, like **Copy values**.

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
3. In the packing list, `open-copy-menu` → `export-packing-list`.
4. `select-all-rows`, `open-print-menu` → `print-labels` → `export-pdf`; then `print-carton-marks` → `export-pdf`.
5. Read `data-files` on `#workspace-status`, then open each summary to check what was exported.
