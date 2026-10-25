# 7 · Release

## Runbook
- **Build:** `npm ci && npm test && npm run build` → `dist/index.html` (one self-contained file, ~2.3 MB).
- **Deploy target:** Netlify, built from GitHub `soushiki/minoscreto` on every push to `main`
  (`netlify.toml`: `npm run build`, publish `dist`, Node 22). Deploying = `git push origin main`.
- **Env/secrets:** none. All processing happens in the browser; the app makes no network calls (S1 test guard).
- **Pre-flight:** clean tree, 158+ tests green, `npm audit` 0, secret scan of the history + `dist/index.html`
  (no gitleaks installed: regex scan for key/token patterns; install gitleaks for later releases).
- **Health check:** the site loads, pasting a sample text produces `[PERSONA_n]` tags, the browser console shows no errors.
- **Smoke:** the 4 steps in `06-test-report.md` § Smoke.
- **Rollback:** Netlify → Deploys → pick the last good deploy → "Publish deploy" (instant), or
  `git revert <range> && git push origin main`.
- **Tags:** `git tag v<version> && git push origin v<version>` after the deploy is verified.
- **CI (suggested, not set up):** a GitHub Actions workflow on PRs that runs `npm ci`, `npm test`,
  `npm run build`, `npm audit --audit-level=high`, gitleaks (full history) and CodeQL (JS).
- **Monitoring:** static site with no backend → no RED dashboard; Netlify deploy notifications cover failed builds.

## Pre-flight findings (0.3.0)
- Tests 158/158, build OK, `npm audit` 0 vulnerabilities, no secrets in the history or the bundle, no debug endpoints,
  CORS, credentials or API. Commits d27188f..HEAD: 19 files, +461/−37.
- **Gap:** `netlify.toml` sets no security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`/`frame-ancestors`). Since the bundle inlines its scripts, a CSP would need
  `'unsafe-inline'` or hashes. Open as a follow-up, not a blocker (the app has no auth, no cookies and no remote data).

## Releases
<!-- date | version | result -->
2026-10-24 | 0.3.0 | pushed a4bd9f9 to main (Netlify deploy), tagged v0.3.0; prod smoke PASS (4/4, user)
