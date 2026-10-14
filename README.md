# 1688toCSV

Collect your 1688 orders in a local spreadsheet, keep them up to date, and copy products and pictures into Excel.

<a href="screenshots/order-library.png"><img src="screenshots/order-library.png" alt="Order library with synthetic products and Excel copy controls" width="640" /></a>

<details><summary>Dark appearance</summary>
<a href="screenshots/order-library-dark.png"><img src="screenshots/order-library-dark.png" alt="Dark order library with synthetic products" width="640" /></a>
</details>

## Install or update

With **Node.js 24** installed, run these in the repository folder:

```sh
npm ci
npx playwright install --no-shell chromium
npm run verify
```

Open **Extensions → Developer mode → Load unpacked** and select **dist**. In Codex, find extensions under **Settings → Browser → Extensions**. After an update, reload the extension and refresh your 1688 tabs.

## Use it

1. Open your [1688 orders](https://work.1688.com/home/buyer.htm), tick the orders you want, and click **Import selected**. Keep the list open; a reader tab opens each order automatically.
2. Click **Spreadsheet ↗**. If the browser blocks the new tab, choose **Open spreadsheet here** after the import finishes.
3. Select orders or product rows, then click **Copy to Excel** and paste into a blank Excel range. With no row selection, all filtered rows are copied.
4. Use **Refresh all** to check every saved order, or **Refresh selected** for selected orders. Your previous data stays available if a refresh fails.

The columns are **Thumbnail · Description · Price · Quantity · Discount**. **Copy values** leaves the picture column blank; **Copy images** copies pictures separately. Each row's **Copy image** copies the original-size picture. Bulk pictures remain compact for Excel rows. Successful copy buttons turn green and say **Copied**.

Keep **Headers** checked for a heading row, or uncheck it when appending. The choice is remembered. Dividers between orders are visual only and are never copied.

Orders are grouped by purchase month with individual purchase dates. The sun/moon button switches light and dark appearance. Use **Dismiss all** to hide old import notices without removing saved orders; **Show dismissed** brings the history back. Bulk import is under **More import options** and requires confirmation.

## Keep your data

Orders, history, notes and cached pictures stay in this browser. Use **Back up** before uninstalling or clearing its profile, and **Restore** to bring a backup back. Use one buyer account per library.

Discounts include each product's reduction and its share of order-wide price changes; shipping stays separate. The detail-page **Download CSV** also remains available, with product discounts only.

For development commands, calculations and test coverage, see [development notes](docs/development.md). [Store preparation](CHROMEWEBSTORE.md) records permissions, privacy and publication status.
