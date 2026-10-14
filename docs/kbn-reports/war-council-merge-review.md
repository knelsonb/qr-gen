# War council merge review: `war-council` into `main`

Date 2026-10-14. Base `main` at 097e336 plus the edge-cache fix. Reviewed tree: the site, tests,
tools and deploy files, about 3,100 lines. Twelve reviewers, every finding triaged, the fixes in
four commits on this branch.

## Summary

The encoder and the geometry held up under every check: round trips through zbar at versions 1,
7, 36 and 40 with all eight masks, alignment and format bits against the spec tables, the logo
pad blanked at every version and fraction. The defects were at the edges: state that merged a
shared link into the recipient's own settings, a Wi-Fi paste parser that mis-split an escaped
backslash, nine Kanji characters given a vendor code instead of the JIS one, a script-link block
that a tab character slipped past, and a deploy path that let the edge pair new HTML with
cached old scripts, which is what "Text doesn't work" turned out to be.

## Review history

| Reviewer | Role | Findings (critical, warning, note) | Status |
|---|---|---|---|
| Sauron | coordinates, units, state | 0, 3, 10 | 3 warnings fixed, 7 notes fixed, 3 deferred |
| Gandalf | architecture, PR readiness | 0, 6, 4 | 4 warnings fixed, 2 partly, notes fixed |
| Frodo | user experience | 0, 12, 6 | 11 warnings fixed, 4 notes fixed, 3 deferred |
| Aragorn | security | 0, 2, 8 | both warnings fixed, 6 notes fixed, 2 deferred |
| Legolas | performance | 0, 5, 7 | 3 warnings fixed, 2 deferred as design choices |
| Gimli | build, deploy, CI | 0, 6, 7 | all warnings fixed, 5 notes fixed |
| Ents | test coverage | 3, 6, 5 | 3 criticals fixed (they were real bugs), 5 tests added |
| Uruk-Hai, encoder | bugs | 2 | 1 fixed, 1 kept as the reference behaviour |
| Uruk-Hai, payload | bugs | 4 | all fixed |
| Uruk-Hai, app | bugs | 5 | all fixed |
| Gollum | style, dead code | 9 | all fixed |

## Key findings by severity

Critical, all fixed:

- `payload/detect.js` (was `ui.js`): a pasted Wi-Fi string with a password ending in a backslash
  lost the password and the hidden flag. The split regex treated an escaped backslash as an
  escaped separator. Replaced with a tokenizer; the builder's own output now round-trips.
- `qr/kanji.js`: nine characters that Shift JIS reaches through the vendor row 0x8740 to 0x879C
  were stored with the vendor code, which readers reject. The first JIS mapping now wins and the
  vendor row is skipped.
- `payload/builders.js`: coordinates below one millionth went out in exponent notation; `geo:`
  now carries the digits as typed.
- `payload/inspect.js`: `java<tab>script:` passed the scheme block in Text and Batch. Schemes are
  now read with control characters removed, as browsers do.
- Deploy: scripts were cached at the edge for an hour while the HTML was not, so a deploy served
  new markup with old code. Every file except the fonts is now `no-cache`; the service worker
  caches a whole version at once and the deploy script stamps it with the commit.

Warnings, fixed:

- A settings link merged into the recipient's existing state (Sauron). Links now replace the
  style and the content fields, and the caption travels only with content.
- Inches and millimetres shared one range and switching the unit kept the number (Sauron, Frodo).
  The width converts on a unit change; inches accept tenths.
- Clamped numbers were not written back to their fields (Sauron).
- Button feedback for copy, share and size errors went into the collapsed pane (Frodo, earlier
  round) and Forget's confirmation did too; both now sit beside their buttons.
- The phone bar counted a code hidden behind the bar as visible and stole focus (Frodo).
- Advice said "lower the correction" while a logo forced High (Frodo).
- Empty states showed headings over nothing; screen readers heard nothing when a code vanished
  (Frodo). Panes hide their sections without a code and the live region reports the reason.
- WPA with no password built a code that never joins (Frodo); warned now.
- nginx: `server_tokens`, GET only, a 1 KB body cap, gzip, an exact match for security.txt so
  the dot-file rule cannot deny it, and the font cache keyed on the content type so a 404 is not
  cached for a week (Aragorn, Gimli).
- The account certificate from `cloudflared tunnel login` stayed in the container (Aragorn).
  Deleted; the tunnel runs on its own credentials under `/etc/cloudflared`.
- Batch SVGs dropped the logo and title (Gollum).
- CI ran no browser test and skipped the decoder round trips silently (Gimli, Gandalf). The
  workflow installs zbar on the runner, runs the smoke test in Chrome, and a missing tool fails
  under CI instead of skipping.
- `ui.js` held domain logic the exports imported (Gandalf). Split into `model.js`, `dom.js`,
  `export.js` and `payload/detect.js`; a test now checks the page's field names against the
  schema in both directions.
- The self-check ran the browser's decoder on every keystroke (Legolas); debounced.
- The module waterfall on a first visit (Legolas): `modulepreload` for the chain and a font
  preload.

Notes fixed: the "Rendering…" label stuck after overlapping clicks, logo results landing out of
order, a stale self-check under an empty preview, a custom size smaller than the code, JPEG
fill bytes before the SOF marker, "Infinity bytes over", wrong batch line numbers after blank
lines, the clipboard fallback overwriting a user's clipboard on a permission error, SMS numbers
with a colon, events ending before they start, crypto amounts like `.5`, the manifest's dual
purpose icon, the text export ignoring the border setting, saved size reported as requested
rather than drawn, export canvases not released, a stale link banner on the second link, Forget
leaving the fragment in the URL, and the comment and naming items from Gollum.

## Deferred

- Mask rule 3 keeps the reference implementation's extra condition (Uruk-Hai, encoder). It only
  changes which valid mask is chosen; recorded in the README.
- Mask scoring and segmentation speed at version 40 (Legolas, 80 ms): acceptable for a code
  nobody should print; the readable version stays.
- Print counts a cancelled dialog; browsers do not report the outcome (Sauron, Frodo).
- Drawing nothing until a paste offer is answered (Frodo); the offer is shown with the code.
- Trusted Types in the CSP (Aragorn): the service worker registration is a Trusted Types sink
  in Chrome, so enabling it needs a policy object first.
- Running cloudflared as a dedicated user (Aragorn); nginx workers already run as www-data.
- Web Analytics: the zone injects Cloudflare's beacon into every HTML response for browser
  requests. The CSP stops it from running, and the live smoke test flags it. Turning it off is a
  zone-level setting that also affects www, so it is the owner's call; documented in
  `deploy/README.md`.

## Fix log

| Commit | Scope |
|---|---|
| 1 | app: module split, link semantics, units, UX wording, empty states, phone bar, announcements |
| 2 | payload and encoder: Wi-Fi tokenizer, scheme normalisation, raw-host script check, Kanji mapping, JPEG fill bytes, SMS, geo, event, crypto |
| 3 | deploy, CI and tests: nginx hardening, versioned worker, deploy scripts, CI with zbar and Chrome, schema test, new unit tests |
| 4 | docs and this report |

Verification on the branch: 44 unit tests pass with zbar and unzip present; the headless
Chromium smoke run passes against the local copy. Against the live site the same run fails only
on the Web Analytics beacon request, which is the deferred item above.
