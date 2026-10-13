# Chrome Web Store Listing — 1688toCSV

> Last Updated: 2026-10-13
>
> Draft store listing for version 1.1.4. Local verification passed, and the user confirmed a one-click download on a live 1688 order in the embedded browser. No store submission or publication was performed. Publisher details, a live privacy policy, and store artwork remain unfinished.

## Store Listing

**Extension Name** [REQUIRED]

1688toCSV

**Short Description** [REQUIRED]

Export 1688 order details to a clean CSV, locally in your browser.

**Detailed Description** [REQUIRED — draft copy]

```text
Export the product rows from a 1688 order detail page to a CSV for your spreadsheet.

Save product image links, descriptions, original unit prices, quantities, and total item-row discounts. Chinese text and multiline descriptions are preserved. The filename includes the seller name and the last four digits of the order number.

HOW TO USE
Open a supported 1688 order detail page and wait for its product rows to appear.
Click Download CSV in the 1688toCSV control at the bottom right of the page.
Your browser may ask where to save the file. Check your downloads to confirm that it finished.
After installing or reloading the extension, refresh an already-open order page to show the control.

DISCOUNTS
The Discount column contains the total discount for each product row. When the page shows a total row discount, that value is used instead of recalculating it from rounded unit prices. Whole-order price adjustments, including 商品改价, are not distributed across product rows.

PRIVACY
Order details are processed locally to create the file you request. The extension does not upload order data, track your browsing activity, or use analytics. It does not submit, pay for, or change orders. The CSV you save remains under your control and may contain sensitive purchase information.

SCOPE
This extension exports one open order detail page at a time. It does not export the purchased-orders list or all orders in your account. If required product data cannot be read, it shows an error instead of creating a partial export.
```

Add the publisher's confirmed support contact to the final copy before submission. The function described above is present in the 1.1.4 build; verification results are recorded below.

**Category** [REQUIRED]

Shopping — proposed category; confirm the matching category in the Developer Dashboard when preparing submission.

**Single Purpose** [REQUIRED]

Export product rows from the current 1688 order detail page to a local CSV file.

**Primary Language** [REQUIRED]

English. The interface is English; exported product text retains its original language.

## Graphics & Assets

| Asset                               | Target dimensions       | Status                                                                                 | Existing file or planned content                                                            |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Store icon [REQUIRED]               | 128 × 128 PNG           | Existing file has the correct dimensions; branding and final store suitability pending | [icons/icon128.png](icons/icon128.png)                                                      |
| Screenshot 1 [REQUIRED]             | 1280 × 800 or 640 × 400 | Not prepared for store upload                                                          | Supported synthetic order page with the bottom-right Download CSV control                   |
| Screenshot 2 [RECOMMENDED]          | 1280 × 800 or 640 × 400 | Not prepared for store upload                                                          | Resulting synthetic CSV with the original price, quantity, and row discount columns visible |
| Screenshot 3                        | 1280 × 800 or 640 × 400 | Not planned                                                                            | —                                                                                           |
| Screenshot 4                        | 1280 × 800 or 640 × 400 | Not planned                                                                            | —                                                                                           |
| Screenshot 5                        | 1280 × 800 or 640 × 400 | Not planned                                                                            | —                                                                                           |
| Small promotional tile              | 440 × 280               | Not created                                                                            | Original extension branding                                                                 |
| Marquee promotional tile [OPTIONAL] | 1400 × 560              | Not created                                                                            | —                                                                                           |

### Screenshot Notes

The [page-control screenshot](screenshots/1688toCSV-download.png) and [CSV screenshot](screenshots/csv-file-screenshot.png) were regenerated for the 1.1.4 interface using synthetic order data. They are README assets, not store-ready artwork. Compose and inspect separate store images at the required dimensions before submission. The extension has no popup; obsolete popup screenshots must not be used for the listing.

The 16, 48, and 128 pixel PNG icon files have been checked against their declared dimensions. The current icon artwork includes 1688/Alibaba and spreadsheet branding. Rights to that artwork have not been established in this task; confirm permission to use it or replace it with original artwork before a store submission. Do not imply endorsement or affiliation.

