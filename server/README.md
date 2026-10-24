# EquaLink server

FastAPI backend for real **Scans**, **Fixes**, **Pull Requests**, **GitHub integration**, and **Sites**.

## Run

```sh
cd server
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
# or with uv: uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
uv sync --dev
# Windows: creates the local equalink DB and server/.env after a secure password prompt
powershell -ExecutionPolicy Bypass -File .\setup_postgres.ps1
uv run playwright install chromium   # one-time: browser used for scans
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
.venv/bin/python -m pytest
```

In `client/.env` keep `VITE_API_BASE_URL=http://localhost:8000`,
`VITE_USE_MOCKS=false`, and `VITE_GITHUB_LIVE=true`.

## Connect GitHub (pick one mode in `server/.env`)

**OAuth, "Sign in with GitHub".** At github.com/settings/developers create a **New OAuth App** with Homepage URL `http://localhost:5173` and Authorization callback URL `http://localhost:8000/integrations/github/oauth/callback`. Put its Client ID and a generated Client secret in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, then restart the server.

**Personal access token (easiest locally).** Open **GitHub** in the dashboard, click
**Open GitHub token page**, create a fine-grained token with Contents and Pull
requests read/write, paste it into the form, and connect. The token is submitted
directly to FastAPI and is never saved in browser storage or returned by the API.

**GitHub App (production).** Create an app at github.com/settings/apps with Contents (RW), Pull requests (RW) and Metadata (R). Set its **Setup URL** to `http://localhost:8000/integrations/github/callback`, then fill `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (or `_PATH`) and `STATE_SECRET`. Connect sends you to github.com to install the app, then back to the dashboard.

Priority if several are set: App, then OAuth, then token. Secrets live only in `.env`, which is git-ignored.

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/integrations/github` | Connection status and live repo list |
| POST | `/integrations/github/connect` | Server token: connect. OAuth/App: return `install_url` |
| POST | `/integrations/github/token` | Validate and store a token pasted in the dashboard |
| GET | `/integrations/github/callback` | App install redirect target |
| GET | `/integrations/github/oauth/callback` | OAuth redirect target |
| PATCH | `/integrations/github/repos` | Enable or disable PRs on a repo |
| DELETE | `/integrations/github` | Disconnect and clear settings |
| POST | `/scans` | Start a scan: `{url, repo?, level, scope}` |
| GET | `/scans` | List scans |
| GET | `/scans/{id}` | Scan, issues and fixes |
| GET | `/scans/{id}/events` | SSE progress stream (supports `Last-Event-ID`) |
| POST | `/scans/{id}/ship` | 501 until automatic fixes exist |
| GET | `/sites` | List tracked sites |
| POST | `/sites` | Add a site: `{url, repo?}` (bare domains get https://, duplicates rejected) |
| DELETE | `/sites/{id}` | Stop tracking a site |
| GET | `/health` | Liveness and active GitHub mode |
| POST | `/scans/import` | Import and validate candidate accessibility fixes |
| GET | `/scans/{id}` | Fixes screen data: scan, issues, fixes, summary, PR |
| PATCH | `/scans/{id}/fixes/{fix_id}` | Include or exclude a validated fix |
| POST | `/scans/{id}/ship` | Revalidate and open one atomic GitHub PR |
| GET | `/pull-requests` | Persisted PRs for the Pull Requests screen |

## Limits

- A scan renders each page in headless Chromium and runs axe-core, then scores it (100 minus weighted issues). It does **not** yet call TinyFish, run the LLM fixer or re-verify, so scans end with issues awaiting human review and no fixes. axe-core cannot see everything: for example a `div` with `onclick` or a placeholder-only input is not flagged, which is what the planned LLM checks are for.
- `scope: site` follows up to `MAX_SITE_PAGES` same-origin links from the first page.
- `ALLOW_PRIVATE_TARGETS=true` lets scans hit localhost and private addresses. Turn it off when deployed.
- One connection for the whole server: there is no user login yet.
- GitHub tokens are stored server-side in PostgreSQL. Add application-level secret encryption before a public deployment.
- The repo toggle is stored, but nothing opens PRs yet. That arrives with `POST /scans/{id}/ship`.
- Verified against the real GitHub API only for the error path (a bad token returns "Bad credentials"). The OAuth redirect and callback are unit-tested with mocks; a full sign-in needs your OAuth App credentials and has not been run here.
- The OAuth token is stored unencrypted in the local SQLite file (git-ignored). Encrypt it before deploying.


## W3C rules sync

`Docs > Reference documents` can fill itself from a TinyFish agent that researches the latest W3C/WCAG rules.

- Set `TINYFISH_API_KEY` in `.env`. `POST /rule-docs/sync` (the **Sync now** button) starts a run in the background; `GET /rule-docs/sync` reports progress and the outcome.
- The first run is started by a person. After a successful run the server repeats it every `W3C_SYNC_INTERVAL_DAYS` (default 30) while it is up; set `W3C_SYNC_SCHEDULE=false` to disable that. A failed run is retried after a day.
- **No duplicates:** a returned rule is stored only if no existing doc has the same WCAG success criterion (for example `1.4.3`) or the same normalized title. Stored rules are also listed in the agent's goal so it can skip them. A run that finds nothing new is a success.
- The agent prompt lives in `app/prompts/w3c_rules.md`. Each run uses TinyFish credits.
