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
2. Click **Open Workspace**. If a new tab is blocked, use **Open Workspace here** after the import finishes.
3. In **Orders**, filter purchase months, choose orders, then select the product rows to pack. **Ctrl+A** in the product table selects all filtered products across orders and pages.
4. Set **Packing month**, check the product/order count beside **Prepare packing list**, and open it. Preparation becomes the main view. If existing codes must change, review the photos and old/new codes before confirming.
5. Arrange groups and products, review names and labels, then copy from the top toolbar. **Changes save automatically**. Use **Back up packing** when finished.

Purchase-month filters start with the current month and remember your choice across reloads. **Packing month** starts at the current month whenever the workspace opens; it is independent of purchase dates. October purchases can therefore receive December codes. Only the selected products move; a partly selected group splits so its unselected products keep their codes. With no product rows selected, **Prepare packing list** reopens products already assigned to that packing month, across saved orders. It does not select purchases by date.

<a href="screenshots/preparation.png"><img src="screenshots/preparation.png" alt="Prepare packing list with synthetic photos, editable product names and label previews" width="640" /></a>

Known products receive Spanish names and Chinese categories automatically; unknown products stay unnamed. The **product code heads each group**, with its editable Spanish name and Chinese category below. Click photos to zoom and drag. Edit label text and variant/size endings directly in the previews. Resolve uncertain size codes before copying. **Undo** and **Redo** cover pending edits until autosave completes. Invalid edits stay visible; returning to Orders waits for a successful save.

Each variant shows its source **unit price and quantity**, without a discount field. Shared barcodes show the distinct unit prices and combined quantity of the source rows in the open packing. Selection uses a subtle tint, a narrow edge and a group check mark. Hover help closes when the pointer leaves; keyboard help remains available.

Drag groups within their order, or products within their group. Moving them changes export order without changing codes. **Reset order and codes** restores that order's default grouping, order and codes while retaining names on matching groups. **Restore previous packing** restores the setup saved before its latest packing-month move, including that setup's names and codes. Both show the affected products before applying changes.

An issued code remains reserved even after a product changes codes or is removed. **Resolve** shows the original owner with photos and explains the reservation; open that product, restore your saved code or use the next available code. **Reload saved version** discards the failed draft without another confirmation.

**Open selected order** is enabled for exactly one chosen packing order and reuses one 1688 tab. **Copy order number** copies its full identifier. Orders marked **Seller unavailable** need a seller member login before label codes can be assigned.

**Settings → Product names** edits local naming rules; **Size codes** maps seller size names such as 小号 to endings such as S. Both tables have search and pages of 12. Measurements are compared automatically; unclear or mixed assortments stay for review. Your manual names and size mappings remain unchanged. **Labels** holds shared text, dimensions, text size, image quality and logo. Click **Save settings** to apply changes.

<details><summary>Label settings</summary>
<a href="screenshots/settings.png"><img src="screenshots/settings.png" alt="Compact label settings with shared text, dimensions, text-size controls and logo" width="640" /></a>
</details>

## Select, review and refresh

Click a row to select it; click it again to deselect. **Shift-click** selects a range, and **Ctrl-click** adds or removes individual rows. Buttons and photos work independently. Double-click an order, or press **Enter**, to open its details.

Filter one or more purchase months; **Shift-click** filters a month range. Click a month heading to collapse its orders. The current month starts expanded. Seller/order search, product search, status and date filters update the summary below the products table: it counts each complete matching order once, including its shipping and order discounts.

Store-order bands separate the products with the seller name, full order number and matching-product count. They remain distinct when rows are selected and do not enter copied data or selection ranges.

Use the contextual **Refresh** action for selected orders or the current filters. Full-library refresh is in **Settings → Data**. Multi-order imports and refreshes confirm their scope before starting; copying needs no confirmation. **Activity** holds progress, Pause/Resume and **Save import report**; the report button is also on the 1688 order page. Retry preserves successful saves.

<details><summary>Import progress</summary>
<a href="screenshots/import-progress.png"><img src="screenshots/import-progress.png" alt="Synthetic collection progress showing saved products and the latest result" width="300" /></a>
</details>

## Copy into Excel

| Action                                          | Result                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| **Copy values**                                 | Five source columns: photo placeholder, description, price, quantity and discount |
| **Copy images** / **Copy to Excel**             | Separate pictures, or the source columns with pictures                            |
| **Copy Excel image**                            | One table picture with Chinese headings, thumbnails and saved packing values      |
| **Copy preparation columns** / **Copy columns** | Your chosen packing and source columns; one base code per product group           |
| **Copy group codes**                            | One base code per group                                                           |

Copy buttons keep their size while working and showing success. Detailed progress and Cancel appear beside the action without moving the toolbar. Chosen columns and Headers remain selected after copying, reopening and reloading.

Orders-view copy actions use selected product rows, or all filtered rows when none are selected. In **Prepare packing list**, the top copy toolbar uses only selected groups or products in the displayed packing orders; its buttons are disabled when nothing is selected. **Ctrl+A** selects all products in that packing view. **Headers** starts off and remembers your choice, as does the column chooser. Copy actions have no confirmation warning; the column chooser and numbered image-batch chooser remain available. Successful buttons show **Copied**. Pictures paste as floating images.

**Copy Excel image** is available in both views. It uses centered Chinese headings, including **唛头货号** and **条码货号**, wrapped product descriptions and bold quantities. Manually reordered groups/products have blue product-code text in the exported image. Large tables offer numbered batches. Barcode and carton-mark pictures have their own copy actions.

<a href="screenshots/label-editor.png"><img src="screenshots/label-editor.png" alt="Editable barcode with a synthetic CE code and Spanish name" width="480" /></a>

## Keep your data

Use **Settings → Data → Back up** for the complete library. **Back up packing** exports the orders included in the open packing, retaining their other products for a safe restore. Backups include preparation, naming and size rules, settings and reserved codes. **Restore** rejects conflicting ownership without partially importing the file; an older backup cannot free issued codes. Refreshes preserve edits. Use one buyer account per library.

Data and naming rules stay local; there is no online translation service. The sun/moon button switches between dark and light appearance. The detail-page **Download CSV** remains available.

See [development notes](docs/development.md) for calculations, code allocation and testing, and [store preparation](CHROMEWEBSTORE.md) for permissions and publication status.
