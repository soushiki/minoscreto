# 08 · Maintenance log

## Summary
Running log of maintenance items. Open items first; monthly checklist lives in the sdlc stage file.

| date | type | item | size | status |
|------|------|------|------|--------|
| 2026-10-25 | bug | iOS/iPadOS: auto dictionary download (500 ms timer, no tap) may be dropped, yet step 2 is ticked | S | fixed, pending device test |
| 2026-10-24 | security | Security headers (gap from 0.3.0 release) | XS | done, deployed 21a2e2d |

## Notes
- **iOS dictionary download (2026-10-25).** The dictionary was fired 500 ms after the click, outside the tap; iOS
  Safari tends to drop such downloads, and the anchor fallback always reports success, so step 2 got a false ✓.
  Fix: `isAppleTouch()` (`src/viewmodels/platform.js`, iPhone/iPod/iPad incl. iPadOS-as-Mac) makes
  `useProtectedDownload` skip the timer; the receipt shows a primary «Descargar diccionario» button and ticks
  step 2 only after that tap. Desktop/Android unchanged; the .zip path was already one file. 160 green (new iPhone
  test fails pre-fix). Open: real-device check on iPhone + iPad, and Mac Safari (auto path, may ask to allow downloads).
  Also noted: lookbehind regexes need Safari/iOS ≥ 16.4; older ones get a blank page (not addressed).
- **Security headers (2026-10-24).** Static headers in `netlify.toml`: nosniff, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS. The CSP is generated at build time into `dist/_headers`
  by the `minoscreto-csp` plugin in `vite.config.js`: script-src is the sha256 of every inline script,
  `connect-src 'none'`, `worker-src blob: data:` (pdf.js worker in line), Google Fonts allowed for style and font.
  Verified locally by serving `dist` with these headers: home renders, fonts load, PDF read + name tagging,
  export downloads (blob), zero CSP violations; a test `fetch` to an outside host is blocked. 158 tests green.
  Live (minoscreto.netlify.app, 21a2e2d): all 6 headers served, CSP hash matches the inline script, PDF smoke OK,
  no app violations. The CSP blocks Netlify's injected `/.netlify/scripts/hud` (console error, harmless);
  to silence it, turn off the Netlify Drawer/toolbar for production in the Netlify UI.
