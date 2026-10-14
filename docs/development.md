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

Price is the displayed base unit price, which can already include wholesale reductions. Discount is the displayed row reduction plus its share of any whole-order adjustment not already included. Allocation is proportional after item discounts, with deterministic cent rounding; price increases produce negative allocations. Shipping remains separate. Optional `totals.customizationService` and `totals.redPacketDiscount` retain `定制服务` and `红包` separately. Payable must equal goods net plus shipping plus customization service minus the red-packet reduction. These optional amounts are nonnegative; the red-packet field requires an explicit reduction sign. Neither changes product discounts. Absence remains compatible with old snapshots/backups. Unknown financial fields, unsupported installments and inconsistent totals fail validation. Legacy CSV exports item discounts only.

An explicit `批发优惠` can already be reflected in displayed unit prices. Accept a gap between the original goods total and summed row values only when it equals the whole explicit wholesale discount, customization service already included in the original total, or their sum, with exactly one supported interpretation; retain it as optional `totals.priceIncludedDiscount`. `goodsGross` retains the original footer value. Optional `totals.grossIncludedCustomization` records only zero or the whole explicit customization charge already in that original total. Database save/restore enforce original gross = row gross + price-included discount + gross-included customization; goods net excludes customization, and payable adds it exactly once. A positive `商品改价` can already be included in row discounts: consider only zero or the whole adjustment, recording the latter as optional `totals.rowIncludedAdjustment`. Allocate only the remainder. Reject partial or ambiguous interpretations.

An explicit `店铺优惠` or `活动优惠` can already be included in row discounts or appear only in the footer. Its order-only remainder equals displayed discount breakdown minus price-included wholesale discount plus row-included adjustment minus summed row discounts. Require exactly one supported interpretation with a remainder between zero and the sum of explicit shop and promotion reductions; store a positive remainder in optional `totals.orderDiscount`. Goods net equals summed row values minus source discounts, remaining allocated adjustment and order-only discount. Database save/restore enforce these equations, including that an included adjustment cannot exceed summed row discounts. Validate the discount summary against the original displayed breakdown first. An explicit signed `元宝` reduction can contribute to the displayed discount breakdown when row discounts and supported order-only coupons reconcile exactly; it is not automatically treated as a second payment deduction. Never use a payable discrepancy to invent a discount. Older snapshots omit the new fields.

The Orders search matches seller name/member login and full or partial order IDs, combining with purchase month/date range. Search resets bounded pagination and selections; a zero-result scope stays empty. Confirmations freeze the matching IDs before work begins. Running list progress distinguishes earlier failed reads from a job-level blocker; detailed failures stay in Activity and reports.

The exact `外币支付手续费` placeholder `（≈）` or `(≈)` is preserved as optional `foreignCurrencyFeeUnspecified: true`, with an English amount-not-shown notice. It is not a numeric zero or an inferred exchange fee. An amount-bearing, empty or different fee display remains unsupported, and all CNY totals must independently reconcile. Older snapshots omit the optional fields.

## Packing data and labels

Preparation is authored separately from source snapshots. Grouping uses structured titles and SKU attributes when available; legacy descriptions remain a fallback. A group has one base code, with variants linked to source entry IDs. Non-size attributes distinguish variants; size is separate. Suggestions never aggregate or alter source prices, quantities or discounts. Refresh preserves preparation edits; removed entries stay recorded but are excluded from current label output, and new entries need preparation review.

The preparation form shows product photos with original-image zoom, carton previews per group and barcode previews per variant. Code options and grouping tools start collapsed. **Share one barcode** combines selected variants without combining their source rows; **Give rows separate barcodes** restores individual variants for those rows; **Move to new product** gives selected variants a separate group. Hover/focus hints attach to existing controls, with Escape dismissal and a Chrome 120 positioned-popover fallback. The source size is read-only reference text: it informs initial suffix suggestions but is not printed. Only size suffixes enter barcode payloads.

Preparation autosaves after 800 ms idle and flushes before closing or label output. Opening an order prepares that order only; unvisited orders are not silently allocated in a loop. Writes retain transactional allocation and revision checks. `preparation-save.js` acknowledges submitted values in place while preserving newer typing and live field references. Successful writes update only that order's membership cache. Invalid/conflicting edits stay in the open dialog with inline status; navigation warns while unsaved work remains. Cross-tab conflicts never overwrite newer revisions.

`preparation-history.js` retains at most 50 edits or 8 MiB, coalescing typing until focus leaves a field. Undo/Redo cover pending edits only; autosave clears committed history without releasing issued codes. Grouping and Undo wait for active writes. `preparation-media.js` observes visible tiles, renders one label and loads up to two photos at a time, and invalidates changed label content only. Its label cache is capped at 16 MiB; reduced photos at 40 entries/4 MiB. Combined photo galleries page ten images. Release tile URLs on exit/reset. Form photos use reduced bitmaps from the shared image loader; zoom displays the original source.

