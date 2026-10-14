# Chrome Web Store Listing — 1688toCSV

> Last Updated: 2026-10-14
>
> Version 2.2.4 passed local, isolated Chromium/Edge and supplied-export checks. The full live collection remains outstanding. No store submission or publication. Earlier verification and live browser observations are recorded separately.

## Store Listing

**Extension Name** [REQUIRED]: 1688toCSV

**Short Description** [REQUIRED]: Prepare 1688 orders with CE product codes, barcode and carton labels, and copy products and images into Excel.

**Detailed Description** [REQUIRED — draft]

```text
Prepare 1688 purchases for packing and copying into Excel.

Collect selected orders, browse purchases by month or date range, and review original product descriptions, variants, prices, quantities and discounts. Choose a packing month, review suggested product groups, and save CE product codes. Add uppercase Spanish short names and Chinese categories using an editable local vocabulary. Review variant and size suffixes before preparing labels.

Edit barcode and carton-mark text directly in a label preview. Copy printable label images, chosen preparation columns, source values or separate product pictures into Excel. Product codes appear once per group in preparation columns. Headers start off and remember your choice. Settings control label dimensions, resolution, logo and vocabulary. The workspace starts dark and remembers your light/dark choice.

Search by seller or order number and combine with purchase-date filters. Refresh all saved orders, selected orders or matching orders. Multiple-item actions show their scope for confirmation. Activity holds progress, pause/retry controls, old notices and a downloadable report of every import result, including the latest failure details retained after retry. Source changes retain previous versions and preserve your notes and preparation edits. Price adjustments not already included in row discounts are distributed across products; wholesale reductions already in prices are counted once; order-only shop discounts, shipping, customization charges and red-packet reductions stay separate in order totals. A foreign-currency fee with no displayed amount is clearly marked as unspecified. New preparation starts with the current month. Click the dimmed background to close an overlay or cancel a confirmation.

HOW TO USE
Select order checkboxes on your 1688 order list and choose Import selected. Confirm the scope and keep the list open while the reader tab works. Open the spreadsheet, choose orders and a Packing month, then select Prepare labels. Review the suggestions and save preparation. Open a product's Barcode or Carton mark to edit and copy its label. Paste the chosen values or images into Excel. The single-order CSV button remains available.

PRIVACY
Orders, versions, notes, preparation edits, issued codes, label settings, vocabulary, selected logos and cached pictures stay in your browser. Back up and restore using a local file. Labels and vocabulary suggestions are generated locally; no online translation or developer service receives your orders, and no analytics are used. The extension does not read passwords/authentication cookies or submit, pay for, or alter orders. Importing opens 1688 pages using your existing session; product pictures may be requested from Alibaba CDN.

SCOPE
One buyer account per library and the observed supported page layouts. Imports are user-requested; opening a saved order refreshes it. Incomplete pages, login screens and totals that do not reconcile preserve the previous good version. Keep backups, including issued-code reservations, before moving computers, uninstalling or clearing your profile. Excel receives pasted values and floating pictures; direct workbook writing is not included.
```

**Category** [REQUIRED]: Shopping — proposed; confirm in Dashboard.

**Single Purpose** [REQUIRED]: Prepare locally stored 1688 purchase orders, product codes and packing labels for copying into Excel.

**Primary Language** [REQUIRED]: English UI; original product languages retained.

## Graphics & Assets

| Asset                  | Dimensions                           | Status / file                                                                       |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Store icon             | 128 × 128 PNG                        | Present; artwork rights and store suitability unfinished: [icon](icons/icon128.png) |
| Screenshot 1           | Store target 1280 × 800 or 640 × 400 | README only: [library](screenshots/order-library.png)                               |
| Screenshot 2           | Store target 1280 × 800 or 640 × 400 | README only: [dark library](screenshots/order-library-dark.png)                     |
| Screenshot 3           | Store target 1280 × 800 or 640 × 400 | README only: [label editor](screenshots/label-editor.png)                           |
| Small promotional tile | 440 × 280                            | Not created                                                                         |
| Optional marquee       | 1400 × 560                           | Not created                                                                         |

