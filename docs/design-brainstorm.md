# QR generator: design brainstorm

Pre-implementation review, 2026-10-13, four views (user, security, architecture, performance)
merged into one set of decisions. The product: a free, public QR code generator at
qr.thetallkeith.com. Static site, zero dependencies, no build step, everything in the browser.

## What makes it better than the ad sites

1. The code appears while you type. No Generate button, no email gate.
2. Download is one click, in the format a printer or designer wants.
3. The page says honestly whether the code will scan before you print 500 flyers.
4. The privacy claim is one the page can back up: no requests after load, enforced by CSP.

## Content types

| Type | Priority | Payload | Pitfalls the form handles |
|---|---|---|---|
| URL | must | as typed, `https://` added when there is no scheme | spaces, missing dot, `javascript:`/`data:` schemes, look-alike hosts, embedded credentials |
| Text | must | UTF-8 bytes | live byte count; emoji and non-Latin cost more |
| Wi-Fi | must | `WIFI:T:WPA;S:..;P:..;H:true;;` | escape `\ ; , : "`, WPA3 writes `WPA`, hidden flag, enterprise warning, password shown in plain text |
| Contact | must | vCard 3.0, CRLF, `N:Last;First` | escaping, size cost, MeCard as the compact option |
| Email | should | `mailto:` with percent-encoded subject and body | |
| SMS | should | `SMSTO:number:message` | more phones read it than `sms:?body=` |
| Phone | should | `tel:+...` | keep `+`, strip spaces, nudge to international format |
| Event | should | iCalendar VEVENT, UTC times | patchy iPhone camera support, so say so |
| Location | should | maps URL by default, `geo:` as an option | `geo:` does nothing on many iPhones |
| Crypto | could | `bitcoin:` / `ethereum:` with amount | address echoed in groups of four |

## Layout

Desktop: inputs left, live preview right, actions under the preview, nothing to scroll for the
common case. Cursor starts in the link field, so paste and you are done. Phone: preview near the
top, form below, sticky bottom bar with Share, Save and More. Pasted `WIFI:`, `BEGIN:VCARD` or
`mailto:` content offers a one-tap switch of type; nothing switches on its own.

```
+----------------------------------------------------------------+
| QR Code Generator    Made in your browser. Nothing is uploaded.|
| (o)URL ( )Text ( )Wi-Fi ( )Contact ( )Email ( )SMS  More v     |
+--------------------------------+-------------------------------+
| Link                           |   +-----------------------+   |
| [https://___________________]  |   |                       |   |
|                                |   |       [ QR CODE ]     |   |
| Caption (optional)             |   |                       |   |
| [Scan for our menu__________]  |   +-----------------------+   |
|                                |      Scan for our menu        |
| > Style: colours, size,        |  Scannability: Good           |
|   border, error correction     |  v4 . 33x33 . 61/78 bytes     |
| > Logo                         |  [Download PNG v] [SVG] [Copy]|
|                                |  [Print at real size...]      |
+--------------------------------+-------------------------------+
```

## Output

- PNG at 512, 1024, 2048 px or custom up to 4096, whole pixels per module, DPI written into the
  file so print software sizes it right. Default 1024.
- SVG with one path per colour (a rect per module is 15k DOM nodes at version 40).
- Print at real size in mm or inches through a print stylesheet; rule of thumb shown: width at
  least a tenth of the scanning distance.
- Copy image to the clipboard; Share with the file attached where the browser can.
- Colours with a live contrast check; light-on-dark blocked unless the user ticks that their
  scanner reads inverted codes.
- Quiet zone default 4 modules, 0 to 8, warning below 2.
- Error correction in plain words: Low, smallest code, keep it clean; Medium, everyday default;
  Quartile, stickers and outdoors; High, survives scuffs or a logo.
- Logo overlay forces High, caps coverage near 20 %, keeps the finders clear, and says plainly
  that logos make codes harder to scan. PNG, JPEG and WebP only, checked by magic bytes, size
  and dimensions capped, redrawn through a canvas so metadata never reaches the output.
- Rounded modules off by default; the finders stay square.
- Caption under the code.

## Feedback and trust

- Scannability meter (Good, Risky, Poor) from contrast, quiet zone, module size at print size,
  logo coverage, each factor explained in one line.
