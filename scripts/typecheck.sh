#!/bin/sh
# Type-checks the plugins against pasode's own types (the host API, Solid, OpenTUI, the Paseo client).
# Needs a pasode source checkout with dependencies installed:
#   git clone https://github.com/ragokan/pasode && (cd pasode && bun install)
# Usage: PASODE_SRC=~/src/pasode scripts/typecheck.sh
set -eu
src="${PASODE_SRC:?set PASODE_SRC to a pasode source checkout}"
here="$(cd "$(dirname "$0")/.." && pwd)"
links=""
cleanup() { for link in $links; do rm -f "$link"; done; }
trap cleanup EXIT
# pasode's tsconfig covers custom-plugins/, so each plugin is linked there for the duration of the check.
for dir in "$here"/plugins/*/; do
  name="pasode-plugins-$(basename "$dir")"
  ln -sfn "$dir" "$src/custom-plugins/$name"
  links="$links $src/custom-plugins/$name"
done
cd "$src" && bun run typecheck
