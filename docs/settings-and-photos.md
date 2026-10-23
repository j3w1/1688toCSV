# Settings, recognition and photos

[Documentation](README.md) · [Packing](packing.md)

## Settings and language

Settings opens **Appearance**, followed by Labels, Product names, Size codes, Product colors, Materials, Tags and Data. The frame keeps its size between sections; long content scrolls while navigation, Close and Save remain reachable. Shared draft edits survive section/language switches. Choose **Save settings** to apply; a failed save retains the draft and reveals the invalid rule.

The header **A / 文 / Ñ** switches English, Chinese and Spanish while preserving open edits. Original seller text and saved label names stay intact. Popup language controls affect only that popup, nested previews and its exports; they do not change workspace or other popup language. Print jobs retain their output language.

Current mode/language, purchase-month filters, Headers, copy/export choices and Activity read state are browser preferences. Label rules, themes, badge colors and tag definitions belong to library settings and full backups. A floating panel's minimized state lasts for its browser-tab session.

**Chosen columns** exposes the same **Headers** preference in Orders and Packing. The popup shows its captured product-row count; later display selections do not change the copy in progress.

## Local recognition rules

All helpers run locally; there is no remote translation or AI service. They preserve source descriptions and money.

| Section        | What you can edit                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Product names  | Literal title rules producing Spanish names and Chinese categories. Unknown/conflicting products stay blank.                   |
| Size codes     | Seller aliases such as 小号 mapped to endings such as S; complete compatible measurements support size review.                 |
| Product colors | Seller aliases, English/Chinese/Spanish names and optional swatches.                                                           |
| Materials      | Seller aliases and English/Chinese/Spanish names. Confident suggestions only; authored values, including blank, take priority. |
| Labels         | Shared label text, dimensions, text size, image quality and logo.                                                              |

Rule tables search and scroll continuously. Draft values survive scrolling/search and Tab reaches offscreen rules; Save opens and focuses the rule needing correction. Naming-rule edits explicitly refresh automatic names; unrelated settings do not replace saved names. Manual values and intentional clears remain authored. Source color/size helpers never reinterpret model or article IDs as measurements.

Colors recognize configured trailing characters in Color fields, such as `安可拉红-35L（带盖有轮）`, and complete English names such as `Red-35L`. Specific shades take priority; `红酒杯` and `Redwine` do not become color matches. [Packing size review](packing.md#edit-and-review) describes measured sizes and No size difference.

## Appearance and tags

Choose Classic brown, Warm orange, 1688 orange, Soft apricot or Terracotta independently for light/dark mode. Classic brown uses the reference Excel brown headings, pale separators and light cells. Workbook/Excel-image output always uses the light palette of the currently selected mode's theme. Select Classic brown for both modes if you want that output in either mode. Printed label artwork keeps its own colors.

Customize date, delivery, Saved/Updated and Activity badges per mode; readable foregrounds adjust automatically. Reset individual badge colors as needed. The sun/moon toggle and floating import controls use saved workspace appearance.

**Tags** separates Order tags and Product tags. Order tags appear on cards/details; product tags appear in Products and its search, edited through Original product details. In a picker, type to filter, use arrows/Enter to choose or create, and remove assignments with a chip's ×. Rename only in Settings: pencil, new name, then Enter/check mark. Existing assignments and colors update together; duplicate names are rejected.

Set background/text colors per mode, choose **Randomize colors**, or **Auto** for readable text. New unused Settings tags remain available until used; after use, their final removed assignment removes the unused definition. **Delete globally** reviews the affected count before removing an assigned tag. Notes/tags autosave. Closing adds typed unfinished tags and waits for saving; failure keeps the draft with Retry. Leaving with unsaved annotations triggers the browser's exit warning. **Review operational tags** has a separate [explicit conversion workflow](operations.md).

<a href="../screenshots/settings.png"><img src="../screenshots/settings.png" alt="Synthetic label settings with text, dimensions, quality and logo controls" width="720" /></a>

## Product photos

Click a photo to view its original, zoom around the pointer, drag to pan, double-click to zoom, use Fit/100% or fullscreen, and browse Previous/Next. Orders browses the full filtered product list; Packing views the selected immutable container revision. Viewing and copying leave selection intact. The small photo-copy control copies without opening the viewer.

In Orders, **Edit photo** retains all originals while saving a square composition. Fit/crop, scale, position and background preserve proportions. Cancel leaves the saved version unchanged. A product gallery keeps full assigned-code/source context visible as you browse. Refresh retains edits while the original source photo remains unchanged.

Use A–E and size buttons to compose tags such as AS/BL, or type a custom code. Click the product in the photo to place a tag; its badge starts in the nearest corner with its full footprint inside the canvas. Drag the dot and label independently. Arrows fine-tune, Shift moves farther; edit/trash controls rename/remove a selected tag. Tags also accept one-line free text up to 64 characters, preserving case and punctuation, such as `大盘 · 8.5"` or `Small / blue`. They never change the actual barcode.

Tags use black leaders, white-center black dots and rounded black badges with bold white text. **Invert pointer** swaps leader/dot colors for dark products while retaining black/white badges. **Tag size** scales all badges, dots and leaders in that photo from 60%–600%; **Pointer size** independently scales dots from 50%–400%. Fixed percentage stops make changes repeatable. New/reset compositions start at 200% tags and 100% pointers; saved/legacy scales remain unchanged.

**Add size tag** immediately saves the recognized original source size, with its label bottom-right and pointer 75% across/50% down. It retains composition and existing tags; use Edit photo to adjust later. Missing recognition and duplicate size text disable it with an explanation. Assigned barcode endings do not supply source size.

Transforming a photo keeps tag points attached to its source product. Adjust a crop that hides a point before saving. **Save photo** commits composition/tags for thumbnails and photo copies; originals and galleries remain available and survive backups. Deleting an order removes its unreferenced local originals while retaining photos owned by other orders/history. [Backup selection](data-and-backups.md#photos-and-file-size) covers remote originals too.

Packing omits photo/tag mutation controls and offers **Edit in Orders** with a retained container return route. Sealed reprints use historical media rather than current photo edits.

Original product details also exposes source descriptions/attributes, photos and exact numeric values for copying. Display translations and recognized helpers do not rewrite source-value exports.
