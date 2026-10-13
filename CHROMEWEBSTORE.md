# Chrome Web Store Listing — 1688toCSV

> Last Updated: 2026-10-14
>
> Draft for development version 2.0.1. No store submission or publication. Live multi-order import acceptance remains pending.

## Store Listing

**Extension Name** [REQUIRED]: 1688toCSV

**Short Description** [REQUIRED]: Keep a local 1688 order spreadsheet, reconcile changes, and copy products and images to Excel.

**Detailed Description** [REQUIRED — draft]

```text
Turn 1688 purchases into a local, copyable order spreadsheet.

Collect selected orders or all pages of the currently filtered purchased-orders list. See thumbnails, descriptions and variants, original unit prices, quantities and discounts together. Copy five columns into Excel with separate pictures, copy values alone, or copy individual or grouped product images.

Refresh saved orders when needed. Changed products are highlighted, previous versions remain available, and your notes and tags stay separate. Whole-order price adjustments are distributed across products while original amounts remain visible. Shipping stays separate.

HOW TO USE
Set the filters on your 1688 order list. Select order checkboxes and choose Import selected. For bulk collection, expand More import options, review the order/page counts, and confirm Import all matching. Bulk resume also requires confirmation. Keep the list open while collection runs; progress, errors and Pause are available there. One visible detail tab is reused, including in the Codex embedded browser. Open the spreadsheet from the page or extension icon, select products, and choose Copy to Excel. Bulk images are compact pictures aligned with standard Excel rows; paste into a blank range and resize afterward. The one-click single-order CSV option remains, with its original item-discount behavior.

PRIVACY
Orders, versions, notes and cached pictures stay in your browser. Back up and restore using a local file. No developer service receives your orders and no analytics are used. The extension does not read passwords/authentication cookies or submit, pay for, or alter orders. Importing opens 1688 pages using your existing session; displaying/copying thumbnails may request Alibaba CDN images.

SCOPE
One buyer account per library and the observed supported page layouts. Imports are user-requested; opening a saved order refreshes it. Incomplete pages, login screens and totals that do not reconcile preserve the previous good version. Keep backups before uninstalling or clearing your profile.
```

**Category** [REQUIRED]: Shopping — proposed; confirm in Dashboard.

**Single Purpose** [REQUIRED]: Maintain a local spreadsheet of 1688 purchase orders for reconciliation and copying into Excel.

**Primary Language** [REQUIRED]: English UI; original product languages retained.

## Graphics & Assets

| Asset                  | Dimensions                           | Status / file                                                                       |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Store icon             | 128 × 128 PNG                        | Present; artwork rights and store suitability unfinished: [icon](icons/icon128.png) |
| Screenshot 1           | Store target 1280 × 800 or 640 × 400 | README only: [library](screenshots/order-library.png)                               |
| Screenshot 2           | Store target 1280 × 800 or 640 × 400 | README only: [page control](screenshots/1688toCSV-download.png)                     |
| Screenshot 3           | Store target 1280 × 800 or 640 × 400 | README only: [narrow library](screenshots/order-library-narrow.png)                 |
| Small promotional tile | 440 × 280                            | Not created                                                                         |
| Optional marquee       | 1400 × 560                           | Not created                                                                         |

All screenshots use synthetic orders and need separate store-sized composition. Existing icons include 1688/Alibaba and spreadsheet branding; rights were not established in this task. Confirm permission or replace with original artwork before submission. Do not imply affiliation.

## Permissions Justification

The production [manifest](manifest.json) requests no downloads, scripting, activeTab, cookies, history or clipboard-read permission.

| Permission                 | Type | Purpose                                                                                                       |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| tabs                       | API  | Identify/manage tabs for explicit imports; detect interrupted navigation and close only importer-created tabs |
| alarms                     | API  | Continue checkpointed steps while a requested import is active; no scheduled account crawler                  |
| clipboardWrite             | API  | Copy product values and pictures after a user copy action                                                     |
| unlimitedStorage           | API  | Retain orders, earlier versions and pictures beyond small default limits; disk errors still report failures   |
| https://cbu01.alicdn.com/* | Host | Fetch and cache public product thumbnails for display and copying, without credentials                        |

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