- Stats line: version, modules, bytes used of capacity, error-correction level.
- Capacity warning at about 80 % with a fix; at the limit a hard stop that says how much to cut.
- "This code contains:" preview of the literal payload with the host highlighted, control and
  bidirectional characters made visible, and warnings for commonly abused shapes: script and
  data schemes (blocked), IP-literal hosts, punycode shown decoded, user@host, http.
- Self-check through BarcodeDetector where the browser has it.
- Privacy line under the title, backed by `connect-src 'none'`.

## Accessibility

Radio group for content types with arrow keys, tab order form, options, actions, visible focus
rings, 44 px targets. Alt text names the content and never the password. A live region announces
"Code updated" once per pause. The code always renders dark on light on its own card, in dark
mode and forced-colours mode alike. `prefers-color-scheme` and `prefers-reduced-motion` honoured.

## Small touches

- Style settings remembered automatically on the device; content never, Wi-Fi passwords above
  all. "Forget my settings" in the footer.
- Style settings in the URL fragment so they are shareable; content goes in only when a box is
  ticked, with a warning. A link with content pre-fills the form only after the visitor clicks
  "Load content from link", so a crafted link cannot plant a phishing URL silently.
- Offline and installable through a small service worker with a versioned cache.
- Wi-Fi guest card print layout: code plus network name and password in large type.
- Batch: one item per line to a zip of PNGs or SVGs, capped at 200, stored-only zip hand-written.

## Left out, on purpose

Dynamic or trackable codes (they need a server and log who scanned), accounts, analytics, ads,
email-to-download, gradients and fancy corner shapes, JPEG export (blur on module edges), other
barcode formats, a decoder (1,500 lines for a side feature), Micro QR, structured append.

## Security measures

- Response-header CSP through Cloudflare Pages `_headers`, with a meta copy as fallback:
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:;
  connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';
  object-src 'none'; manifest-src 'self'; worker-src 'self'`. No inline script or style.
- Referrer-Policy no-referrer, nosniff, Permissions-Policy denying everything, COOP same-origin,
  HSTS. No external resources, so SRI has nothing to cover.
- User text is data, never markup: `textContent` and `setAttribute` only, SVG built from numbers
  and validated colours, filenames fixed or slugged to `[a-z0-9-]`.
- Fragment parsed against a whitelist with clamped ints and a length cap.
- Payload capped at the real capacity, export capped at 4096 px, batch capped at 200.
- Cloudflare: Always Use HTTPS, HSTS, TLS 1.2 minimum, Rocket Loader, Auto Minify, email
  obfuscation and Web Analytics off (they inject scripts and would break both the CSP and the
  privacy claim). Proxied CNAME to the Pages project. CAA record and DNSSEC.
- `/.well-known/security.txt`. Public source.

## Architecture

Pure encoder: `encode(text, options)` returns `size`, `modules`, `roles` (finder, timing,
alignment, format, version, data), `version`, `ecLevel`, `mask`, bits used and available. The
roles array is what lets rounded modules keep the finders square and the logo keep off the
format bits. Dependencies point one way: app to payload, render and io, those to qr; the qr
modules import nothing else and never touch the DOM. One state object; the DOM is a view of it.
The pipeline is state to payload string to encode to render, rerun in full on every change.

The most likely rot: the UI glue turning into the place where state lives. Guard: a fragment
round-trip test, `parse(serialize(state))` equals `state`, covering every form. Second: the
service worker cache version that nobody bumps. Guard: one VERSION constant, checked by a test.

Tests on `node:test` only: Reed-Solomon against the spec's worked example, format and version
bits against the tables, masks against hand-drawn grids, penalty scoring, and a round trip
through `zbarimg` where it is installed (skipped elsewhere).

## Performance (what is actually measurable)

Mask scoring at version 40 is about 1.6 M operations, 5 to 10 ms on a laptop, 40 to 80 ms on a
cheap phone; typical URLs land at version 2 to 6 and cost under 0.3 ms. So: synchronous encode,
coalesced to one per animation frame, no worker. Preview drawn at one pixel per module and
scaled with `image-rendering: pixelated`. A 4096 px PNG is 67 MB of RGBA and one to three
seconds on a phone, so 1024 is the default and 4096 the cap. Reed-Solomon, zip and page weight
are noise. Target under 40 KB for the whole page, system font stack, no web fonts.

## Hosting

Cloudflare Pages, Git integration, no build command, output directory `site/`. Adding the custom
domain creates the CNAME. GitHub Pages works as a fallback but cannot set headers, so the CSP
would be meta-only with no `frame-ancestors`.