Workspace and label-editor screenshots use synthetic orders and were regenerated for version 2.2.4; store submission needs separate store-sized composition. Existing icons include 1688/Alibaba and spreadsheet branding; rights were not established in this task. The bundled Casa Elida label logo and any user-selected replacement also need appropriate rights for their intended use. Confirm permission or replace artwork before submission. Do not imply affiliation.

## Permissions Justification

The production [manifest](manifest.json) requests no downloads, scripting, activeTab, cookies, history or clipboard-read permission.

| Permission                 | Type | Purpose                                                                                                                       |
| -------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| tabs                       | API  | Identify/manage tabs for explicit imports; detect interrupted navigation and close only importer-created tabs                 |
| alarms                     | API  | Continue checkpointed steps while a requested import is active; no scheduled account crawler                                  |
| clipboardWrite             | API  | Copy product/preparation values, product pictures and generated labels after a user copy action                               |
| unlimitedStorage           | API  | Retain orders, earlier versions, preparation data and pictures beyond small default limits; disk errors still report failures |
| https://cbu01.alicdn.com/* | Host | Fetch and cache public product images, including original-size copies, without credentials                                    |

Packaged content scripts match these pages:

| Match                                                                     | Purpose                                                                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| https://air.1688.com/app/ctf-page/trade-order-detail/index.html*          | Save/read complete orders, refresh saved orders, CSV controls                                                          |
| https://trade.1688.com/order/new_step_order_detail.htm*                   | Declared legacy route when its layout is supported                                                                     |
| https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html* | Order discovery and pagination                                                                                         |
| https://work.1688.com/*                                                   | Recognize the buyer workbench's directly rendered or embedded list; only mount controls when a supported list is found |

List scripts run in matching frames because the workbench hosts a separate list application. The toolbar opens a full extension page, with no popup. Test-only localhost and inspection permissions do not ship.

## Privacy & Data Use

**Does the extension handle user data? Yes, locally.**

| Data type                                                                              | Handling                                                              | Off-device use                                                           |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Seller names, member/shop identifiers, purchase dates and order/product-entry IDs      | Retained for identity, grouping and reconciliation                    | No developer upload                                                      |
| Prices, quantities, discounts, shipping, totals                                        | Validated, retained with history and copied on request                | No developer upload                                                      |
| Failed-import financial evidence and error details                                    | Bounded local evidence retained with the import and exported on request | No automatic upload                                                    |
| Product text, variants, pictures                                                       | Local database/cache                                                  | Image requests reach Alibaba CDN; imports make normal 1688 page requests |
| User notes/tags                                                                        | Stored locally and included in backups                                | No developer upload                                                      |
| Product groups, packing months, CE codes and variant/size mappings                     | Stored separately from source orders; included in backups             | No developer upload                                                      |
| Spanish names, Chinese categories, local vocabulary, label settings and selected logos | Stored locally; used to generate label images and included in backups | No translation service or developer upload                               |
| Supported URLs/filters                                                                 | Explicit import and retained checkpoints                              | Requests to 1688 to load those pages                                     |
| Authentication information                                                             | No password/token/cookie extraction                                   | Normal navigation uses the signed-in browser session                     |
| Recipient addresses, private communications, general history                           | Not intentionally extracted or logged                                 | None                                                                     |
| Analytics, advertising, creditworthiness                                               | Not collected for these purposes                                      | None                                                                     |

