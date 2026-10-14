# Deploying qr.thetallkeith.com

Two routes. Both end with a proxied DNS record for `qr` in the thetallkeith.com zone on
Cloudflare and the zone settings at the bottom.

## Route A: Cloudflare Pages (recommended)

Static files on Cloudflare's edge, no server to keep up, `_headers` honoured, deploys on push.

1. The repo is at github.com/knelsonb/qr-gen (public; the page links to it).
2. Cloudflare dashboard: Workers & Pages, Create, Pages, Connect to Git, pick the repo.
   Production branch `main`, framework None, build command empty, build output directory `site`.
   No `package.json` exists, so nothing is installed.
3. After the first deploy: Custom domains, Add, `qr.thetallkeith.com`. Pages writes the CNAME
   into the zone and issues the certificate.
4. Check: `curl -sI https://qr.thetallkeith.com | grep -i content-security-policy` shows the
   policy, and `/sw.js` comes back with `cache-control: no-cache`.

## Route B: pve LXC behind a Cloudflare Tunnel

The pattern CT 101 already uses for hotspades.com, in its own small container.

1. On pve, a Debian LXC (256 MB, 2 GB disk, unprivileged) named `qr`. Inside:
   `apt install nginx git`.
2. `git clone https://github.com/knelsonb/qr-gen /srv/qr` and copy `deploy/nginx-qr.conf` to
   `/etc/nginx/sites-available/qr`, link it into `sites-enabled`, remove `default`,
   `nginx -t && systemctl reload nginx`. `curl -sI http://localhost/ | grep -i content-security`
   shows the policy.
3. Cloudflare dashboard: Zero Trust, Networks, Tunnels, Create a tunnel (name `qr`), choose the
   Debian install and run the shown `cloudflared service install <token>` line in the LXC. Add a
   public hostname `qr.thetallkeith.com` with service `http://localhost:80`. The tunnel creates
   the proxied CNAME.
4. Updates: `cd /srv/qr && git pull`. A systemd timer running that every few minutes, or a
   `git pull` over SSH from this machine, keeps it current. The service worker's `no-cache`
   header makes visitors pick up a new version on their next visit.
5. Cache: a Cache Rule for the host with "Eligible for cache" so the edge serves the files and
   the home uplink stays quiet. Keep `sw.js` and `/` out of it, or trust the `no-cache` header,
   which Cloudflare respects.

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
and that every file the service worker lists is served.
