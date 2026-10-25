# Newsreader (display face)

Scrutinix's one display face, self-hosted. Licensed under the SIL Open Font
License 1.1: see [`OFL.txt`](./OFL.txt) (copied from the source package).

- **Typeface:** Newsreader, © 2020 The Newsreader Project Authors
  (<https://github.com/productiontype/Newsreader>).
- **Source:** npm `@fontsource-variable/newsreader` **5.3.0**, registry
  integrity
  `sha512-rrzYi43qMpbzwuFtf9OkWH8sxAPVPcQQQEwXpPtwaKYeJ8yVg5aLs5kawmo1f2Q1t1M38TLmEKCkGVDsYwgdFw==`,
  file `files/newsreader-latin-opsz-normal.woff2` (latin subset, `wght`
  200–800, `opsz` 6–72).
- **Instances** (static, fontTools `varLib.instancer`):

  | File                          | Weight | opsz |  Bytes | Used by           |
  | ----------------------------- | -----: | ---: | -----: | ----------------- |
  | `newsreader-400-opsz16.woff2` |    400 |   16 | 22,708 | page (reading)    |
  | `newsreader-600-opsz60.woff2` |    600 |   60 | 24,156 | page (display)    |
  | `newsreader-400-opsz16.ttf`   |    400 |   16 | 49,800 | share images only |
  | `newsreader-600-opsz60.ttf`   |    600 |   60 | 50,008 | share images only |

  The page loads only the two WOFF2 files (46,864 bytes) through
  `next/font/local` in `app/layout.tsx`; Satori reads the TTFs
  (`lib/og/fonts.ts`).

Rebuild from the repository root (verifies the tarball's integrity first):

```sh
sh scripts/build-display-fonts.sh   # FONTTOOLS_PYTHON=… if python3 lacks fontTools + brotli
```
