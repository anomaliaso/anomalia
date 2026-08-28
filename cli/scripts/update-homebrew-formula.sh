#!/usr/bin/env bash
# Fill Formula/anomalia.rb version + sha256 from dist/*.tar.gz (run after packaging).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
FORMULA="$ROOT/Formula/anomalia.rb"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('$ROOT/package.json').version")"
fi
VERSION="${VERSION#v}"

sha() {
  local f="$1"
  if command -v sha256sum >/dev/null; then
    sha256sum "$f" | awk '{print $1}'
  else
    shasum -a 256 "$f" | awk '{print $1}'
  fi
}

need() {
  [[ -f "$1" ]] || { echo "Missing $1 — run release packaging first" >&2; exit 1; }
}

need "$DIST/anomalia-macos-arm64.tar.gz"
need "$DIST/anomalia-macos-x64.tar.gz"
need "$DIST/anomalia-linux-arm64.tar.gz"
need "$DIST/anomalia-linux-x64.tar.gz"

export FORMULA VERSION
export MAC_ARM="$(sha "$DIST/anomalia-macos-arm64.tar.gz")"
export MAC_X64="$(sha "$DIST/anomalia-macos-x64.tar.gz")"
export LIN_ARM="$(sha "$DIST/anomalia-linux-arm64.tar.gz")"
export LIN_X64="$(sha "$DIST/anomalia-linux-x64.tar.gz")"

python3 - <<'PY'
import os
from pathlib import Path

path = Path(os.environ["FORMULA"])
text = path.read_text()
replacements = {
    "REPLACE_SHA256_MACOS_ARM64": os.environ["MAC_ARM"],
    "REPLACE_SHA256_MACOS_X64": os.environ["MAC_X64"],
    "REPLACE_SHA256_LINUX_ARM64": os.environ["LIN_ARM"],
    "REPLACE_SHA256_LINUX_X64": os.environ["LIN_X64"],
}
# Also rewrite previous release hashes when re-running on an already-filled formula:
# match each on_* block's sha256 line by regenerating from the template tokens if present,
# otherwise replace by platform URL order.
import re
version = os.environ["VERSION"]
text = re.sub(r'version "[^"]+"', f'version "{version}"', text, count=1)

for token, digest in replacements.items():
    text = text.replace(token, digest)

# If tokens were already replaced in a prior release, bump sha256 next to each platform URL.
platform_digests = [
    ("anomalia-macos-arm64.tar.gz", os.environ["MAC_ARM"]),
    ("anomalia-macos-x64.tar.gz", os.environ["MAC_X64"]),
    ("anomalia-linux-arm64.tar.gz", os.environ["LIN_ARM"]),
    ("anomalia-linux-x64.tar.gz", os.environ["LIN_X64"]),
]
for artifact, digest in platform_digests:
    text = re.sub(
        rf'(url "[^"]*{re.escape(artifact)}"\n\s*sha256 ")[a-f0-9]{{64}}(")',
        rf"\g<1>{digest}\2",
        text,
    )
    # Keep version interpolation in URLs: .../download/v#{version}/artifact
    text = re.sub(
        rf'(releases/download/)v[^/]+(/{re.escape(artifact)}")',
        rf"\g<1>v#{{version}}\2",
        text,
    )

path.write_text(text)
print(f"Updated {path} → v{version}")
for artifact, digest in platform_digests:
    print(f"  {artifact}: {digest}")
PY
