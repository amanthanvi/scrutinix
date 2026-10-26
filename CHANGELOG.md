# Changelog

Notable changes to Scrutinix. Versions follow the product's major relaunches and releases; dates are UTC.

## [4.1.0] - 2026-10-26

Scrutinix 4.1.0 closes what 4.0.0 left untested or open. Every item below was found with real screen readers, a real Android share sheet, the iPhone Shortcut, live provider scans, or Firefox and WebKit, and is fixed with a test that fails without it.

### Fixed

- **Screen readers.** Checked with VoiceOver in Safari and TalkBack on Android:
  - Reading down the page no longer switches to Batch: Single and Batch change only when chosen.
  - The parts of a link are read with their captions, and "This link belongs to …, not …" is read in one piece.
  - Share, Download and history Clear/Undo are announced once (VoiceOver said nothing; TalkBack said "Close toast" and then everything twice).
  - Arriving with a link says which link was filled in.
  - The result is announced once and doesn't repeat ahead of the band; checks are no longer counted aloud one by one.
  - Strip cells, rows and the theme button are named once, lists are announced as lists in Safari, and a long link in history is shortened when read.
  - "Expecting a particular site?" answers after you stop typing.
- **Nothing moves when a scan lands.** On phones the verdict band changed height when the verdict arrived. It now holds the room of the verdict it could still become, at every width and text size, in Chromium, Firefox and WebKit. A coverage caveat, when a result has one, is the one thing that can still add a line.
- **A shared result says what the sender saw.** A verified share used to soften "Looks safe to open." to "Probably safe" and drop "it's a known threat". The facts behind the instruction are now signed into the link. Links shared before 4.1.0 keep the cautious wording.
- **An Error result** no longer shows a Summary/Full switch that points at Summary; its band offers **Try again**.
- **Plain http:// links** were always marked partly checked, never cached, because the certificate check knocked on port 80. It now checks the site's HTTPS, as browsers do.
- **Checks read more plainly.**
  - A threat feed that lists only other links on the same site is a warning sign (hatched), not a red flag.
  - Certificate problems are sentences ("The certificate expired about 11 years ago"), not OpenSSL codes.
  - A domain with no registration lookup service is no longer reported as having no record.
  - An ordinary IPv4 + IPv6 answer is no longer "unusual".
  - What to do follows the threat the lists name: a malware site says not to download anything, a card skimmer says not to enter payment details, and only phishing is reported as phishing.
- **The link pattern model** read a third of popular sites, most official short links and half of sign-in links as phishing. It now reads the host and path against a bar set on ordinary links of every shape, so it adds points to about 1.5 in 100 ordinary links. It catches fewer phishing links on its own (OpenPhish 80% → 35%); reputation sources still convict, and `/about` prints the rates. A lure written to look like an ID (`/PayPalSecureLogin`, `/P4y7P4l`) still reaches it.
- **Link previews and the app** state the headline, "Is this link what it says it is?", instead of the old tagline.
- **Share cards** fit long registered domains, keeping the end that names the site.

### Added

- A share from your phone with no link in it says so in one quiet line.
- The iPhone Shortcut steps match iOS 26 (tested on an iOS 26.5 simulator against production).
- The test suite runs in Chromium, Firefox and WebKit, on macOS and Linux, and CI runs Firefox and WebKit next to the required checks.

### Quality

- First-load JavaScript is 233,517 B gzipped, under the 234,000 budget, after moving export formats and the link breakdown into on-demand chunks and drawing four icons inline.
- Unit 816, integration 60, DOM 156 and e2e 78 tests per engine.

## [4.0.0] - 2026-10-25

Scrutinix 4.0.0 asks one question of every link: **is this link what it says it is?** It has a new editorial look, answers in plain words, and tells you which site a link really belongs to before you scan it.

### What's new

- **A new look.** The editorial fact-checker identity, chosen through a 16-draft blind bake-off. The serif is Newsreader, and the rest of the type uses system fonts. The verdict band states the registered domain under the verdict, and the eight checks are a numbered strip that every answer cites.
- **The link, taken apart as you paste it.** Before any scan, Scrutinix shows each part of a link with a caption ("A label anyone can add", "Registered domain", "A page on that domain"), and says plainly when the link only spells out another site's name. "Expecting a particular site?" compares the domain you expected with the one the link really belongs to.
- **Summary as five plain questions.** "Has it been reported?", "Where would it take me?", "What else raises concern?", "Does HTTPS make it safe?" and "What did the other checks find?" Each check is cited by exactly one question, and the evidence it already collects (the hosting network, feed listing dates, the leaf certificate) is now shown.
- **Honest verdicts.**
  - A Safe link that imitates another site reads **Look-alike** everywhere, with its own score kept in the details.
  - When the address check can't run, a Safe link reads **Unconfirmed**.
  - VirusTotal's flagging engines are listed first, and the claims are tighter throughout.
- **Signed share links.** A shared result shows its verdict only when Scrutinix signed it, and only for 3 days. An edited, unsigned or older link opens as a link to check yourself, so nobody can make a phishing link preview as "Safe".
- **Send links to Scrutinix from your phone.**
  - Android: install the site, then use Share → Scrutinix.
  - iPhone: a Shortcut you build from the steps in the README.
  - Desktop: a bookmarklet.
  - All of these, and any `/?url=` link, fill in the link and take it apart, then wait for you to tap Analyze. Nothing else can start a scan in your browser.
- **Open methodology.** `/about` publishes every weight, rule, band and confidence cap, printed from the engine's own tables. A test runs each one through the verdict engine, so the page can't drift from the code. It also says how to pronounce the name: SCROO-tih-nix, from scrutiny.

### Quality

- **Accessibility.**
  - Larger default text reflows instead of scrolling sideways, at 150% and 200% from a 320px phone, with wide (Linux) and narrow (macOS) fonts.
  - axe reports zero violations in both themes.
  - Every check's accessible name matches what it shows on screen (WCAG 2.5.3).
  - On phones, arriving with a link focuses Analyze, so the keyboard doesn't cover the link.
- **Speed.**
  - No web fonts for body text.
  - Batch, history and notifications load lazily.
  - A bundle budget is enforced in CI: 233,165 B of gzipped JS against 234,000, and 46,864 B of fonts against 48,000.
  - Lighthouse: Performance 0.95, Accessibility 1.00, Best Practices 0.96, SEO 1.00.
- **Errors.** Clients never see raw exception text. A failed scan names one reference, its scan id, and logs never name an address.
- **Dependencies.** The audit gate is clean with no exceptions.

### For operators

- `SHARE_SIGNING_SECRET` lives in the Vercel Production environment only. The rotation and revocation runbooks are in SPEC.md and AGENTS.md.
- Shared-cache keys are versioned (`v2`), so results cached by older releases are never replayed.

Pull requests: #79, #58, #59, #70, #71, #73, #74, #75, #76, #77, #78, #64.

## [3.0.0] - 2026-03-06

Relaunch of the malicious URL detector: the Next.js app with streamed signals.