Google's [store image guidance](https://developer.chrome.com/docs/webstore/images?authuser=8) specifies the screenshot sizes and required image types. Its current instructions include a small promotional image among the required assets; the installed skill template labels that tile recommended. Keep it unfinished until the submission assets and Dashboard requirements are reconciled.

## Permissions Justification

The production 1.1.4 [manifest](manifest.json) declares no API permissions, explicit `host_permissions`, or optional permissions. The page-only flow removes `activeTab`, `scripting`, and `tabs`; the unused `storage` permission is also absent. A native file link requests the download without download-management permission. No permission is reserved for a future feature.

There is no extension action, popup, service worker, or extension messaging. Icons are declared at the manifest's top level. The packaged content script installs the page control on the routes below; order extraction happens only when the user clicks **Download CSV**, without polling or stored exports.

### Automatic content-script access

These are `content_scripts.matches` entries, not `host_permissions`. They cause the packaged download control to appear on the two declared order-detail routes:

| Match pattern                                                      | User-facing reason                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `https://trade.1688.com/order/new_step_order_detail.htm*`          | Display the download control on the declared legacy 1688 order-detail route. Export still requires a readable supported order layout. |
| `https://air.1688.com/app/ctf-page/trade-order-detail/index.html*` | Display the download control and read product rows on the current declared 1688 order-detail route.                                   |

The isolated automated test copy adds localhost access and download inspection for tests. Those additions are not part of the production permissions or the store submission package.

## Privacy & Data Use

### Data Collection

**Does the extension handle user data? Yes, locally.** It reads the selected order's website content to prepare the CSV. No developer-operated collection, off-device transmission, analytics, or persistent extension storage was found in the inspected production source. Do not answer “no data handling” merely because processing is local: Google's [user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) expressly includes local processing and website scraping.

| Data type                           | Accessed or processed?                                                                                             | Transmitted off-device by this extension? | Purpose                                               | Shared with third parties by this extension? |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------- | -------------------------------------------- |
| Personally identifiable information | Seller/member login name; order identifier; product text may contain identifying information                       | No                                        | Name the export and identify the open order           | No                                           |
| Health information                  | Not intentionally selected; arbitrary product descriptions are exported as website content                         | No                                        | No health-specific feature                            | No                                           |
| Financial information               | Product prices, quantities, item-row discounts, and purchase details in the open order                             | No                                        | Create the requested order CSV                        | No                                           |
| Authentication information          | No passwords, tokens, or authentication cookies; member names are disclosed above                                  | No                                        | None                                                  | No                                           |
| Personal communications             | Not intentionally selected                                                                                         | No                                        | None                                                  | No                                           |
| Location                            | No dedicated recipient-address or location extraction                                                              | No                                        | None                                                  | No                                           |
| Web history / browsing activity     | Current order-page URL and order identifier only; no history API, browsing log, or background tracking             | No                                        | Recognize a supported order page and its order number | No                                           |
| User activity                       | Responds to local download clicks; no interaction log or analytics                                                 | No                                        | Carry out the requested export                        | No                                           |
| Website content                     | Product image URLs, descriptions, variants, product numbers, prices, quantities, discounts, and seller/member name | No                                        | Create the requested CSV and filename                 | No                                           |

Production data handling is implemented in [src/extract.js](src/extract.js), [src/csv.js](src/csv.js), [src/page-download.js](src/page-download.js), and [src/content.js](src/content.js).

The page control prepares a fresh CSV in memory when clicked. The previous in-memory file URL is released before another export and on page navigation; replacing the control also releases it. The extension does not retain an order database or synchronize exports. A downloaded file remains on the user's device until the user deletes it. Normal browser download records are controlled by the browser.

The CSV contains product image URLs rather than downloaded images. The extension does not fetch those images for the export. Opening those links or importing them into another application may cause that application to make network requests; that is outside this extension's export operation.

### Data Use Certification

The inspected implementation supports these statements. The publisher must confirm and submit the actual Dashboard certifications:

