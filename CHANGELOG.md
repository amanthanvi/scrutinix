# Changelog

Notable changes to Scrutinix. Versions follow the product's major relaunches and releases; dates are UTC.

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
