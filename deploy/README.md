# Deploying qr.thetallkeith.com

What runs is Route B, the pve container. Route A is the alternative if the site ever moves to
Cloudflare Pages. Both end with a proxied DNS record for `qr` in the thetallkeith.com zone and
the zone settings at the bottom.

## Route A: Cloudflare Pages (alternative)

Static files on Cloudflare's edge, no server to keep up, `_headers` honoured, deploys on push.

1. The repo is at github.com/knelsonb/qr-gen (public; the page links to it).
2. Cloudflare dashboard: Workers & Pages, Create, Pages, Connect to Git, pick the repo.
   Production branch `main`, framework None, build command empty, build output directory `site`.
   No `package.json` exists, so nothing is installed.
3. After the first deploy: Custom domains, Add, `qr.thetallkeith.com`. Pages writes the CNAME
   into the zone and issues the certificate.
4. Check: `curl -sI https://qr.thetallkeith.com | grep -i content-security-policy` shows the
   policy, and `/sw.js` comes back with `cache-control: no-cache`.

## Route B: pve LXC behind a Cloudflare Tunnel (what runs now)

CT 120 `qr` on pve: Debian 13, unprivileged, 1 core, 256 MB of RAM, a 2 GB disk, DHCP on
vmbr0, starts with the host. Inside it nginx serves `/srv/qr/site` through `deploy/nginx-qr.conf`, and
cloudflared runs a locally managed tunnel named `qr-pve` as a systemd service.

- Tunnel config: `/etc/cloudflared/config.yml` (one ingress rule, `qr.thetallkeith.com` to
  `http://localhost:80`, everything else 404).
- DNS: the proxied CNAME `qr` was written by `cloudflared tunnel route dns`.
- Update the site: on pve, from a checkout of this repo, `deploy/pull.sh` (or
  `deploy/pull.sh <commit>` to roll back). It fast-forwards the container's checkout, stamps
  the service worker and app with the commit so returning visitors install the new version as
  one set, installs the nginx config only if `nginx -t` passes, reloads, and runs the live check.
- Tunnel credentials: `/etc/cloudflared/<tunnel-id>.json`, mode 600. The account certificate
  that `cloudflared tunnel login` writes to `/root/.cloudflared/cert.pem` was deleted once the
  tunnel and its DNS record existed; it can create tunnels and records for the whole zone and
  the running tunnel does not need it. Re-run `login` only for admin changes.
- Health: `pct exec 120 -- cloudflared tunnel info qr-pve`, or the Tunnels page in Zero Trust.
- If the container is ever rebuilt: `apt install nginx git cloudflared` (Cloudflare's apt repo,
  key at `/usr/share/keyrings/cloudflare-main.gpg`), `git clone
  https://github.com/knelsonb/qr-gen /srv/qr`, `rm /etc/nginx/sites-enabled/default`, run
  `deploy/inside.sh`, then `cloudflared tunnel login` and authorise the zone in a browser,
  `tunnel create`, the config above, `tunnel route dns`, `service install`, and delete
  `cert.pem`.
- Web Analytics: the zone's Web Analytics site has automatic setup on, which injects
  Cloudflare's beacon script into HTML for every hostname in the zone, this one included. The
  CSP blocks it from running, and the live smoke test flags the attempt. Turning it off is a
  zone-level choice (Web Analytics, Manage site, "Enable with JS Snippet installation" keeps
  analytics on www through a manual snippet).

Trade-offs against Route A: the site is only up while pve and the home connection are; the LXC
and cloudflared need updates; the tunnel daemon is a dependency Route A does not have. In its
favour, everything stays on hardware you own, like the other services.

## Zone settings (both routes)

SSL/TLS: Full (strict), Always Use HTTPS on, HSTS on, Minimum TLS 1.2, Automatic HTTPS
Rewrites on. Speed: Rocket Loader off, Auto Minify off, Early Hints fine. Scrape Shield: Email
Address Obfuscation off. Analytics: Web Analytics off for this host. Each of the "off" items
injects a script into the page, which the CSP would block and the privacy line would then be
untrue. DNS: DNSSEC on, a CAA record `0 issue "letsencrypt.org"` plus `0 issue "pki.goog"`
and `0 issue "digicert.com"` (Cloudflare issues through those) if the zone has none.

## After going live

`node tools/check-live.js https://qr.thetallkeith.com` fetches the site and asserts the headers
and that every file the service worker lists, plus security.txt and the manifest, is served.
