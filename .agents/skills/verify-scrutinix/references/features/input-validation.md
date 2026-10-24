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

On Single, type into `URL to analyze` and press Enter or Analyze. The error appears under the box as `#sx-url-error`. Analyze is never disabled at rest, so an empty submit, by click or Enter, shows the empty error. On Batch, Ctrl+Enter or Start batch. A `?shared=` value that does not decode still shows the plain scanner.

## Driving it with Playwright

`npm run verify:drive` test `hostile and empty inputs`. These steps must not create a `scrutinix-v2` row.

| Input                             | Visible error                                                           |
| --------------------------------- | ----------------------------------------------------------------------- |
| whitespace, then Enter            | `Paste a link to check.`                                                |
| `javascript:alert(1)`             | `Only web links (http or https) can be checked.`                        |
| `http://127.0.0.1/admin`          | `Links to your own computer or private network can't be checked.`       |
| a URL longer than 2048 characters | `That link is too long to check (over 2,048 characters).`               |
| Batch, Ctrl+Enter while empty     | `Paste at least one link to check.`                                     |
| 11 URLs                           | `That's 11 links. A batch checks up to 10 — remove some and try again.` |

Then `page.goto("/?shared=not-a-snapshot")`. The scan box is visible and no `Scan result:` region exists.

Screenshot: `validation-hostile.png`.

End state: `historyState(page).urls` is `[]`, and the address is still `/` after `javascript:`.

## Gotchas

- `example.com` without a scheme is valid. The client normalizes it to `https://example.com/`. That is not an error.
- Batch Ctrl+Enter is `Control+Enter` in Playwright, including on Linux.
- A rate-limit response is a server error under the form, not a validation error. The drive gives each test its own client address, so it never reaches the 10 per minute cap and does not assert that copy.
- Live provider failures are `INCONCLUSIVE` while fixture mode is on. Fixture hostnames do not produce a validation error.
