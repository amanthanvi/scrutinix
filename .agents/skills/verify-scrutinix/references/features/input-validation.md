# Input validation

The scan box rejects empty, hostile, private, and over-long input before a request is sent. The batch box enforces the same URL rules and a cap of 10.

## Sub-features

- empty: whitespace on the single box, empty batch
- scheme: non-HTTP(S) URLs, including `javascript:`
- private-network: localhost, loopback, and internal hosts
- length: more than 2048 characters
- batch-cap: an 11th URL
- garbage-share: a `shared` query value that is not a snapshot

## How to get to it (user POV)

On Single, type into `URL to analyze` and press Enter or Analyze. The error replaces the quiet hint under the box. Analyze stays disabled while the box is empty, so the empty error comes from Enter on whitespace. On Batch, Ctrl+Enter or Start batch. A bad `?shared=` link still shows the empty scanner.

## Driving it with Playwright

`npm run verify:drive` test `hostile and empty inputs`. These steps must not create a `scrutinix-v2` row.

| Input                             | Visible error                                                    |
| --------------------------------- | ---------------------------------------------------------------- |
| whitespace, then Enter            | `Enter a URL to analyze.`                                        |
| `javascript:alert(1)`             | `Only HTTP and HTTPS URLs are supported.`                        |
| `http://127.0.0.1/admin`          | `Private, localhost, and internal network URLs are not allowed.` |
| a URL longer than 2048 characters | `URLs longer than 2048 characters are not supported.`            |
| Batch, Ctrl+Enter while empty     | `Add at least one URL.`                                          |
| 11 URLs                           | `Batch capped at 10 URLs.`                                       |

Then `page.goto("/?shared=not-a-snapshot")`. The scan box is visible and no `Scan result:` region exists.

Screenshot: `validation-hostile.png`.

End state: `historyState(page).urls` is `[]`, and the address is still `/` after `javascript:`.

## Gotchas

- `example.com` without a scheme is valid. The client normalizes it to `https://example.com/`. That is not an error.
- The Analyze button is disabled when the trimmed box is empty. Press Enter inside the box to reach the empty error.
- Batch Ctrl+Enter is `Control+Enter` in Playwright, including on Linux.
- A rate-limit response (`Rate limit exceeded. Please retry after the cooldown window.`) is a server error under the form, not a validation error. The default drive stays under the 10 per minute cap and does not assert that string. Exceeding the cap on purpose blocks later scans in the same minute.
- Live provider failures are `INCONCLUSIVE` while fixture mode is on. Fixture hostnames do not produce a validation error.
