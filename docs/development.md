# Development

Use Windows-native Node.js 24 and the workflow in [AGENTS.md](../AGENTS.md). Edit sources, rebuild explicitly, then test the generated **dist** extension. There is no watch mode.

| Command                               | Purpose                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run verify`                      | Source/docs checks, unit tests, production rebuild and isolated Chromium tests |
| `npm run build` / `npm run build:dev` | Build the complete extension once into dist                                    |
| `npm run test:browser`                | Test the current build with synthetic pages in a temporary profile             |
| `npm run test:excel`                  | Windows Excel integration check in an unsaved workbook; restores the clipboard |
| `npm run preview`                     | Synthetic preview; `/library.html` opens the spreadsheet                       |
| `npm run screenshots`                 | Regenerate the two README images using synthetic data                          |
| `npm run check:docs`                  | Validate local links, screenshots and documented commands                      |

For UI changes, regenerate screenshots and check documentation after final verification. Keep the main README practical; record only necessary developer constraints here. Do not commit private orders, exports, captures, profiles or credentials.

[CI](../.github/workflows/ci.yml) routes docs-only changes to documentation checks, code to full verification, and mixed changes to both. Its stable `required` check rejects failures, cancellations and unexpected skips. Desktop Excel is tested locally, not in hosted Linux CI.

## Boundaries

Page adapters extract and validate source data. Monetary calculations use exact cents. IndexedDB stores snapshots, history, notes and import checkpoints. The import controller owns bounded retries and tab navigation; the library owns filtering and clipboard presentation. Add layout support in adapters and synthetic fixtures, keeping selectors out of the library UI.

Full order and product-entry IDs remain strings. Only complete snapshots that reconcile with displayed totals replace saved data. Changed data creates a retained version; notes and tags remain separate. Failed reads preserve the last good snapshot. Purchase dates describe the source order, not the time it was imported; unknown dates remain unknown until a successful refresh supplies them. Once established, purchase time stays fixed across list and detail reads.

Imports use one visible, marked reader tab. Preserve tabs navigated away from the importer and never resume saved bulk queues automatically. The embedded browser can reject new tabs; the current-tab spreadsheet action refuses to replace a tab used by a running import. Dismissing an import notice hides it without deleting its job or order records.

## Copying and calculations

Copying includes selected product rows, or all filtered rows across pagination when none are selected. Headers follow the remembered checkbox. Order dividers are presentation only. Product images use original CDN sources; individual image copying preserves their pixels, while bulk images use a compact display size for standard Excel rows. They paste as separate floating pictures, not native in-cell images.

Price is the original unit price. Discount is the total reduction for a product row: an explicit item discount plus its allocated share of a whole-order adjustment. Allocation is proportional after item discounts, with deterministic cent rounding; price increases produce negative allocations. Shipping remains separate. Unknown financial fields, unsupported installments and inconsistent totals fail validation. Legacy CSV exports item discounts only.

Backups include records, history, notes and cached pictures; import jobs are not restored. Restore validates the complete file, preserves existing notes and merges newer observations. Removing an order removes its history; shared images can remain cached. Unfetched pictures require a connection. One buyer account per library is supported.

## Browser verification

Packaged tests exercise selection, navigation, extraction, persistence, spreadsheet copying, delayed rendering and failed-job retry. The isolated test copy substitutes reserved `.test` domains and serves synthetic pages locally. Test-only permissions and hosts never enter the production build. Remote requests are blocked. Run clipboard browser suites and the desktop Excel check sequentially so they cannot overwrite each other's clipboard.

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
