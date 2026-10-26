# Bundled URL classifier

Int8 ONNX export of
[`CrabInHoney/urlbert-tiny-v4-phishing-classifier`](https://huggingface.co/CrabInHoney/urlbert-tiny-v4-phishing-classifier)
(Apache-2.0, 3.69M parameters, BERT-tiny architecture trained on URL strings).
Loaded offline by `lib/server/ml/local-classifier.ts` via
`@huggingface/transformers` — no API key, no network access at inference time.

## Labels

`config.json` ships generic ids; the documented mapping is:

| id      | class    |
| ------- | -------- |
| LABEL_0 | benign   |
| LABEL_1 | phishing |

## Provenance

Converted from the upstream fp32 safetensors weights (not a third-party
re-upload):

```bash
pip install "optimum[exporters]" optimum-onnx onnxruntime
optimum-cli export onnx \
  --model CrabInHoney/urlbert-tiny-v4-phishing-classifier \
  --task text-classification out/
python -c "from onnxruntime.quantization import quantize_dynamic, QuantType; \
  quantize_dynamic('out/model.onnx', 'out/model_quantized.onnx', weight_type=QuantType.QUInt8)"
```

Quantization was verified against the PyTorch original on a spot-check set
(max softmax deviation 0.0092, no label flips). Upstream reports 0.9907
accuracy / 0.9900 F1 on its held-out split; treat those as in-distribution
numbers — the classifier is one dampened ensemble member, not an oracle.

## Reading and bar

Read raw, the model is not usable on the links people check. Fed the link
as a scan normalizes it (`https://example.com/`), it called 31% of popular
sites phishing (45% of bare domains such as `https://example.com/`), 91% of
official short links (`https://youtu.be/jNQXAC9IVRw` at 100%) and about
half of sign-in pages, so the ensemble added 7 to 11 points to a third of
ordinary links.

Why: the model learned how its training links were written. In its training
set (`ealvaradob/phishing-dataset`, `urls.json`, 835,697 links, 47%
phishing):

| How the link is written            | Links   | Phishing share |
| ---------------------------------- | ------- | -------------- |
| `https://site/` (nothing after)    | 56,661  | 92%            |
| `site/` (no scheme)                | 50,485  | 13%            |
| `www.site/` (no scheme)            | 794     | 100%           |
| any link with `https://`           | 143,316 | 80%            |
| any link without a scheme          | 607,970 | 35%            |
| a query over 100 characters        | 11,423  | 91%            |
| `redirect` in the query            | 1,767   | 93%            |
| `token=` in the query              | 540     | 99%            |
| `verify` anywhere in the link      | 2,158   | 99%            |

88% of its benign links have no scheme, and almost none are sign-in,
OAuth, or account links (13 benign links mention `oauth`, 19 `verify`).
Its phishing examples also come from feeds full of random ids, so it reads
any id (`google.com/jNQXAC9IVRw` reads 99.6% phishing) as phishing. It
reads at most 64 tokens, the start of the link.

So `classifyUrlLocally` (`lib/server/ml/local-classifier.ts`):

1. Reads only the host and path: the query and fragment are left out (the
   structure checks still read the whole link, query included). A fragment
   route (`#/signin`, `#!/login`) would read as path, but scans drop the
   fragment before any check (`normalizeUrlInput`), so neither member sees
   one. In the path, UUIDs are left out whole, then ID-like runs (six or
   more letters and digits that switch between the two at least twice, or
   camel-cased random letters), unless the run spells a listed brand
   (`lib/domain/impersonated-brands.ts`) or a lure word, five letters or
   more, in any case, with digits between its letters, standing in for
   them, or both (`PayPalSecureLogin`, `paypal2verify`, `P4yP4lL0g1n`).
   The lure words are the structure checks' own (`lib/domain/lure-words.ts`)
   plus sign-in, account, mail and file-sharing words (`signin`, `logon`,
   `account`, `confirm`, `verif`, `secur`, `webmail`, `docusign`,
   `sharepoint`, ...) that the training links' paths tie to phishing at 76%
   to 100% (47% overall). Shorter names (`hsbc`, `auth`) and runs of hex
   digits are never kept: they turned up in random ids and hashes
   (`ad0be` reads as "adobe").
2. Reads two writings of that: as written, and without its scheme and a
   leading `www.`. Every link gets the same treatment.
3. Averages the two readings as log-odds of phishing over benign.
4. Reads phishing at or past `PATTERN_MODEL_BAR` (6.44), set on the
   calibration half of the benign corpus so that at most 2% of it reads
   phishing. The score it reports is the distance from the bar on a
   logistic scale (0.5 on the bar), so it is not a probability and the copy
   shows none. The ensemble's "risk N of 100" is the combined score of this
   distance and the structure checks' score.

Because the score is a distance, a flag just past the bar weighs less than
it did as a raw probability (about 0.99 for most flags). Links both members
flag get fewer points than before, so `classifyConsensus` keeps the
structure checks' floor for them too: a model flag never scores below what
the structure checks would get alone. The ensemble's "malicious" level
still needs the combined score at 0.55 when both flag, so a weak flag can
fall from 25 or more points to under 10 (`http://45.33.20.10/x.sh`: 36
before, 26 in round one, 8 now).

### Evaluation (2026-10-25, second round 2026-10-26)

Offline, text only: no link was fetched. Corpora (the second round added
the sign-in, account and malware sets after review):

- Benign: [Tranco](https://tranco-list.eu/) top 1M, list `W3ZV9`: all of
  ranks 1 to 1,000 and a seeded 1,000 from each of 1,001 to 10,000, 10,001
  to 100,000 and 100,001 to 1,000,000, each as `https://d/`,
  `https://www.d/` and `https://d/<short path>` (11,998 links); 600 deep
  links in the real shapes of 33 popular sites (YouTube, Google Docs,
  Amazon, Zoom, Notion, ...) with seeded ids; 721 official short links on
  35 hosts (youtu.be, t.co, bit.ly, amzn.to, maps.app.goo.gl, ...) with
  seeded ids; 376 sign-in links: sign-in pages and OAuth/SAML endpoints of
  Microsoft, Google, Apple, Okta, GitHub, Auth0, Facebook, Amazon, Slack,
  Salesforce, Atlassian and PayPal in their documented shapes with seeded
  ids, plus Microsoft's documented authorize example; 460 account and email
  links: verify-email, reset, confirm, unsubscribe, sign-in-with-return,
  order, tracking, invite and magic links on 200 Tranco top-1,000 sites,
  and Mailchimp, SendGrid, Salesforce Marketing Cloud and HubSpot
  unsubscribe and click-tracking links. Split in half by a hash of the
  domain (sign-in and email links: of the template): the calibration half
  (7,159 links) set the bar; the held-out half (6,996) measures it.
- Phishing: the public OpenPhish feed (300 links, held out: never used to
  choose anything) and a seeded 5,000 from Phishing.Database's active list
  (noisy; used as the development set).
- Malware (held out): 1,000 links from the URLhaus-derived online Suricata
  ruleset (`malware-filter/urlhaus-filter`; URLhaus's own text downloads
  answer 410): 600 links on shared hosts (GitHub, Google Drive, ...;
  lowercased by the ruleset, so camel-cased ids don't appear) and 400 bare
  malware hosts as `http://host/` (mostly IP addresses).

Before (d8888e4: raw reading, 50% label), round one (317f6bb: two writings
with the query, bar 6.19, calibrated without sign-in or account links) and
now. Each cell is the share of the set the ensemble adds points to:

| Set                                  | Before | Round one | Now   |
| ------------------------------------ | ------ | --------- | ----- |
| Benign, held out (6,996)             | 33.6%  | 2.0%      | 1.5%  |
| Tranco, held out (6,005)             | 29.7%  | 1.2%      | 1.0%  |
| Deep links, held out (285)           | 32.3%  | 0.4%      | 1.1%  |
| Official short links, held out (300) | 91.3%  | 3.7%      | 3.0%  |
| Sign-in links, both halves (376)     | 51.3%  | 28.7%     | 0.0%  |
| Account links, held out (180)        | 57.8%  | 18.3%     | 10.6% |
| Email links, held out (45)           | 88.9%  | 33.3%     | 33.3% |
| OpenPhish (300)                      | 80.0%  | 35.3%     | 35.0% |
| Phishing.Database sample (4,997)     | 90.9%  | 50.1%     | 47.8% |
| Malware, shared hosts (600)          | 60.7%  | 7.2%      | 6.7%  |
| Malware, bare hosts (400)            | 92.5%  | 51.0%     | 43.8% |

The model's own flags at the bar, held out: 1.1% of popular sites, deep
links and sign-in pages, 3.3% of short links, 16.4% of account and email
links, 35.7% of OpenPhish, 48.8% of Phishing.Database, 22.5% of malware.
These are the figures /about prints (`PATTERN_MODEL_EVALUATION` in
`lib/domain/methodology.ts`).

The structure checks flagged none of the benign links and 0.6% of the
phishing ones: the ensemble's points came from the model. Round one's nine
live false positives (`example.com`, `youtu.be/jNQXAC9IVRw`, `dbltest.com`,
five `badssl.com` hosts, `scrutinix-check.invalid`) and Microsoft's
documented sign-in links read normal, and the ensemble adds nothing to them
(`tests/unit/local-classifier.test.ts`).

The trade is real. Against before, the model alone catches about a third of
OpenPhish links instead of 8 in 10, and the ensemble adds points to 44% of
bare malware hosts instead of 93%, because at its old label it could not
tell them from a third of ordinary links (likelihood ratio 2.3; now 21).
Against round one, leaving the query out and counting sign-in and account
links cleared every sign-in false positive and cost 2.3 points of
Phishing.Database and 7 of bare malware hosts (the bar rose from 6.19 to
6.44 because account links now count toward the 2%). Listed phishing and
malware are convicted by the lists; the model alone never could convict (at
most 11 points as risky).

The raw reading with its own bar at the same 2% target (8.60) would flag
1.0% of popular sites, 8.7% of short links and 2.2% of account links, and
catch 26.0% of OpenPhish, 32.7% of Phishing.Database and 6.4% of malware.
Area under the ROC curve against the held-out benign links: OpenPhish 0.799
now and 0.791 raw; malware 0.580 now and 0.704 raw (with ids and the query
left out, malware on GitHub or Google Drive reads like any file there; at
the bar the shipped reading still catches more).

Other bars, same method (held-out benign / OpenPhish / Phishing.Database /
malware): 5% target, bar 4.67: 4.8% / 50.7% / 61.0% / 35.5%; 1% target,
bar 7.41: 0.9% / 30.0% / 39.9% / 11.0%. Calibrating without account links
gives bar 6.08: account 19.1%, short 4.7%, OpenPhish 37.3%, malware 26.4%.

Choosing the reading: the second round compared seven ID and query rules
on the development data only (calibration halves and Phishing.Database).
Leaving the query out caught the most phishing at 1%, 2% and 5% benign
rates and cleared sign-in links. Splitting on `-` and `_` as well made no
difference once UUIDs go whole. The first prototype's broader rule (any
run of six that mixes letters and digits, `-` and `_` included) scored
about the same, but it drops any hyphenated slug with a digit in it
(`secure-login-2fa`), which hides phishing words from the model.

The bar was set on macOS arm64. In round one, on linux/amd64 (CI and
production's architecture), the int8 kernels read 1,936 near-bar links a
median 0.005 and at most 0.32 log-odds differently. That was not rerun for
the second round's writings. The regression links stay at least 0.6 below
the new bar, and the sign-in sample at least 2.5 below.

Known misses:

- Account and email links on popular sites, across both halves:
  `/account/...` confirm and security pages (16 of 46), `/email/verify/...`
  links (12 of 28), `verify-email` links (11 of 35), and email
  click-tracking (SendGrid 15 of 15, Salesforce Marketing Cloud 4 of 15).
  `verify` and `token=` were 99% phishing in training, and the model can't
  tell a popular site's own account page from a fake.
- Short links whose ids are all lowercase or a word, on some hosts (5 of
  20 `rb.gy`, 3 of 20 each `amzn.to`, `aka.ms`, `tinyurl.com`, `buff.ly`,
  `is.gd`), and Google Drive share links (3 of 15).
- Leaving the query out also hides it from the model when it is the
  phishing part (`?email=` with the victim's address, a lookalike
  redirect). The structure checks still read it, but lure words add at
  most 0.25 to their score, so lure words alone never make them call a
  link risky (0.45). A brand name in the query was tried as a structure
  term and dropped: it gave points to Amazon's own sign-in links
  (`openid.return_to=...amazon...`) and gave no phishing link points it
  didn't already have.
  Phishing.Database links with a query were caught at 57.6%, against
  58.9% for round one's reading at the same 2% target.
- An ID-like run in a phishing path is left out of the model's reading
  unless it spells a listed brand or lure word (the structure checks still
  read the whole link). Keeping those (2026-10-26, after a security review
  showed `/PayPalSecureLogin` and `/paypal2verify` reached the model as
  the bare site) changed the reading of 21 of the 20,462 corpus links,
  none of them benign: every benign and held-out figure above is
  unchanged, and the bar stays 6.44. Phishing.Database flags rose from
  48.77% to 48.83% (4 links newly flagged, 1 no longer); OpenPhish and
  malware are unchanged. Feed links rarely write lures as ids, so this
  closes an evasion more than it catches today's phishing. In a
  simulation, a random id is kept by chance about once in 50,000
  (YouTube's 11 characters) to once in 3,000 (120-character tokens), and
  a hex hash never. A word off the list, a letter look-alike (`PayPaI`),
  or ordinary words before the lure (`/shop/category/.../PayPalSecureLogin`)
  still get past the model.

To re-measure, rebuild the corpora above, run each link through
`normalizeUrlInput` and `runMlEnsembleProvider`, and set the bar on the
calibration half only. A new bar needs new figures in
`lib/domain/methodology.ts` (`PATTERN_MODEL_EVALUATION`, whose `bar` a test
holds equal to `PATTERN_MODEL_BAR`) and in this file.

## Checksums (sha256)

```
50c47b541a04390c4c03a876da9c9a9dcca36f1a076c4599e948caeb78cf5586  onnx/model_quantized.onnx
89a6203b3def4d83019141cff251f761cb8c49970ee4c5421f906bce7fd33504  tokenizer.json
7970e44e51a7afb6ad81d79edb640d4d7e7ca6ddaa964b5c64338e9a56b0c145  config.json
```
