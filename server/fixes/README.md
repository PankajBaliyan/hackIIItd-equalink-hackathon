# Fixes module

All Fixes API models, validation, persistence, GitHub integration, examples, and
tests live in `server/fixes/`. `server/main.py` provides the application entry point.

Run from the repository root (PowerShell):

```powershell
Set-Location server
uv sync --dev
npm.cmd --prefix ../client ci
Push-Location ../client
npx.cmd playwright install chromium
Pop-Location
Copy-Item .env.example .env
uv run uvicorn main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
npm.cmd --prefix client run dev -- --host 127.0.0.1
```

The frontend uses the real backend by default. If `client/.env` already exists,
set `VITE_USE_MOCKS=false` and restart Vite. Open
http://localhost:5173/scans/demo/fixes. Interactive API documentation is at
http://127.0.0.1:8000/docs.

If you use `uv` from inside `server/`, install dependencies into that virtual
environment and start the entry point from there:

```powershell
uv sync --dev
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Only one backend may listen on port 8000. Stop an existing instance before
starting another. If you choose a different port, update `VITE_API_BASE_URL`
in `client/.env` and restart Vite.

## Import and review actual fixes

1. Adapt `server/fixes/example_scan.json` to your HTML, repository and candidate fixes.
   `page_html` must be a complete rendered HTML snapshot, including inline styles
   needed for contrast checks. Imported scripts never execute and external
   stylesheets, fonts, frames and images are not loaded. This is snapshot
   validation, not a live browser crawl or a full accessibility certification.
2. Use **Import fixes for review** on the home or Fixes page. You can also POST
   the JSON to `/scans/import`. Each issue must have a unique selector matching
   the actual axe rule and a snippet occurring exactly once. Each candidate's
   `original` must equal its issue's `html`. IDs are scoped to a scan.
3. The backend runs axe on the original document and each candidate. A candidate
   must remove the reproduced rule at its selector, reduce the number of
   violating nodes, and introduce no new rule/selector violations. Indeterminate
   target checks are rejected. Unsupported behavioral findings can be imported
   without candidates and remain **Needs review**. Counts shown per fix are
   document-wide axe violation node counts, not a WCAG score.
4. Select an issue to review its diff. Inclusion changes persist in PostgreSQL and
   survive reloads. Rejected candidates cannot be selected. The backend's demo
   uses actual axe validation of illustrative HTML and cannot be shipped.

This module accepts issues and proposed fixes from a scanner or a person; it
does not generate fixes or implement URL crawling. `POST /scans` explicitly
returns 501 until that pipeline is connected. No fabricated scores, TinyFish
verification results, or GitHub PR URLs are returned by the backend.

## Open an actual GitHub PR

Configure one of the GitHub App, OAuth, or token modes in `server/.env`, restart
FastAPI, then use **GitHub** in the sidebar to connect and enable the target
repository. The Fixes ship endpoint uses that server-side connection. The
legacy `GITHUB_REPOSITORIES` allowlist remains available when this module runs
standalone with a PAT. No token belongs in a `VITE_` environment variable.

Import a real snapshot with `repo` and an exact repository-relative `source_file`
for every selected issue. The source on the repository's `main` branch must
contain each selected original snippet exactly once. The backend revalidates
the combined HTML patch, reads all source files at one pinned main commit,
checks every replacement, creates one atomic Git tree/commit on a new branch,
then opens a PR. Source mismatch returns 409 before creating a remote branch.
Rendered HTML snippets that differ from JSX/templates require an upstream
source mapping; the backend refuses to guess. Review application behavior and
image descriptions manually; static axe checks cannot establish their accuracy.

Repeat shipping requests recover the same branch/PR, including when a previous
network response was lost. Fix selection is frozen for retries once GitHub has
been contacted. Concurrent shipping requests return 409. A process crash during
shipping conservatively leaves an `in_progress` reservation; inspect the
corresponding GitHub branch/PR before an administrator resets that database row.

## API

| Method | Path | Response |
| --- | --- | --- |
| GET | `/health` | Service health |
| POST | `/scans/import` | 201: validated scan, issues, fixes, summary |
| GET | `/scans` | Persisted scans, including an axe-checked demo |
| GET | `/scans/{id}` | Full scan detail and existing PR |
| GET | `/scans/{id}/fixes?status=all` | Fixes; also `validated`, `rejected`, `included` |
| PATCH | `/scans/{id}/fixes/{fix_id}` | Updated detail; body `{"included":false}` |
| POST | `/scans/{id}/ship` | Real PR metadata; body `{"fix_ids":["fix-image-1"]}` |
| GET | `/pull-requests` | Persisted PRs |
| GET | `/scans/{id}/events` | Completion SSE event for imported scans |
| GET | `/integrations/github` | Token account and configured repositories |
| POST | `/integrations/github/connect` | Validate server token and enable shipping |
| DELETE | `/integrations/github` | Disable shipping without deleting server credentials |
| PATCH | `/integrations/github/repos` | Toggle an allowlisted repository |

Errors have a readable `detail`; malformed payloads also include field `errors`.
404 means unknown scan/fix/source, 422 means invalid or ineligible data, 409
means source/selection/concurrency conflict, 503 means missing validation or
GitHub configuration, and 502 means an upstream GitHub failure. HTTP failures
never include tokens or full HTML inputs.

Production uses the shared `DATABASE_URL`; both fixes and PR records are stored
in the `fix_scans` table. Tests can still pass a temporary SQLite path. Configure
`FIXES_DATABASE_URL` only to use a separate database, and configure `CORS_ORIGINS`
in `server/.env` if needed. Bind to loopback
for local development. This service has no user authentication or tenancy;
add those before exposing it to other users or deploying publicly.

## Checks

```powershell
python -m unittest discover -s server/fixes/tests -v
npm.cmd --prefix client test
```

Backend tests use isolated temporary databases and mocked GitHub/axe adapters;
they never open real PRs. A separate end-to-end browser check exercises real
axe validation and the frontend against a running local backend.
