#!/usr/bin/env bash
# Mirror packages/api-contracts/src into cli/lib/contracts. The CLI ships as a standalone binary
# and imports nothing outside itself, so it carries a copy instead of reaching into the workspace.
# Run after changing an endpoint contract; cli/lib/contracts.test.ts fails if you forget.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/../packages/api-contracts/src"
DST="$ROOT/lib/contracts"
if [[ ! -f "$SRC/index.ts" ]]; then
  echo "Missing contract source at $SRC/index.ts" >&2
  exit 1
fi
rm -rf "$DST"
mkdir -p "$DST"
for file in "$SRC"/*.ts; do
  base="$(basename "$file")"
  [[ "$base" == *.test.ts ]] && continue
  cp -a "$file" "$DST/$base"
done
echo "Synced $SRC → $DST"
