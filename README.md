# 1688toCSV

Prepare your 1688 purchases for packing: keep orders together, assign CE product codes, edit labels, and copy the results into Excel.

<a href="screenshots/order-library-dark.png"><img src="screenshots/order-library-dark.png" alt="Preparation workspace with synthetic products, codes and Excel copy controls" width="640" /></a>

<details><summary>Light appearance</summary>
<a href="screenshots/order-library.png"><img src="screenshots/order-library.png" alt="Preparation workspace in light appearance" width="640" /></a>
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

1. Open your [1688 orders](https://work.1688.com/home/buyer.htm), tick the orders you want, and choose **Import selected**. Confirm the count when asked and keep the list open while the reader tab works.
2. Open **Spreadsheet ↗**. If a new tab is blocked, use **Open spreadsheet here** after the import finishes.
3. Choose the orders to prepare, check the **Packing month** (the current month by default), and click **Prepare labels**. This month controls new CE codes; saved preparation keeps its assigned month.
4. Review the suggested product groups, variants and sizes. Set a short Spanish name and Chinese category, then **Save preparation** to assign codes. Merge or split groups when the suggestions need correction.

Resolve any **Choose a size code** prompt before copying labels. Names and codes remain editable after saving.

## Edit labels and copy to Excel

Click **Barcode** or **Carton mark** and edit the preview. **Enter** or leaving the field saves; **Escape** cancels the edit. Click **Copy label**, then paste into Excel. Click the dimmed background to close an overlay. **Settings** controls dimensions, resolution, logo and vocabulary.

<a href="screenshots/label-editor.png"><img src="screenshots/label-editor.png" alt="Editable barcode label with synthetic CE code and Spanish product name" width="480" /></a>

| Copy action                         | What to paste                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Copy values**                     | Thumbnail placeholder, description, displayed unit price, quantity and discount                                                  |
| **Copy images** / **Copy to Excel** | Separate product pictures, or the five source columns with pictures                                                             |
| **Copy preparation columns**        | Your chosen code, barcode, description, Spanish description and financial columns; the base code appears once per product group |
| **Copy group codes**                | One base code per group                                                                                                         |

Select rows to limit a copy; otherwise all filtered rows are used. **Headers** starts off and remembers your choice. Batch actions ask for confirmation. Pictures paste as floating images; successful buttons show **Copied**.

Search orders by seller or order number and filter by purchase month or date range, then use **Refresh matching orders**. You can also refresh selected orders or all orders. Use **Activity** to pause, retry or dismiss imports, or **Save import report** to inspect every result. Retry keeps successful saves and revisits failures. The sun/moon button changes the default dark appearance.

## Keep your data

Data stays in this browser. Use **Data → Back up** before uninstalling, clearing its profile or moving computers; **Restore** brings it back with your reserved codes. Refreshes preserve your preparation edits. Use one buyer account per library.

Discounts include each product's reduction and its share of order-wide price changes. Reductions already reflected in prices or discounts are counted once. Order-only shop discounts, shipping, customization charges and red-packet reductions (红包) stay separate in order totals. The detail-page **Download CSV** also remains available, with product discounts only.

For development commands, code allocation, backups and test coverage, see [development notes](docs/development.md). [Store preparation](CHROMEWEBSTORE.md) records permissions, privacy and publication status.
