# EquaLink server

FastAPI backend. Today it implements the **GitHub integration** that powers the dashboard's `/integrations/github` page; scan, fix and ship stages come later (see `Docs/EquaLink-Execution-Plan.md`).

## Run

```sh
cd server
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -e . pytest pytest-asyncio
cp .env.example .env      # then edit, see below
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest
```

In `client/.env` keep `VITE_API_BASE_URL=http://localhost:8000` and `VITE_GITHUB_LIVE=true`. Scans stay mocked until their endpoints exist.

## Connect GitHub (pick one mode in `server/.env`)

**A. Personal access token (quickest for dev).** Set `GITHUB_TOKEN` (classic: `repo` scope; fine-grained: Contents and Pull requests read/write). Click **Connect GitHub** in the dashboard and your repos appear.

**B. GitHub App (production).** Create an app at github.com/settings/apps with Contents (RW), Pull requests (RW) and Metadata (R). Set its **Setup URL** to `http://localhost:8000/integrations/github/callback`, then fill `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (or `_PATH`) and `STATE_SECRET`. Connect sends you to github.com to install the app, then back to the dashboard.

If both are set, the App wins. Secrets live only in `.env`, which is git-ignored.

## Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/integrations/github` | Connection status and live repo list |
| POST | `/integrations/github/connect` | PAT: connect now. App: returns `install_url` |
| GET | `/integrations/github/callback` | App install redirect target |
| PATCH | `/integrations/github/repos` | Enable or disable PRs on a repo |
| DELETE | `/integrations/github` | Disconnect and clear settings |
| GET | `/health` | Liveness and active GitHub mode |

## Limits

- One connection for the whole server: there is no user login yet.
- The repo toggle is stored, but nothing opens PRs yet. That arrives with `POST /scans/{id}/ship`.
- Verified against the real GitHub API only for the error path (a bad token returns "Bad credentials"). Listing repos with a valid token or App has not been run here.
