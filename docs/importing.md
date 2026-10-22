# Importing and finding orders

[Documentation](README.md) · [Quick start](../README.md)

## Import from 1688

On the [buyer orders page](https://work.1688.com/home/buyer.htm), tick purchases and choose **Import selected**, or use **Import all matching…** for the current filters. Confirm the exact count and keep the list page open until completion. Open the workspace with the extension icon or **Open Workspace**; **Open Workspace here** is available when no import is running.

The reader tries a background tab, an unfocused window, then a visible tab as supported by your browser. It reuses its own reader and leaves unrelated tabs intact. A lost reader is recovered automatically; genuine browser failures remain actionable. Sign-in and verification pause the job. Use **Open the 1688 tab**, finish the requested step yourself, then **Resume import**. Reopening the workspace does not restart an older paused bulk queue.

Successful saves refresh the open workspace immediately. New matching purchases move Orders and Products to the top, preserving filters and selected product keys. A failed or incomplete read preserves the last good order. Purchase dates come from the purchase, not the time of import; unknown dates sort last.

## Add purchases from other sources

Choose **Orders → Add order**. Enter supplier, order reference and date, then descriptions, optional specifications, positive whole quantities and CNY unit prices. Optionally choose PNG, JPEG, WebP or GIF photos smaller than 1.4 MB. **Save order** validates and saves the complete order; a failed save retains the draft.

**Import order JSON** fills the same dialog for review. Its [file contract](automation.md#orders-from-other-sources) uses exact decimal strings and the same validation. A supplier/reference pair is unique after case, whitespace and Unicode normalization.

These orders show **Other source**, display your human reference and receive no invented 1688 link or refresh. They support normal preparation, codes, copying, printing and backups. Adding one does not infer payment, delivery status or a supplier account. Existing ambiguous source records retain their evidence.

For factory and market workbooks use the separate [spreadsheet importer](store-spreadsheets.md).

## Find and select

Orders and Products show purchases newest first, including time within a day, with source-row order preserved inside a purchase. Both lists scroll continuously. Selection, totals, photo navigation and copying cover the complete filtered list, including rows outside the viewport.

- Click a row to toggle selection; **Shift-click** selects a range and **Ctrl-click** adds/removes individual rows. Buttons, links and photos have their own actions.
- **Ctrl+A / Ctrl+D** selects/clears the last Orders or Products list you clicked or focused. Text fields retain normal text selection.
- Click a store name, or focus its card and press **Enter**, for order details, notes and tags. Double-click is another shortcut.
- Filter purchase months individually or **Shift-click** a range. Four recent months appear beside **All months**; **+N months** reveals older ones. Selected older months stay visible. Collapsing a month changes navigation only.

The first purchase-month filter is the current month; later choices persist across reloads. Packing month is separate and starts at the current month each time the workspace opens. Filtering purchases never renumbers packing products.

Search combines with purchase months, dates and status. Orders search accepts seller names/member logins and full or partial references. Products search includes source text, recognized translated attributes, tags and saved materials. Suggestions tolerate small typos in longer Latin words and ignore accents; codes, IDs, measurements and Chinese text match literally. Use arrows/Enter to choose a suggestion and Escape to dismiss it. Search stays local.

The whole-order summary counts each complete matching purchase once, including its freight and order discounts. The live selection summary counts selected source rows, quantity, gross item amount and item amount after saved row discounts; it excludes freight and order-only discounts. Click an available summary number to copy its exact numeric value. **Saved** means the first saved revision; **Updated** means saved source data changed previously. Neither describes unsaved edits or review status.

## Refresh and recover

Use contextual **Refresh** for selected orders or current filters. **Settings → Data** holds full-library refresh. Multi-order import/refresh asks you to confirm frozen scope; an empty filter never becomes the whole library. Spreadsheet and other-source orders are excluded from 1688 refresh.

**Activity** contains progress, failures, Pause/Resume, retry and **Save import report**. Its badge distinguishes ongoing work from unread results. Opening it marks visible updates read; ordinary progress ticks do not create new notifications. **Dismiss / Dismiss all** hides nonrunning notices without deleting jobs or orders. **Show dismissed** reveals them again. Minimize floating page controls to keep a compact progress strip while work continues.

Retries preserve successful saves. A completed import with errors retries failed details only; a paused discovery scan retains its discovered orders. A report records local diagnostic counts and bounded financial evidence; it is not a library backup and does not restart work.

<a href="../screenshots/import-progress.png"><img src="../screenshots/import-progress.png" alt="Synthetic import progress with saved products and the latest result" width="320" /></a>

Unsupported layouts, unknown adjustments, installments and unreconciled totals fail explicitly. Keep one buyer account per library; account switching is not detected automatically. The detail-page **Download CSV** remains available, with the [calculation limits](data-model.md#money-and-reconciliation) described separately.
