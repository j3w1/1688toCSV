# Development

Use Windows-native Node.js 24 and the workflow in [AGENTS.md](../AGENTS.md). Edit sources, rebuild explicitly, then test the generated **dist** extension. There is no watch mode.

| Command                               | Purpose                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run verify`                      | Source/docs checks, unit tests, production rebuild and isolated Chromium tests |
| `npm run build` / `npm run build:dev` | Build the complete extension once into dist                                    |
| `npm run test:browser`                | Test the current build with synthetic pages in a temporary profile             |
| `npm run test:excel`                  | Windows Excel integration check in an unsaved workbook; restores the clipboard |
| `npm run preview`                     | Synthetic preview; `/library.html` opens the spreadsheet                       |
| `npm run screenshots`                 | Regenerate workspace and label-editor images using synthetic data              |
| `npm run check:docs`                  | Validate local links, screenshots and documented commands                      |

For UI changes, regenerate screenshots and check documentation after final verification. Keep the main README practical; record only necessary developer constraints here. Do not commit private orders, exports, captures, profiles or credentials.

[CI](../.github/workflows/ci.yml) routes docs-only changes to documentation checks, code to full verification, and mixed changes to both. Its stable `required` check rejects failures, cancellations and unexpected skips. Desktop Excel is tested locally, not in hosted Linux CI.

## Boundaries

Page adapters extract and validate source data. Monetary calculations use exact cents. IndexedDB stores snapshots, history, notes, import checkpoints and separate packing data. The import controller owns bounded retries and tab navigation; the library owns filtering and clipboard presentation. Add layout support in adapters and synthetic fixtures, keeping selectors out of the library UI.

Full order and product-entry IDs remain strings. Only complete snapshots that reconcile with displayed totals replace saved data. Changed data creates a retained version; notes and tags remain separate. Failed reads preserve the last good snapshot. Purchase dates describe the source order, not the time it was imported; unknown dates remain unknown until a successful refresh supplies them. Once established, purchase time stays fixed across list and detail reads.

Imports use one visible, marked reader tab. Preserve tabs navigated away from the importer and never resume saved bulk queues automatically. The embedded browser can reject new tabs; the current-tab spreadsheet action refuses to replace a tab used by a running import. Dismissing an import notice hides it without deleting its job or order records.

Render at most 50 order cards and 100 product rows per page. Filtering and copy scope still include all matching records. Purchase-date ranges are inclusive; an empty matching scope must never fall back to all saved orders. Confirm multi-order import/refresh and multi-row copy operations before starting. `IMPORT_PROGRESS` updates jobs only; `LIBRARY_CHANGED` reloads saved records. Progress alone must not rescan or rebuild the product library.

## Copying and calculations

Copying includes selected product rows, or all filtered rows across pagination when none are selected. Headers default off and follow the remembered checkbox. Order dividers are presentation only. Product images use original CDN sources; individual image copying preserves their pixels, while bulk images use a compact display size for standard Excel rows. They paste as separate floating pictures, not native in-cell images.

Price is the original unit price. Discount is the total reduction for a product row: an explicit item discount plus its allocated share of a whole-order adjustment. Allocation is proportional after item discounts, with deterministic cent rounding; price increases produce negative allocations. Shipping remains separate. Optional `totals.customizationService` and `totals.redPacketDiscount` retain `定制服务` and `红包` separately. Payable must equal goods net plus shipping plus customization service minus the red-packet reduction. These optional amounts are nonnegative; the red-packet field requires an explicit reduction sign. Neither changes product discounts. Absence remains compatible with old snapshots/backups. Unknown financial fields, unsupported installments and inconsistent totals fail validation. Legacy CSV exports item discounts only.

## Packing data and labels

Preparation is authored separately from source snapshots. Grouping uses structured titles and SKU attributes when available; legacy descriptions remain a fallback. A group has one base code, with variants linked to source entry IDs. Non-size attributes distinguish variants; size is separate. Suggestions never aggregate or alter source prices, quantities or discounts. Refresh preserves preparation edits; removed entries stay recorded but are excluded from current label output, and new entries need preparation review.

The chosen packing month controls `CEYYMMGGII`: `GG` is a monthly seller group and `II` the product number within it, both `01`–`99`. Seller identity prefers the source member login and falls back to the seller name. Allocation continues across that seller's orders, opens another group after item 99, and fails when all monthly groups are exhausted. Allocation and preparation save together in one transaction. Issued base codes and full barcode strings remain reserved after edits or order deletion; conflicting manual codes are rejected. Revision checks reject stale edits from another tab.

Barcode text concatenates the base code, variant suffix and size suffix. Variant suffixes use uppercase letters; size suffixes allow uppercase letters and digits. Comparable scalar sizes can suggest ordered codes: two sizes use S/L, three S/M/L, and five XS/S/M/L/XL. Explicit named sizes are retained. Ambiguous sizes require a manual mapping. Spanish names and categories come from an editable local vocabulary; conflicting suggestions leave the affected field blank. No translation service is called.

Labels render locally as PNGs: the default barcode is 40 × 20 mm and the carton mark is 148.5 × 105 mm, both at 300 DPI. Code 128 bars use integer pixel widths and quiet zones; text that cannot fit or a barcode that is too dense reports an error. The constrained editor commits on Enter or blur and restores saved text on Escape. A single label copies PNG plus HTML with physical dimensions; batches use one image per HTML table row. Rendering is on demand, with a bounded cache and limited concurrency. Printer/scanner and spreadsheet acceptance remain separate from rendering tests.

Future workbook automation should consume validated snapshots plus preparation membership, codes and settings. Add carton measurements, loading inputs and validated freight/discount allocation before template-based XLSX generation. Reuse grouping, allocation and label rendering; do not infer identity from row position or copy formulas from historical workbooks. Direct workbook writing is not implemented in this release.

## Backups

Version 2 backups include orders, history, notes, cached pictures, preparations, allocation counters, issued-code reservations and packing preferences, including the local vocabulary and selected logo. Import jobs are not restored. Version 1 order-library backups remain accepted. Restore validates the whole file and commits atomically, preserves existing notes, merges newer observations and preparation edits, and rejects conflicting code ownership or equally dated conflicting preparation edits. Keep reservations when moving a library; restoring into independent libraries is not a shared numbering service.

Activity can export an `1688-import-report` JSON snapshot with extension version, discovery/save/failure counts, scanned pages and every queued order's ID, canonical detail URL, state, expected row count and error. Each failed order retains one `lastFailure` through retries, including a successful retry. Failed detail reads capture bounded financial evidence: up to 30 total fields, payable/discount summary text, product counts and aggregate amounts, and up to 25 price/quantity/discount samples with explicit omitted counts. Reports omit filters, page HTML, product descriptions/images and session data. Evidence stays local; no automatic upload occurs. Progress responses omit saved evidence; report export reads the full job directly from shared IndexedDB.

Reports do not restart jobs and are not database backups. Use a backup alongside a report when analyzing imported product data. A paused scan retains discovery; completed-with-errors retry revisits only failed orders. Unknown total labels fail promptly without spending the hydration timeout, and the import continues with other orders. The 667-order synthetic regression covers 67 pages, scan interruption, independent controller recovery, partial failure and retry without rereading successful details. Real site layouts and amount presentation require separate acceptance; synthetic fixtures are not the user's database.

Removing an order also removes its history and preparation, but keeps issued codes reserved; shared images can remain cached. Unfetched pictures require a connection. Theme and Headers preferences belong to the browser and are not included in the packing backup. One buyer account per library is supported.

## Browser verification

Packaged tests cover selection, navigation, extraction, persistence, spreadsheet copying, delayed rendering, failed-job retry, preparation edits and label output. Large-library cases cover pagination and progress without full-library reads. The isolated test copy substitutes reserved `.test` domains and serves synthetic pages locally. Test-only permissions and hosts never enter the production build. Remote requests are blocked. Run clipboard browser suites and the desktop Excel check sequentially so they cannot overwrite each other's clipboard. Coverage describes the tests; consult the release record for which checks have actually passed.

To run import tests in installed Microsoft Edge from PowerShell:

```powershell
$env:EXTENSION_TEST_CHANNEL = 'msedge'
try {
  npm run test:browser -- tests/browser/import-flow.spec.mjs
} finally {
  Remove-Item Env:\EXTENSION_TEST_CHANNEL
}
```

The existing private offline replay uses inert supplied captures in ignored `work/`; it is not part of the distributable fixtures. Keep unit/browser checks, offline replay, Windows Excel tests and live embedded-browser acceptance distinct. Reloading the installed extension and refreshing its pages is necessary for live acceptance. Honor browser-tool denials; isolated tests do not prove live-site behavior. Release-specific verification and unfinished store requirements are in [CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md).
