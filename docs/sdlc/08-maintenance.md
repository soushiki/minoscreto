# 08 · Maintenance log

## Summary
Running log of maintenance items. Open items first; monthly checklist lives in the sdlc stage file.

| date | type | item | size | status |
|------|------|------|------|--------|
| 2026-10-24 | security | Security headers (gap from 0.3.0 release) | XS | done locally, not committed/deployed |

## Notes
- **Security headers (2026-10-24).** Static headers in `netlify.toml`: nosniff, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS. The CSP is generated at build time into `dist/_headers`
  by the `minoscreto-csp` plugin in `vite.config.js`: script-src is the sha256 of every inline script,
  `connect-src 'none'`, `worker-src blob: data:` (pdf.js worker in line), Google Fonts allowed for style and font.
  Verified locally by serving `dist` with these headers: home renders, fonts load, PDF read + name tagging,
  export downloads (blob), zero CSP violations; a test `fetch` to an outside host is blocked. 158 tests green.
  Pending: commit, deploy, then check the live response headers (`curl -sI <site>`) and repeat the smoke.
