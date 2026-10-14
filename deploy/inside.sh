#!/usr/bin/env bash
# Runs inside the container after the checkout moved: stamps the served service worker with
# the commit, installs the nginx config only if it passes the config test, and reloads.

set -euo pipefail
cd /srv/qr

commit=$(git rev-parse --short HEAD)
echo "serving $commit"
sed -i "s/VERSION = '[^']*'/VERSION = '$commit'/" site/sw.js site/js/app/main.js

previous=/tmp/qr.conf.previous
cp /etc/nginx/sites-available/qr "$previous" 2>/dev/null || true
install -m 644 deploy/nginx-qr.conf /etc/nginx/sites-available/qr
ln -sfn ../sites-available/qr /etc/nginx/sites-enabled/qr
rm -f /etc/nginx/sites-enabled/default
if ! nginx -t; then
  echo "nginx config rejected; restoring the previous one" >&2
  [ -f "$previous" ] && install -m 644 "$previous" /etc/nginx/sites-available/qr
  exit 1
fi
systemctl reload nginx
