# Security Review

Date: 2026-10-04

## Finding

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | ⚪ LOW | [wrangler.jsonc](./wrangler.jsonc) | 7-9 | The Cloudflare asset directory previously exposed repository files, including API source, migrations, and backups. | 10/10 |

## Resolution

The static Cloudflare deployment now uses the isolated [`public/`](./public/) directory. API source, database migrations, backups, Git metadata, and environment files are no longer in the deployed asset directory. Sensitive-path checks returned HTTP 404 after deployment.

Additional protections added:

- Explicit CORS origin allowlisting.
- Origin validation for credentialed requests.
- D1-backed IP rate limits for login and write requests.
- Security response headers and a restrictive content security policy.
- No-store caching for owner and customer portal pages.
- Remote D1 migration for rate-limit state.
