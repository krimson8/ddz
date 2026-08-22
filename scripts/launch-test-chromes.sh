#!/usr/bin/env bash
# Launch three isolated Chrome instances for multi-user DDZ testing.
#
# Each instance gets its own --user-data-dir, which is what actually separates
# the sessions: Firebase persists its login in IndexedDB keyed by origin, so
# three tabs (or three windows) in one profile would all be the *same* logged-in
# user. Separate profile dirs give three genuinely independent players.
#
# The profile dirs live outside the repo and are reused across runs, so each
# alias only has to be signed in once — the app sets browserLocalPersistence,
# so the session survives closing Chrome.
#
# Each instance also exposes a CDP endpoint (ports 9222/9223/9224) so the
# windows can be driven programmatically once they are signed in.
#
# Usage:  bash scripts/launch-test-chromes.sh [url]

set -euo pipefail

URL="${1:-http://localhost:3000/login}"
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
[ -f "$CHROME" ] || CHROME="/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
[ -f "$CHROME" ] || { echo "Chrome not found — edit CHROME in this script." >&2; exit 1; }

PROFILE_ROOT="${LOCALAPPDATA:-$HOME}/ddz-test-profiles"
mkdir -p "$PROFILE_ROOT"

# alias-suffix : debug-port : window-x : window-y
LAYOUT=(
  "1:9222:0:0"
  "2:9223:640:0"
  "3:9224:1280:0"
)

for entry in "${LAYOUT[@]}"; do
  IFS=: read -r n port x y <<< "$entry"
  profile="$PROFILE_ROOT/user$n"
  mkdir -p "$profile"
  echo "launching krimson8+$n@gmail.com  ->  profile=$profile  cdp=$port"
  "$CHROME" \
    --user-data-dir="$(cygpath -w "$profile" 2>/dev/null || echo "$profile")" \
    --remote-debugging-port="$port" \
    --remote-allow-origins="*" \
    --no-first-run \
    --no-default-browser-check \
    --new-window \
    --window-position="$x,$y" \
    --window-size=640,900 \
    "$URL" \
    >/dev/null 2>&1 &
  sleep 1
done

cat <<'NOTE'

Three Chrome windows are opening, one per test alias:

  window 1  ->  krimson8+1@gmail.com   (CDP :9222)
  window 2  ->  krimson8+2@gmail.com   (CDP :9223)
  window 3  ->  krimson8+3@gmail.com   (CDP :9224)

Sign each window in once with its own alias. The sessions persist in the
profile dirs, so re-running this script later reuses them and skips the login.

Note: krimson8+3 has no Firebase account yet — the app's signInOrCreate will
create it on that first sign-in.
NOTE
