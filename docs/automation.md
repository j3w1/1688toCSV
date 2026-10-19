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

### Print menu and dialog (both views)

| `data-action`        | Accessible name     | Does                                                    |
| -------------------- | ------------------- | ------------------------------------------------------- |
| `print-labels`       | Print labels…       | Opens the label dialog for the selected products.       |
| `print-carton-marks` | Print carton marks… | Opens the carton-mark dialog for the selected products. |
| `print-recent`       | Recent print jobs…  | Lists the five most recent exports to regenerate.       |
| `export-pdf`         | Export PDF          | Saves the PDF and its summary.                          |
| `print-calibration`  | Calibration sheet   | Saves a one-page calibration PDF (no summary).          |
| `close-print-dialog` | Cancel              | Closes the dialog; an export in progress is abandoned.  |

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
