# EquaLink server

FastAPI backend. Today it implements the **GitHub integration** (`/integrations/github`) **Sites** (`/sites`) and real **scans**; scan, fix and ship stages come later (see `Docs/EquaLink-Execution-Plan.md`).

## Run

```sh
cd server
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
# or with uv: uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
cp .env.example .env      # then edit, see below
.venv/bin/python -m playwright install chromium   # one-time: browser used for scans
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest
```

In `client/.env` keep `VITE_API_BASE_URL=http://localhost:8000` and `VITE_GITHUB_LIVE=true`. Scans stay mocked until their endpoints exist.

## Connect GitHub (pick one mode in `server/.env`)

**OAuth, "Sign in with GitHub" (recommended for dev).** At github.com/settings/developers create a **New OAuth App** with Homepage URL `http://localhost:5173` and Authorization callback URL `http://localhost:8000/integrations/github/oauth/callback`. Put its Client ID and a generated Client secret in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, then restart the server. The dashboard button becomes **Sign in with GitHub** and sends you to github.com. The user token (scope `repo`) is stored server-side in SQLite.

**Personal access token (no browser login).** Set `GITHUB_TOKEN` (classic: `repo` scope; fine-grained: Contents and Pull requests read/write). Click **Connect GitHub** in the dashboard and your repos appear.

**GitHub App (production).** Create an app at github.com/settings/apps with Contents (RW), Pull requests (RW) and Metadata (R). Set its **Setup URL** to `http://localhost:8000/integrations/github/callback`, then fill `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (or `_PATH`) and `STATE_SECRET`. Connect sends you to github.com to install the app, then back to the dashboard.

Priority if several are set: App, then OAuth, then token. Secrets live only in `.env`, which is git-ignored.

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/integrations/github` | Connection status and live repo list |
| POST | `/integrations/github/connect` | Token: connect now. OAuth/App: returns `install_url` to redirect to |
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
| POST | `/pull-requests` | Open a PR between existing branches in an enabled repository |

## Git provider strategies

`GitProvider` in `app/git_provider.py` defines the async `create_pull_request()` contract.
`GitHubAdapter` implements it using the existing GitHub HTTP client. The provider registry
in `app/git_providers.py` resolves the connected account's PAT, OAuth token, or GitHub App
installation token and constructs the adapter dynamically.

After connecting GitHub and enabling a repository, call `POST /pull-requests` with:

```json
{
  "provider": "github",
  "repo": "owner/repo",
  "title": "Fix accessibility issues",
  "head": "fix/accessibility",
  "base": "main",
  "body": "Description of the changes already committed to the head branch."
}
```

The response contains `number` and `url`. Both branches must already exist. This endpoint
does not generate fixes or enable scan shipping; `/scans/{id}/ship` still returns 501.
To add GitLab, implement `GitLabAdapter(GitProvider)` and register an async credential
factory under `gitlab`. GitLab account storage and connection setup will also be needed;
the current connection model stores GitHub accounts only.

## Scan content retention

Raw axe results (HTML, DOM selectors, and failure summaries) are processed only within
the page-analysis function and released in `finally`. SQLite, scan responses, and SSE
events contain only issue metadata; `html` and `selector` are empty and `context` is null.
The source-level issue preview is therefore unavailable. Scores, rule identifiers,
severity, scan URLs, repository settings, and integration credentials remain stored.
Startup scrubs legacy issue content, progress messages, and scan errors from the active
database. Existing backups and historical WAL/journal files require separate handling.

PR text is never saved locally. The route clears its parsed text fields after the provider
call, and the GitHub adapter releases its payload and echoed response in `finally` on
success, failure, or cancellation. The Git provider retains the PR explicitly sent to it.
Automatic fix generation and scan shipping are still unimplemented.

Application code writes no scan-content temporary files, screenshots, HARs, traces, or
download artifacts. Browser contexts disable downloads and service workers, request zero
disk/media cache, and close after scanning. Chromium still manages temporary profiles;
`tempfile` alone would not make those memory-only. For a strict infrastructure-level
memory-only guarantee, run browser profiles/temp storage on a RAM-backed filesystem and
control swap, crash dumps, logs, and backups. Python `del` releases references, not a
cryptographic wipe of immutable strings or browser/process memory.

## Pipeline limits

- A scan renders each page in headless Chromium and runs axe-core, then scores it (100 minus weighted issues). It does **not** yet call TinyFish, run the LLM fixer or re-verify, so scans end with issues awaiting human review and no fixes. axe-core cannot see everything: for example a `div` with `onclick` or a placeholder-only input is not flagged, which is what the planned LLM checks are for.
- `scope: site` follows up to `MAX_SITE_PAGES` same-origin links from the first page.
- `ALLOW_PRIVATE_TARGETS=true` lets scans hit localhost and private addresses. Turn it off when deployed.
- One connection for the whole server: there is no user login yet.
- The repo toggle is stored, but nothing opens PRs yet. That arrives with `POST /scans/{id}/ship`.
- Verified against the real GitHub API only for the error path (a bad token returns "Bad credentials"). The OAuth redirect and callback are unit-tested with mocks; a full sign-in needs your OAuth App credentials and has not been run here.
- The OAuth token is stored unencrypted in the local SQLite file (git-ignored). Encrypt it before deploying.


## W3C rules sync

`Docs > Reference documents` can fill itself from a TinyFish agent that researches the latest W3C/WCAG rules.

- Set `TINYFISH_API_KEY` in `.env`. `POST /rule-docs/sync` (the **Sync now** button) starts a run in the background; `GET /rule-docs/sync` reports progress and the outcome.
- The first run is started by a person. After a successful run the server repeats it every `W3C_SYNC_INTERVAL_DAYS` (default 30) while it is up; set `W3C_SYNC_SCHEDULE=false` to disable that. A failed run is retried after a day.
- **No duplicates:** a returned rule is stored only if no existing doc has the same WCAG success criterion (for example `1.4.3`) or the same normalized title. Stored rules are also listed in the agent's goal so it can skip them. A run that finds nothing new is a success.
- The agent prompt lives in `app/prompts/w3c_rules.md`. Each run uses TinyFish credits.