Orders, purchase dates, histories, notes, jobs, images and preparation data persist locally. Cached images are deduplicated by URL. Removing an order removes its versions and preparation; issued codes stay reserved and shared images may remain cached. Dismissing a job hides its notice while retaining the record. Version 2 backups include orders/history/notes/cached images, preparations, allocation counters, issued-code reservations and packing preferences, not active jobs. Version 1 backups remain supported. Import reports save queued order IDs, canonical detail URLs, statuses, expected row counts, errors, run counts and the latest failed-read financial evidence to a local file on request. Evidence is bounded to 30 total fields, 25 product financial samples and aggregate amounts, with omitted counts; it excludes page HTML, product descriptions/images and session data. Retries retain the latest failure even after a successful save. No automatic upload occurs. Theme and Headers preferences are remembered separately in the browser; their defaults are dark and unchecked. Uninstalling or deleting the profile can delete the library. Clipboard data and saved files are subsequently controlled by the operating system and user.

Implementation: [database](src/database.js), [snapshots](src/order-snapshot.js), [import controller](src/import-controller.js), [background](src/background.js), [images](src/images.js), [clipboard](src/clipboard.js), [packing model](src/packing-model.js), [label renderer](src/labels.js), [preparation clipboard](src/preparation-clipboard.js).

### Data Use Certification

Publisher confirmation and Dashboard submission remain outstanding:

- [ ] Data is not sold.
- [ ] Data is not used outside the order-library purpose.
- [ ] Data is not used for creditworthiness/lending.

## Privacy Policy

**Privacy Policy URL** [REQUIRED]: Not supplied or published.

Draft substance: records, history, notes, pictures, preparation edits, reserved codes, label settings, vocabulary, selected logos and bounded failed-import financial evidence remain locally stored. No developer-operated uploads, online translation or analytics. Import/refresh access 1688 in the existing session; pictures may be requested from Alibaba CDN. No credential extraction or order transactions. Users control copying, backups, diagnostic reports, restore and removal; removing an order preserves its issued-code reservations. Add publisher identity, effective date and contact information before publication.

## Distribution

**Visibility / regions:** Not selected. Repository push authority does not authorize store submission.

## Developer Info

**Publisher name/contact email** [REQUIRED]: Not provided; do not infer a legal identity from the repository owner.

**Support route** [RECOMMENDED]: Not confirmed.