Missing source seller identity is explicit: `sellerUnavailable: true`, `sellerName: 'Seller unavailable'`, and no member login. Import still requires complete rows and reconciled totals. New preparation starts with an empty `sellerId`; the user must enter the seller member login before allocation. Placeholder identities cannot allocate codes. This authored identity survives source refresh and backup independently of the source flag; missing sellers never share a synthetic allocation group.

Initialize the packing-month control once per workspace opening from the local calendar year/month. Rendering and refresh must preserve an explicit choice; existing preparation retains its saved month. Dialogs support backdrop dismissal with native `closedby` and a pointer-boundary fallback. Closing a confirmation cancels work. Label dismissal waits for a pending valid blur-save; invalid edits keep their explanation visible.

The chosen packing month controls `CEYYMMGGII`: `GG` is a monthly seller group and `II` the product number within it, both `01`–`99`. Seller identity prefers the source member login and falls back to the seller name. Allocation continues across that seller's orders, opens another group after item 99, and fails when all monthly groups are exhausted. Allocation and preparation save together in one transaction. Issued base codes and full barcode strings remain reserved after edits or order deletion; conflicting manual codes are rejected. Revision checks reject stale edits from another tab.

Barcode text concatenates the base code, variant suffix and size suffix. Variant suffixes use uppercase letters; size suffixes allow uppercase letters and digits. Comparable scalar sizes can suggest ordered codes: two sizes use S/L, three S/M/L, and five XS/S/M/L/XL. Explicit named sizes are retained. Ambiguous sizes require a manual mapping. Spanish names and categories come from an editable local vocabulary; conflicting suggestions leave the affected field blank. No translation service is called.

Labels render locally as PNGs: the default barcode is 40 × 20 mm and the carton mark is 148.5 × 105 mm, both at 300 DPI. Code 128 bars use integer pixel widths and quiet zones; text that cannot fit or a barcode that is too dense reports an error. The black code band follows the fitted text with small horizontal padding. Carton marks emphasize CE, the base code and Chinese category while keeping the blank quantity, KG and CBM fields compact. Shared field bounds align the constrained editor with the rendered text. It commits on Enter or blur and restores saved text on Escape. A single label copies PNG plus HTML with physical dimensions; batches use one image per HTML table row. Visible preparation previews render on demand; copy and editor output retain full print resolution. Rendering uses a bounded cache and limited concurrency. Printer/scanner and spreadsheet acceptance remain separate from rendering tests.

Future workbook automation should consume validated snapshots plus preparation membership, codes and settings. Add carton measurements, loading inputs and validated freight/discount allocation before template-based XLSX generation. Reuse grouping, allocation and label rendering; do not infer identity from row position or copy formulas from historical workbooks. Direct workbook writing is not implemented in this release.

## Backups

The on-page **Save import report** action requests a fresh full job from the worker using `IMPORT_REPORT`; it validates the originating list tab/frame and reads without acquiring the import mutation lock or pumping the queue. It uses the same report formatter as Activity, with page Blob URLs released after the download request or toolbar disposal.

Version 2 backups include orders, history, notes, cached pictures, preparations, allocation counters, issued-code reservations and packing preferences, including the local vocabulary and selected logo. Import jobs are not restored. Version 1 order-library backups remain accepted. Restore validates the whole file and commits atomically, preserves existing notes, merges newer observations and preparation edits, and rejects conflicting code ownership or equally dated conflicting preparation edits. Keep reservations when moving a library; restoring into independent libraries is not a shared numbering service.

Activity can export an `1688-import-report` JSON snapshot with extension version, discovery/save/failure counts, scanned pages and every queued order's ID, canonical detail URL, state, expected row count and error. Each failed order retains one `lastFailure` through retries, including a successful retry. Failed detail reads capture bounded financial evidence: up to 30 total fields, payable/discount summary text, product counts and aggregate amounts, and up to 25 price/quantity/discount samples with explicit omitted counts. Reports omit filters, page HTML, product descriptions/images and session data. Evidence stays local; no automatic upload occurs. Progress responses omit saved evidence; report export reads the full job directly from shared IndexedDB.

When a product discount amount cannot be parsed, diagnostics retain its exact amount text, capped at 160 characters, and source row number. An exact `包邮` badge is nonmonetary and ignored; other malformed monetary entries still fail. Failed reads also retain bounded raw financial text beside sampled values, including summary/amount/price text, to diagnose direction or duplicate-presentation problems. No tolerance is applied to unexplained cent differences; unsigned price changes still require row-level evidence.

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
