# History

Completed scans saved in IndexedDB on this device. Search, export, clear, and undo. An older database name is migrated once.

## Sub-features

- empty: no rows yet; the region exists and draws nothing
- list: one row per link (a re-scan replaces the earlier entry): the mini strip, the verdict word (`Look-alike` or `Unconfirmed` where the band says so, `—` while the address check loads), the link with its registered domain in bold, and the time. Click a row to open that result: focus moves to its verdict heading and the live region announces it. The row's name is `<word> <link>[, belongs to <owner>, not <site>], checked <time>`; a link whose path runs past 48 characters is spoken as its host and first 40 path characters, any run of four or more of one symbol in them said once, then `, and <n> more characters` (`…/verify/, and 1471 more characters` for `/verify`, 1,500 slashes, `step`). The full link shows on hover, from an `aria-hidden` title; the drawn subdomain, owner, and path are each `aria-hidden` too, since Safari ignores it on the `display: contents` wrapper and read the link twice
- filter: searchbox `Filter scan history`, visible after more than 3 saved scans
- export: CSV and JSON of the visible rows
- clear-undo: confirm, then undo in the same session. Each removes the button pressed, so focus moves to the one that reverses it (`Undo clear history`, then `Clear all history`), and the status region (`p[role='status']`) says `History was cleared. Undo restores the previous list.` or `History restored.`
- legacy: `malicious-url-detector-v2` migrates into `scrutinix-v2` and the old database is removed; an entry saved before per-check results were kept opens with a plain note instead of a strip

## How to get to it (user POV)

History is the region under the scanner on `/`. With no scans it draws nothing. After a scan, the URL appears in the list under `History` with its count (the heading's name is `History (1 scan)`, set by `aria-label`). Scanning the same link again keeps one row. After four scans, a filter box named `Filter scan history` appears. Clear asks for a second click (`Confirm clear`). `Undo clear` restores the list. Export downloads `scan-history.csv` or `scan-history.json`.

## Driving it with Playwright

`npm run verify:drive` tests `legacy history migration` and `verdicts and history`.

Legacy, before the first navigation, seed `malicious-url-detector-v2` version 1, store `scans`, key `id`. The drive seeds this row (`threatInfo` is optional; the rest is the smallest row that survives sanitizing):

```json
{
  "id": "legacy-example",
  "url": "https://legacy.example/",
  "verdict": "safe",
  "signals": {},
  "threatInfo": {
    "verdict": "safe",
    "summary": "Legacy history row kept on this device."
  },
  "metadata": { "scanId": "legacy-example" },
  "savedAt": "2026-03-21T00:00:00.480Z"
}
```

After load, the history region has a row button for `legacy.example`, `indexedDB` database names include `scrutinix-v2`, and they do not include `malicious-url-detector-v2`. Clicking the row shows `This scan was saved before per-check results were kept, so its eight checks can't be shown. Re-scan for a fresh result.` and no toolbar `Checks`.

Four fixture scans (`malicious.scrutinix.test`, `unreachable.scrutinix.test`, `feed-hit.scrutinix.test`, `example.org`) make the filter appear and the heading read `History (4 scans)`. Reload. `historyState` still has 4 URLs. Filter `unreachable` hides `example.org`. Filter `no-such-host-zzz` shows `No scans match this filter.` `Export history CSV` contains both hosts. Click the `malicious.scrutinix.test` row: focus moves to the `Malicious` verdict heading, and the live region (`p[aria-live='polite']` in region `Results`) reads `Result for malicious.scrutinix.test: Malicious, <n> out of 100. Don't open this link.` After undo, About, Privacy, and the wordmark back to `/` leave all four rows in place. Clear (`Clear all history`, then `Confirm clear all history`), then IndexedDB `urls` is `[]`. `Undo clear history`, then length is 4 again.

Screenshots: `history-legacy.png`, `history-filtered.png`, `history-cleared.png`, `history-restored.png`. Evidence file: `scan-history.csv`.

## Gotchas

- The filter counts saved scans, not the rows currently shown. Clearing the filter text brings the rows back. The box hides again only when the saved count drops to 3 or fewer.
- Clear is two clicks. The first only arms confirm for a few seconds. Click `Confirm clear all history` before that timer.
- Undo lasts until the page reloads or a new result is saved: a scan or a batch result after a clear drops the undo. The drive undoes right after confirming.
- Export while a filter is active downloads the filtered rows and the button name becomes `Export filtered history CSV`. The drive exports with an empty filter.
- Row buttons have no separate aria-label. Their accessible name is the verdict word, the link, and `, checked <time>` together. Match rows with `getByRole("button", { name: /host/ })`: plain text matches also hit the compact link anatomy.
- On a narrow row the subdomain is cut from its left so the registered domain (`[data-part="owner"]`) is never cut.
- A legacy entry draws empty glyph slots and the note, never eight "failed" cells. A real scan whose eight checks all failed still draws its eight cells.
- History writes are async. Poll IndexedDB instead of reading it once on the next line.
