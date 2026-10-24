# History

Completed scans saved in IndexedDB on this device. Search, export, clear, and undo. An older database name is migrated once.

## Sub-features

- empty: no rows yet; the region exists and draws nothing
- list: one row per link (a re-scan replaces the earlier entry): verdict, URL, and time. Click a row to open that result
- filter: visible after more than 3 saved scans
- export: CSV and JSON of the visible rows
- clear-undo: confirm, then undo in the same session
- legacy: `malicious-url-detector-v2` migrates into `scrutinix-v2` and the old database is removed

## How to get to it (user POV)

History is the region under the scanner on `/`. With no scans it draws nothing. After a scan, the URL appears in the list under `History (1 scan)`. Scanning the same link again keeps one row. After four scans, a filter box named `Filter scan history` appears. Clear asks for a second click (`Confirm clear`). `Undo clear` restores the list. Export downloads `scan-history.csv` or `scan-history.json`.

## Driving it with Playwright

`npm run verify:drive` tests `legacy history migration` and `verdicts and history`.

Legacy, before the first navigation, seed `malicious-url-detector-v2` version 1, store `scans`, key `id`. The smallest row that survives sanitizing is:

```json
{
  "id": "legacy-example",
  "url": "https://legacy.example/",
  "verdict": "safe",
  "signals": {},
  "metadata": { "scanId": "legacy-example" },
  "savedAt": "2026-03-21T00:00:00.480Z"
}
```

After load, the history region has a row button for `legacy.example`, `indexedDB` database names include `scrutinix-v2`, and they do not include `malicious-url-detector-v2`.

Four fixture scans (`malicious.scrutinix.test`, `unreachable.scrutinix.test`, `feed-hit.scrutinix.test`, `example.org`) make the filter appear and the heading read `History (4 scans)`. Reload. `historyState` still has 4 URLs. Filter `unreachable` hides `example.org`. Filter `no-such-host-zzz` shows `No scans match this filter.` `Export history CSV` contains both hosts. Click the `malicious.scrutinix.test` row: focus moves to the `malicious` verdict heading. Clear (`Clear all history`, then `Confirm clear all history`), then IndexedDB `urls` is `[]`. `Undo clear history`, then length is 4 again.

Screenshots: `history-legacy.png`, `history-filtered.png`, `history-cleared.png`, `history-restored.png`. Evidence file: `scan-history.csv`.

## Gotchas

- The filter counts saved scans, not the rows currently shown. Clearing the filter text brings the rows back. The box hides again only when the saved count drops to 3 or fewer.
- Clear is two clicks. The first only arms confirm for a few seconds. Click `Confirm clear all history` before that timer.
- Undo lasts for this page session. A reload after confirm, before undo, cannot restore. The drive undoes before leaving the page.
- Export while a filter is active downloads the filtered rows and the button name becomes `Export filtered history CSV`. The drive exports with an empty filter.
- Row buttons have no separate aria-label. Their accessible name is the verdict, the URL, and the time together. Match rows with `getByRole("button", { name: /host/ })`: plain text matches also hit the compact link anatomy.
- History writes are async. Poll IndexedDB instead of reading it once on the next line.