**Homepage** [RECOMMENDED]: Candidate [j3w1/1688toCSV](https://github.com/j3w1/1688toCSV).

## Version History

| Version | Date       | Changes                                                                                                                                                                         | Status                                                                                                                 |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2.2.4   | 2026-10-14 | Reconcile wholesale prices and adjustments already included in row discounts; searchable orders and clearer continuing-import progress | Local, Chromium, Edge and supplied-export checks passed; live retry and full collection outstanding; no store submission |
| 2.2.3   | 2026-10-14 | Separate order-only shop discounts, retain unspecified foreign-fee notices, default packing month to the local current month, and dismiss overlays by backdrop click | Local, Chromium, Edge and supplied-export checks passed; live full collection outstanding; no store submission |
| 2.2.2   | 2026-10-14 | Separate red-packet reductions, bounded failure evidence retained after retry, and prompt continuation past unsupported totals | Local, Chromium, Edge and supplied offline checks passed; live 67-page collection unverified; no store submission |
| 2.2.1   | 2026-10-14 | Separate customization-service charges, complete import reports and 67-page checkpoint/retry regression coverage | Local, Chromium, Edge and supplied offline checks passed; live 1688 and local extension page access blocked by browser policy; no store submission |
| 2.2.0   | 2026-10-14 | Packing workspace, persistent CE numbering, editable barcode/carton labels, local vocabulary, preparation columns, version 2 backups, date-scoped refresh and quieter Activity  | Local, Chromium, Edge and Windows Excel checks passed; synthetic screenshots regenerated; no store submission          |
| 2.1.0   | 2026-10-14 | Original-size image copies, inline copy feedback, remembered headers, purchase-date grouping, visual order dividers, Refresh all, dismissible import history and a theme toggle | Local Chromium, Edge and Windows Excel checks passed; live embedded build unverified; no store submission              |
| 2.0.4   | 2026-10-14 | Separate spreadsheet-opening errors from import progress; offer current-tab library navigation with saved data retained                                                         | User screenshot reports one order saved; current-tab navigation regression tested locally, embedded acceptance pending |
| 2.0.3   | 2026-10-14 | Exclude framework comment nodes from payable text; cover split currency and decimals in packaged imports                                                                        | Local unit and browser regression verification; live embedded-browser acceptance remains unverified                    |
| 2.0.2   | 2026-10-14 | Tolerant optional discount-summary presentation, bounded readiness retries, accurate tab errors, packaged end-to-end import tests                                               | Edge synthetic import/retry/theme and private offline replay verified; live embedded-browser acceptance unverified     |
| 2.0.1   | 2026-10-14 | Explicit active tabs for embedded-browser compatibility, one reusable detail reader, safer bulk import/resume, on-list progress and dark mode                                   | Local regression verification; corrected live import acceptance pending                                                |
| 2.0.0   | 2026-10-13 | Multi-order library, resumable imports, reconciliation/history, order-adjustment allocation, Excel pictures, notes, backup/restore                                              | Superseded: user verified 67-page discovery; detail import failed because embedded browser rejected background tabs    |
| 1.1.4   | 2026-10-13 | One-click CSV page control; removed popup                                                                                                                                       | Local tests passed; user confirmed live download; not submitted                                                        |

## Review Notes

### Development verification

- Version 2.2.4 passed source/docs checks, 193 unit checks, the production rebuild, 85 packaged Chromium tests and 8 focused Edge tests. New coverage verifies already-included wholesale/price-adjustment reductions, strict ambiguity rejection, atomic backup validation, search with purchase filters, empty/cancelled/frozen refresh scopes, bounded pagination and continuing-import progress. Independent review findings were fixed and rechecked. The supplied 22-order/182-row backup restored unchanged in an isolated database. All three reported financial failures reconciled in inert reconstructed fixtures; one uses aggregate evidence for three rows omitted from the report sample. The later live report records 67/67 list pages discovered, 667 queued orders, 32 saved and 3 failed before user pause; it is not full collection acceptance. Synthetic screenshots were refreshed. Live agent access remains blocked; native Excel and printing were not rerun because label rendering and clipboard formats are unchanged.

- Version 2.2.3 passed source/documentation checks, 189 unit checks, the production rebuild, 82 packaged Chromium tests and 9 focused Edge tests. New coverage includes shop coupons absent/partly/already represented on product rows, the exact unspecified foreign-fee placeholder, strict CNY reconciliation, atomic backup validation, local/UTC month boundaries, native/fallback backdrop dismissal, cancellation without work and label-save behavior. The supplied backup restored unchanged in an isolated temporary database. Both failed financial cases from the user's report reconciled in inert reconstructed fixtures; this does not establish complete import of those source orders. Independent review found no actionable issues; synthetic screenshots were regenerated. The supplied exports establish a partial selected-order collection, not a complete live scan. Live agent access remains blocked. Native Excel and physical printing were not rerun; rendering and clipboard formats are unchanged.
- Version 2.2.2 passed source/documentation checks, 185 unit checks, the production rebuild, 74 packaged Chromium tests and 11 focused Edge tests. New cases cover separate red-packet accounting, backup validation, prompt failure on unknown totals, continued imports and retention of bounded financial diagnostics through successful retry and a downloaded report. Progress responses omit saved evidence without mutating checkpoints. An independent read-only review found no actionable issues. Edge replay of the three supplied inert captures again imported 66 rows and retained the 47.20 product discount. Synthetic screenshots were regenerated. None of those captures contains the reported red-packet field; its live presentation and the real 67-page scan remain unverified. Live agent access to 1688 and the installed extension page is blocked. Native Excel and physical labels were not retested; their rendering/copy implementation is unchanged.
- Version 2.2.1 passed source/documentation checks, 177 unit checks, the production rebuild, 70 packaged Chromium tests and 8 focused Edge tests. A synthetic 667-order/67-page controller case covers interruption, continuing after three failed details and retrying only those failures. Packaged tests verify customization charges through extraction, persistence, backup and unchanged product-copy values, plus a complete local import-report download without restarting jobs. The three supplied inert offline captures imported 66 rows and retained the 47.20 product discount; none contains the newly reported customization field. Synthetic screenshots were regenerated. Live agent access to both 1688 and the installed extension page was denied; the user's full scan and real customization-field presentation remain unverified. Native Excel and physical labels were not retested because their rendering/copy implementation is unchanged.
- Version 2.2.0 passed source/documentation checks, 172 unit checks, the production rebuild, 66 packaged Chromium tests and 36 focused Edge tests. Coverage includes allocation and backup invariants, independently decoded CODE 128 PNGs, editable labels, large-library pagination, lightweight progress and confirmation/date scopes. Review corrections for repeated-copy feedback and repeated-image memory accounting passed regression checks. README screenshots use synthetic data. Earlier evidence below applies to the named earlier releases.
- Version 2.2.0 Windows Excel acceptance passed four real browser-clipboard cases in disposable, preformatted workbooks: five source columns with eight separate pictures; latest carton-mark and barcode PNGs verified by hash; and seven headerless preparation columns with numeric values and one base code per group. Excel measured the default barcode at 40.040 × 19.932 mm and carton mark at 148.519 × 104.775 mm (0.4 mm tolerance). The check restored the clipboard and closed its automation instances; supplied workbooks were untouched. The native harness keeps the fixture server responsive and releases owned COM references before shutdown.
- Version 2.1.0 passed 140 unit checks, 47 packaged Chromium tests, 13 focused Edge tests, the Windows Excel check, documentation checks and screenshot generation. Independent review findings about stable purchase dates and copy-button availability were corrected and regression tested. The test boundaries are documented in [development notes](docs/development.md).
- Earlier packaged Chromium/Edge tests cover extraction, totals, database/backup transactions, import recovery and copying. An Edge replay of three inert private detail captures imported 66 product rows and preserved the explicit 47.20 item discount. Captures and browser profiles are not committed.
- Windows Excel acceptance was rerun for the 2.1.0 clipboard implementation: five columns, eight separate pictures aligned with their rows and numeric price/quantity cells in an unsaved workbook; the clipboard was restored.
- User screenshots now show two saved orders, 24 spreadsheet rows and pasted Excel values. They also identify the smaller image copies and persistent notices addressed in 2.1.0. Live agent access to 1688 remains blocked by browser-tool policy; no alternate live automation is used. These observations do not establish live acceptance of the new build.

### Known limitations

- One buyer account per library; no automatic account detection.
- Unsupported layouts, installment totals, unknown adjustments and inconsistent totals report errors and preserve good saved data.
- Bulk images use standard-height Excel rows and are floating pictures. Custom row heights, other spreadsheet apps and native in-cell conversion need separate verification.
- Cached images work offline; unfetched images still need a connection. Large uncached copies can take time.
- Packing suggestions need review, especially missing structured SKU data or ambiguous sizes. Vocabulary suggestions do not provide general translation.
- Issued-code reservations belong to the local library and its backups; independent libraries do not coordinate numbering. Manual conflicts fail rather than silently renumbering saved labels.
- Version 2.2.0 label pasting and Excel picture dimensions were verified; physical printing and hardware scanner use remain unverified. Direct workbook population is not implemented.
- Legacy CSV preserves item discounts; library copying also allocates order adjustments.
- Publisher details, public privacy policy, rights-cleared artwork, store screenshots and Dashboard settings remain unfinished. No store package or submission was created.

### Rejection history

No store review or rejection history was supplied or verified.