- [ ] Data is not sold to third parties.
- [ ] Data is not used for purposes unrelated to the extension's order-export functionality.
- [ ] Data is not used for creditworthiness or lending purposes.

## Privacy Policy

**Privacy Policy URL** [REQUIRED BEFORE SUBMISSION]

Not provided. No privacy policy has been published or uploaded by this task. The policy must identify the actual publisher and contact address and describe the local data handling above. Verify that the final URL is publicly accessible before using it in the Developer Dashboard.

**Draft policy content for the publisher to complete**

```text
1688toCSV processes information from the 1688 order detail page you open to create a CSV when you request it. This includes product descriptions and image links, original prices, quantities, item discounts, the seller/member name, and the order identifier used in the interface and filename.

Processing takes place in your browser. The extension does not upload the order data to the developer or another service, use analytics, or retain an order database. Temporary export data is held in memory and released when replaced or when the page is left. Files you download remain on your device until you delete them.

The extension does not read passwords or authentication cookies. It does not submit, pay for, or change orders. Exported files may contain sensitive purchase information; you control how you store or share those files.

Product image links remain links in the CSV. Other applications may retrieve those images if you choose to open or import the links.

Publisher identity, effective date, privacy contact, and policy-change contact method must be supplied before this policy is published.
```

## Distribution

**Visibility:** Not selected. No public, unlisted, or private store distribution has been authorized or configured by this task.

**Regions:** Not selected.

## Developer Info

**Publisher Name** [REQUIRED]

Not provided; do not infer a legal publisher identity from the GitHub repository owner.

**Contact Email** [REQUIRED]

Not provided.

**Support URL / Email** [RECOMMENDED]

Not selected. Confirm a monitored public support route before submission.

**Homepage URL** [RECOMMENDED]

Candidate: [j3w1/1688toCSV repository](https://github.com/j3w1/1688toCSV). This is the verified repository remote, not a confirmed public store homepage or support commitment.

## Version History

No Chrome Web Store submission or publication history was established in this task. The following records the verified development version and its draft store-listing status.

| Version | Date       | Changes                                                                                                                                                                                     | Status                                                                                                    |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1.1.4   | 2026-10-13 | Add a persistent Download CSV control directly on supported order pages; prepare current order data on each download click; remove the popup, extension messaging, and all API permissions. | Draft store listing — local verification passed; live one-click download confirmed by user; not submitted |

## Review Notes

### Development Verification

- `npm run verify` passed against the production 1.1.4 build: source and documentation checks, 54 unit checks, and 10 Chromium browser scenarios.
- Browser tests checked completed CSV files, Chinese filenames and BOM, current row discounts including 47.20, repeated downloads, keyboard activation, malformed data, reinjection, URL cleanup, and the 320px layout.
- The same page control produced a completed synthetic CSV in the embedded browser with one click. The user then reloaded 1.1.4, refreshed a real 1688 order, and confirmed one click saved the CSV with no popup or second button. Agent access to the live page remained blocked by browser policy; this live result is user-reported.
- Focused independent source review found no actionable defects. These results establish the tested development flow, not Chrome Web Store acceptance or compatibility with every 1688 layout.

### Known Issues / Limitations

- Whole-order price adjustments, including 商品改价, are not allocated across product rows. The `Discount` column is a total for each item row, not a per-unit value.
- Export depends on the supported order-page structure. The purchased-orders list and account-wide export are outside scope. A declared legacy URL match does not establish live compatibility with every legacy page layout.
- One click on the page control requests the download. The browser may still show a file-location prompt or deny the save. “Save requested” is not proof that the file finished saving; cancellation is not retried automatically.
- Live acceptance covers the user's tested order and browser. Other order layouts, including legacy pages, still require their own acceptance checks.
- Publisher identity, contact, distribution settings, a public privacy policy, original or authorized store artwork, and store-sized screenshots remain unfinished. No submission ZIP or Dashboard entry was created by this task.
- For a future submission, package the verified production `dist` contents only. Exclude this document, repository metadata, source tooling, tests, private orders, and local test profiles.

### Rejection History

No store review or rejection history was provided or verified.
