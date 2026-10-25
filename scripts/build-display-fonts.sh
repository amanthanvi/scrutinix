#!/usr/bin/env sh
# Rebuilds the vendored Newsreader display instances in fonts/newsreader/.
#
# Source: @fontsource-variable/newsreader 5.3.0 (npm, SIL OFL 1.1), pinned
# by its registry integrity hash. Its latin-subset variable file
# (wght 200-800, opsz 6-72) is instanced into the two static cuts the page
# uses, and the same cuts are written as TTF for the share images (Satori
# reads TTF/OTF/WOFF, not WOFF2):
#
#   400 at opsz 16  - reading-size serif (answers, imperative, lead)
#   600 at opsz 60  - display serif (headline, verdict, domain, titles)
#
# Needs fontTools with brotli (for example Homebrew's `fonttools`). Run
# from the repository root:  sh scripts/build-display-fonts.sh
set -eu

VERSION="5.3.0"
INTEGRITY="sha512-rrzYi43qMpbzwuFtf9OkWH8sxAPVPcQQQEwXpPtwaKYeJ8yVg5aLs5kawmo1f2Q1t1M38TLmEKCkGVDsYwgdFw=="
OUT="fonts/newsreader"
PYTHON="${FONTTOOLS_PYTHON:-python3}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

(cd "$work" && npm pack "@fontsource-variable/newsreader@${VERSION}" --silent >/dev/null)
tarball="$work/fontsource-variable-newsreader-${VERSION}.tgz"
actual="sha512-$(openssl dgst -sha512 -binary "$tarball" | openssl base64 -A)"
if [ "$actual" != "$INTEGRITY" ]; then
  echo "Integrity mismatch for the Newsreader tarball." >&2
  exit 1
fi
tar -xzf "$tarball" -C "$work"
source="$work/package/files/newsreader-latin-opsz-normal.woff2"

mkdir -p "$OUT"
cp "$work/package/LICENSE" "$OUT/OFL.txt"

"$PYTHON" -I - "$source" "$OUT" <<'PY'
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source, out = sys.argv[1], sys.argv[2]
for weight, opsz in ((400, 16), (600, 60)):
    font = instantiateVariableFont(
        TTFont(source), {"wght": weight, "opsz": opsz}, updateFontNames=False
    )
    name = f"newsreader-{weight}-opsz{opsz}"
    font.flavor = None
    font.save(f"{out}/{name}.ttf")
    font.flavor = "woff2"
    font.save(f"{out}/{name}.woff2")
PY

ls -l "$OUT"
