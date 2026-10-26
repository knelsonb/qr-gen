#!/usr/bin/env bash
# Updates the live site on pve: fast-forwards the container's checkout to origin/main, or to a
# given commit, which is also how to roll back. The work inside the container is in
# deploy/inside.sh, run from the freshly fetched checkout. Run on pve: deploy/pull.sh [commit]

set -euo pipefail

CT=117
REF=${1:-origin/main}

pct exec "$CT" -- git -C /srv/qr checkout -q -- site/sw.js site/js/app/main.js
pct exec "$CT" -- git -C /srv/qr fetch -q origin
pct exec "$CT" -- git -C /srv/qr checkout -q --detach "$REF"
pct exec "$CT" -- bash /srv/qr/deploy/inside.sh

if command -v node >/dev/null && [ -f tools/check-live.js ]; then
  node tools/check-live.js https://qr.thetallkeith.com
else
  curl -fsSI https://qr.thetallkeith.com/ | head -1
fi
