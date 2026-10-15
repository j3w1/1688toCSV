# 1688toCSV

Keep your purchases in the **1688 Packing workspace**, prepare product codes and labels, and copy what you need into Excel.

<a href="screenshots/order-library-dark.png"><img src="screenshots/order-library-dark.png" alt="1688 Packing workspace with synthetic products, order totals and Excel copy controls" width="640" /></a>

<details><summary>Light appearance</summary>
<a href="screenshots/order-library.png"><img src="screenshots/order-library.png" alt="1688 Packing workspace in light appearance" width="640" /></a>
</details>

## Install or update

With **Node.js 24** installed, run these in the repository folder:

```sh
npm ci
npx playwright install --no-shell chromium
npm run verify
```

Open **Extensions → Developer mode → Load unpacked** and select **dist**. In Codex, find extensions under **Settings → Browser → Extensions**. After an update, reload the extension and refresh your 1688 tabs.

## Import and prepare

1. Open your [1688 orders](https://work.1688.com/home/buyer.htm), tick the orders you want, and choose **Import selected**. Confirm the count and keep the list open while the reader tab works.
2. Open **Spreadsheet ↗**. If a new tab is blocked, use **Open spreadsheet here** after the import finishes.
3. Choose your orders, check the **Packing month** and click **Prepare packing list**. New preparation starts with the current month; existing codes keep their saved month.
4. Review the photos, names and codes. Known products receive Spanish names and Chinese categories automatically. Unknown products stay unnamed. The **product code heads each group**, with its editable Spanish name and Chinese category below. **Changes save automatically**.

<a href="screenshots/preparation.png"><img src="screenshots/preparation.png" alt="Prepare packing list with synthetic photos, editable product names and label previews" width="640" /></a>

Click photos to zoom and drag. Edit labels from their previews, including variant and size code endings. Resolve any size-code prompt before copying. **Undo** and **Redo** cover pending edits until autosave completes. Invalid entries stay visible; closing waits for a successful save.

Use **Open selected order** beside the order chooser to open that order on 1688; it reuses one tab. Orders marked **Seller unavailable** need a seller member login before label codes can be assigned.

**Settings → Product names** lets you search and edit local naming rules, 12 at a time. Your manually edited names remain unchanged. **Labels** holds shared text, dimensions, text size, image quality and logo; click **Save settings** to apply changes.

<details><summary>Label settings</summary>
<a href="screenshots/settings.png"><img src="screenshots/settings.png" alt="Compact label settings with shared text, dimensions, text-size controls and logo" width="640" /></a>
</details>

## Select, review and refresh

Click a row to select it; click it again to deselect. **Shift-click** selects a range, and **Ctrl-click** adds or removes individual rows. Buttons and photos work independently. Double-click an order, or press **Enter**, to open its details.

Choose one or more purchase months; **Shift-click** selects a month range. Click a month heading to collapse its orders. The current month starts expanded. Seller/order search, product search, status and date filters update the summary: it counts each complete matching order once, including its shipping and order discounts.

Use the contextual **Refresh** action for selected orders or the current filters. Full-library refresh is in **Settings → Data**. Bulk actions show their scope before starting. **Activity** holds progress, Pause/Resume and **Save import report**; the report button is also on the 1688 order page. Retry preserves successful saves.

<details><summary>Import progress</summary>
<a href="screenshots/import-progress.png"><img src="screenshots/import-progress.png" alt="Synthetic collection progress showing saved products and the latest result" width="300" /></a>
</details>

## Copy into Excel

| Action                              | Result                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| **Copy values**                     | Five source columns: thumbnail placeholder, description, price, quantity and discount |
| **Copy images** / **Copy to Excel** | Separate pictures, or the source columns with pictures                                |
| **Copy Excel image**                | One table picture with Chinese headings, thumbnails and saved packing values          |
| **Copy preparation columns**        | Your chosen packing and source columns; one base code per product group               |
| **Copy group codes**                | One base code per group                                                               |

Workspace copy actions use selected product rows, or all filtered rows when none are selected. Inside **Prepare packing list**, copy actions use the current order's selected groups or variants, or all its rows when none are selected. **Headers** starts off and remembers your choice. Successful buttons show **Copied**. Pictures paste as floating images.

**Copy Excel image** is also available inside **Prepare packing list**. It always includes Chinese headings for row number, picture, description, carton code, barcode number, Chinese category, price and quantity. Large tables offer numbered batches. Barcode and carton-mark pictures have their own copy actions.

<a href="screenshots/label-editor.png"><img src="screenshots/label-editor.png" alt="Editable barcode with a synthetic CE code and Spanish name" width="480" /></a>

## Keep your data

Use **Settings → Data → Back up** before uninstalling, clearing the browser profile or moving computers. **Restore** brings back your orders, preparation and reserved codes. Refreshes preserve edits. Use one buyer account per library.

Data and naming rules stay local; there is no online translation service. The sun/moon button switches between dark and light appearance. The detail-page **Download CSV** remains available.

See [development notes](docs/development.md) for calculations, code allocation and testing, and [store preparation](CHROMEWEBSTORE.md) for permissions and publication status.
