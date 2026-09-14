#!/usr/bin/env bash
# Run every check against the template. Do this before showing a demo.
#
#   ./verify.sh                      checks the default file
#   ./verify.sh "My Client.dc.html"  checks a named file
set -uo pipefail
cd "$(dirname "$0")"

FILE="${1:-Pulse v4 Glass.dc.html}"
if [ ! -f "$FILE" ]; then
  echo "no such file: $FILE" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required (any recent version)" >&2
  exit 1
fi

echo "checking $FILE"
fail=0
for check in check counts reach consistency leftovers; do
  node "tools/$check.js" "$FILE" || fail=1
done

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS — safe to demo"
else
  echo "FAIL — fix the above before demoing"
fi
exit "$fail"
