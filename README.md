# qr

A QR code generator that runs entirely in the browser, at [qr.thetallkeith.com](https://qr.thetallkeith.com).
Links, text, Wi-Fi, contacts, email, SMS, phone numbers, events, locations and crypto addresses;
PNG, SVG, print at real size, copy, share, batch to zip. No dependencies, no build step, no
server, no analytics.

## Layout

```
site/                 the published directory
  index.html, styles.css, sw.js, manifest.webmanifest, _headers, favicon.svg, icon-*.png
  fonts/              Brewster Technical, WOFF2
  .well-known/        security.txt
  js/qr/              the encoder: ISO/IEC 18004 versions 1 to 40, levels L M Q H
  js/render/          the module grid as SVG, canvas or text, and the logo geometry
  js/payload/         form fields to payload strings, and what a reader will do with them
  js/io/              PNG DPI chunk, stored zip, downloads, CRC
  js/app/             state, UI wiring, actions, logos, counter, entry point
tests/                node:test suites, no other dependency
tools/smoke.js        drives the page in headless Chromium over the DevTools protocol
tools/check-live.js   checks a deployed copy's headers and files
tools/make-icons.js   regenerates the PNG icons
deploy/               nginx config and the deploy notes
docs/                 the design brainstorm this was built to
```

The built-in logo icons are Material Design icons (Apache 2.0). The Brewster Technical fonts
are the site owner's own, under the SIL Open Font License.

Dependencies point one way: `app` uses `payload`, `render` and `io`; `render` uses `qr`; `qr`
imports nothing outside its folder and never touches the DOM.

`encode(text, options)` returns the module grid with a role for every module (finder, timing,
alignment, format, version, data), so renderers can keep finders square under rounded styling
and keep the logo off the format bits.

## Tests

```
node --test tests/
```

Node 22.7 or newer. The suites check Reed-Solomon against the spec's worked example, all 32
format codewords, version codewords, mask patterns, capacities, segmentation, payload escaping,
the fragment round trip for every form, hostile fragments, and a full round trip through
`zbarimg` when it is installed (`pacman -S zbar`; the test skips otherwise). Mask selection
follows the 2015 edition's rule 3, so a reference encoder on the 2006 edition may pick another
mask for the same input; both are valid codes.

## Settings link

The fragment is `#v=1&type=<type>&<style keys>` with content fields as `f.<name>`. Unknown keys
are ignored, numbers clamped, enums checked, strings cut at 4,500 characters, the whole thing
refused over 8,000. Content from a link is loaded only after the visitor clicks the banner.

## Deploy

Cloudflare Pages, Git integration, no build command, output directory `site`. The `_headers`
file sets the Content-Security-Policy and the other response headers. Every file is served
`no-cache` so the edge never pairs new HTML with old scripts after a deploy; the service worker
keeps repeat visits off the network. Bump `VERSION` in
`site/js/app/main.js` and `site/sw.js` together when files change; a test checks they match.

In Cloudflare: Always Use HTTPS on, HSTS on, minimum TLS 1.2, and Rocket Loader, Auto Minify,
email obfuscation and Web Analytics off, since each of those injects script and would break
both the CSP and the promise on the page.