| Data type                                                    | Handling                                               | Off-device use                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Seller names and order/product-entry IDs                     | Retained for identity and reconciliation               | No developer upload                                                      |
| Prices, quantities, discounts, shipping, totals              | Validated, retained with history and copied on request | No developer upload                                                      |
| Product text, variants, pictures                             | Local database/cache                                   | Image requests reach Alibaba CDN; imports make normal 1688 page requests |
| User notes/tags                                              | Stored locally and included in backups                 | No developer upload                                                      |
| Supported URLs/filters                                       | Explicit import and retained checkpoints               | Requests to 1688 to load those pages                                     |
| Authentication information                                   | No password/token/cookie extraction                    | Normal navigation uses the signed-in browser session                     |
| Recipient addresses, private communications, general history | Not intentionally extracted or logged                  | None                                                                     |
| Analytics, advertising, creditworthiness                     | Not collected for these purposes                       | None                                                                     |

Orders, histories, notes, jobs and images persist in IndexedDB. Cached images are deduplicated by URL. Removing an order removes its versions; shared images may remain cached. Backups include orders/history/notes/cached images, not active jobs. The local appearance preference (System, Light or Dark) is stored in localStorage and synchronized across extension pages. Uninstalling or deleting the profile can delete the library. Clipboard data and saved files are subsequently controlled by the operating system and user.

Implementation: [database](src/database.js), [snapshots](src/order-snapshot.js), [import controller](src/import-controller.js), [background](src/background.js), [images](src/images.js), [clipboard](src/clipboard.js).

### Data Use Certification

Publisher confirmation and Dashboard submission remain outstanding:

- [ ] Data is not sold.
- [ ] Data is not used outside the order-library purpose.
- [ ] Data is not used for creditworthiness/lending.

## Privacy Policy

**Privacy Policy URL** [REQUIRED]: Not supplied or published.

Draft substance: records, history, notes and pictures remain locally stored. No developer-operated uploads or analytics. Import/refresh access 1688 in the existing session; pictures may be requested from Alibaba CDN. No credential extraction or order transactions. Users control copying, backups, restore and removal. Add publisher identity, effective date and contact information before publication.

## Distribution

**Visibility / regions:** Not selected. Repository push authority does not authorize store submission.

## Developer Info

**Publisher name/contact email** [REQUIRED]: Not provided; do not infer a legal identity from the repository owner.

**Support route** [RECOMMENDED]: Not confirmed.

**Homepage** [RECOMMENDED]: Candidate [j3w1/1688toCSV](https://github.com/j3w1/1688toCSV).

## Version History

| Version | Date       | Changes                                                                                                                                       | Status                                                                                                              |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 2.0.1   | 2026-10-14 | Explicit active tabs for embedded-browser compatibility, one reusable detail reader, safer bulk import/resume, on-list progress and dark mode | Local regression verification; corrected live import acceptance pending                                             |
| 2.0.0   | 2026-10-13 | Multi-order library, resumable imports, reconciliation/history, order-adjustment allocation, Excel pictures, notes, backup/restore            | Superseded: user verified 67-page discovery; detail import failed because embedded browser rejected background tabs |
| 1.1.4   | 2026-10-13 | One-click CSV page control; removed popup                                                                                                     | Local tests passed; user confirmed live download; not submitted                                                     |

## Review Notes

### Development verification

- Three private detail captures (21, 5 and 40 products) and two list captures were inspected offline. They preserve full IDs, variants, explicit item discounts and reconciled order totals. No private captures are committed.
- Synthetic unit and isolated Chromium tests cover extraction, allocation, database/backup transactions, job recovery and spreadsheet/clipboard behavior. Run npm run verify against the final candidate.
- npm run test:excel passed for synthetic browser copying into a fresh Windows Excel workbook: five columns, eight separate pictures at rows 2–9, numeric price/quantity cells. No workbook was saved; the previous clipboard was restored.
- User confirmed discovery across 67 real list pages in 2.0.0. A supplied screenshot identified the detail-import failure: the embedded browser requires active extension-created tabs. 2.0.1 explicitly requests active tabs and tests this restriction with a rejecting browser shim. Corrected live detail import, reconciliation and embedded-browser clipboard acceptance remain pending. Agent access to live 1688 is blocked by browser-tool policy; no alternate live automation is used.

### Known limitations

- One buyer account per library; no automatic account detection.
- Unsupported layouts, installment totals, unknown adjustments and inconsistent totals report errors and preserve good saved data.
- Bulk images use standard-height Excel rows and are floating pictures. Custom row heights, other spreadsheet apps and native in-cell conversion need separate verification.
- Cached images work offline; unfetched images still need a connection. Large uncached copies can take time.
- Legacy CSV preserves item discounts; library copying also allocates order adjustments.
- Publisher details, public privacy policy, rights-cleared artwork, store screenshots and Dashboard settings remain unfinished. No store package or submission was created.

### Rejection history

No store review or rejection history was supplied or verified.
