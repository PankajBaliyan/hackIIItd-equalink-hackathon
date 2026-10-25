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

## Connect GitHub in `server/.env`

**OAuth, "Sign in with GitHub".** At github.com/settings/developers create a **New OAuth App** with Homepage URL `http://localhost:5173` and Authorization callback URL `http://localhost:8000/integrations/github/oauth/callback`. Put its Client ID and Client secret in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, then restart the server. The dashboard button becomes **Sign in with GitHub** and sends you to github.com. The user token (scope `repo`) is stored server-side in SQLite.

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/integrations/github` | Connection status and live repo list |
| POST | `/integrations/github/connect` | Returns OAuth `install_url` to redirect to |
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

## Limits

- A scan renders each page in a browser and runs axe-core on it, then scores it (100 minus weighted issues). With `TINYFISH_API_KEY` set, public URLs are rendered in a **TinyFish remote browser** (Browser API over CDP); `localhost` and private addresses use local Chromium because TinyFish cannot reach them. `SCAN_ENGINE` (`auto` default, `tinyfish`, `local`) overrides this, and the scan's `engine` field says which one ran. If TinyFish can't start a browser, or a site answers it with a bot-protection page (for example Cloudflare's "Just a moment…"), `auto` retries with local Chromium; a forced `tinyfish` scan fails instead. A blocked page is never scored. TinyFish sessions cost $0.002 per minute and are always ended when the scan finishes. The scan does **not** yet run the LLM fixer or re-verify, so scans end with issues awaiting human review. axe-core cannot see everything: for example a `div` with `onclick` or a placeholder-only input is not flagged, which is what the planned LLM checks are for.
- `scope: site` crawls the site breadth-first: it follows same-origin links on every page it scans, up to `MAX_SITE_PAGES` pages (default 20). A page that fails to load is skipped; pages beyond the limit are reported in the scan log.
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


## Repo (source code) scans

`POST /scans` with `{"target": "repo", "repo": "owner/repo"}` scans the repository's code instead of a rendered page (the **GitHub repo** option on New Scan).

- It reads the repo with the connected GitHub account (public repos work without one) and checks `.html`, `.jsx`, `.tsx`, `.vue`, `.svelte` and `.astro` files. `node_modules`, build output, tests and stories are skipped, up to `SOURCE_MAX_FILES` files, app folders (`src`, `app`, `pages`, `components`, ...) first.
- **Static checks** (always on, in `app/source_rules.py`): missing `alt`, unlabeled inputs, empty buttons and links, click handlers on non-interactive elements, missing `lang`, frames without a title, videos without captions, positive `tabindex`, and viewports that block zoom. They only fire when the markup alone proves the problem; a `{...props}` spread skips the tag.
- **OpenAI review** (optional, needs `OPENAI_API_KEY`): the first `SOURCE_LLM_MAX_FILES` files go to the model with your saved W3C rules as reference, to find what static rules can't (heading order, focus management, ARIA misuse, error text, contrast of hard-coded colors). Each reported issue is checked against the files that were sent, and a failure or refusal never fails the scan.
- Every issue has `source_file`, `source_line` and a `detector` (`static` or `claude`), and links to that line on GitHub. Saved W3C rules are attached by success criterion as in rendered scans.
- It does not render anything, so it can't measure computed color contrast, and it only sees markup that is in the files (not what a framework generates at runtime).
