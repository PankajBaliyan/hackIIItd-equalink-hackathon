# EquaLink

**Autonomous web-accessibility DevSecOps agent: scan → diagnose → fix → verify → open a GitHub PR.**

Built by Team Ainexatech for HackIIITD 2026. Existing scanners stop at a report. EquaLink closes the loop and ships the fix as a pull request.

> **Core principle:** the LLM never decides alone. Every proposed fix is re-validated by a rules engine (axe-core) before it is shipped. A fix that fails validation is marked "needs human review" and never reaches a PR.

## How it works

```
URL / repo ──► TinyFish renders + navigates ──► axe-core + LLM diagnose
          ──► LLM proposes fix (JSON) ──► axe re-validates ──► TinyFish re-verifies preview
          ──► GitHub App opens PR (WCAG-cited) ──► score 42 → 91 on dashboard
```

1. **Crawl:** TinyFish Fetch gets the fully rendered DOM and computed styles. The Agent API drives login and modal flows and keyboard traversal. Search maps the site.
2. **Diagnose:** axe-core runs in headless Chromium through Playwright. The LLM covers context checks axe can't do, such as meaningless alt text and link purpose.
3. **Fix:** deterministic fixers run first and the LLM second. The five launch fixers are `div onclick` → `button`, image alt text, low contrast, unlabeled form inputs, and focus traps in modals.
4. **Verify:** each patch is re-run through axe and re-rendered by TinyFish. A patch is accepted only if the issue count drops and nothing new appears.
5. **Ship:** a GitHub App opens a PR with a WCAG-cited body, before/after code and the score delta. Fixes are always PRs, never direct commits.

## Architecture

EquaLink's enterprise architecture follows a **Hybrid SaaS** model: a **Local Runner**
acts as the customer-side Data Plane, and a **Cloud Brain** provides the shared analysis
and orchestration service.

- **Local Runner:** [local_runner.py](./local_runner.py) runs inside the customer's network,
  fetches intranet HTML without exposing the site publicly, removes scripts and comments,
  and sends the remaining HTML through an outbound POST to a configured cloud endpoint.
  It requires no inbound connection into the intranet and writes no page-content files.
- **Cloud Brain:** the [FastAPI backend](./server/README.md) currently provides URL-based
  Playwright/axe-core scans, scores, metadata-only progress events, and PR creation between
  existing branches. `POST /api/hybrid-scan` accepts uploaded HTML, uses TinyFish to propose
  fixes to a configured repository HTML file, re-validates it with axe, and returns a PR
  link to the runner. The dashboard's URL-scan automatic fixing/shipping remains planned.
- **Provider strategies:** [GitProvider](./server/app/git_provider.py) defines
  `create_pull_request()`. [GitHubAdapter](./server/app/github_adapter.py) implements
  GitHub access, and the [provider registry](./server/app/git_providers.py) selects the
  strategy dynamically. Additional providers can implement the same contract.

The runner fetches source HTML rather than executing JavaScript. Removing scripts reduces
payload size; remaining page text and form values still cross the customer/cloud boundary.

## Security & Compliance

**Zero-Data Retention** is our policy for scanned HTML, DOM details, and generated fix
content. The implemented controls keep raw page-analysis results in memory, release them
after each page, and exclude HTML snippets, selectors, and failure context from SQLite,
API issue responses, and persisted SSE events. Startup scrubs legacy copies from the
active database. PR request text and echoed provider responses are released in `finally`
after success, failure, or cancellation. Hybrid uploads, repository source, and proposed
fixes follow the same in-memory lifecycle and are not saved to the application database.

This content policy permits operational metadata such as scan URLs, rule identifiers,
severity, scores, repository settings, and integration credentials to remain stored.
GitHub retains the commits and PR content explicitly submitted to it. TinyFish receives
uploaded HTML and repository source in its goal; its API exposes stored goals/results
through run records. Local cleanup does not erase third-party copies: an enterprise
retention agreement must be verified before sending confidential content. Python reference cleanup is
not secure memory erasure: strict deployment enforcement also requires RAM-backed browser
temporary storage and controls for swap, crash dumps, logs, and backups. See the
[backend retention details](./server/README.md#scan-content-retention) for these boundaries.

**Scoped GitHub App access** is the production integration model. Install the App only on
selected repositories, with **Contents: read/write**, **Pull requests: read/write**, and
**Metadata: read** permissions. EquaLink also requires the repository's PR toggle to be
enabled before its PR endpoint can open a request. App requests use installation tokens;
PAT and OAuth modes remain available for development. These modes have different scopes
and do not inherit the App's selected-repository restrictions.

Secrets stay server-side; local environment files and private keys are git-ignored.
The local runner supports a cloud bearer token supplied through an environment variable.
Use HTTPS for the cloud endpoint. These are implementation controls and deployment
requirements, not a claim of independent compliance certification.

## Repository layout

```
Docs/        Execution plan, frontend build prompt, pitch deck and reference screenshots
client/      Frontend dashboard (TanStack Start, React 19, Tailwind 4)
server/      FastAPI backend: scans, GitHub integration, provider strategies
local_runner.py  Customer-side intranet HTML fetch and cloud submission CLI
demo-site/   "ShopEasy", a deliberately broken storefront used for demos  (planned)
```

The server implements GitHub integration, URL-based scanning, and PR creation for existing
branches plus the configured hybrid HTML-to-PR workflow (see [server/README.md](./server/README.md)).
The dashboard's automatic URL-scan shipping remains planned. See
[the execution plan](./Docs/EquaLink-Execution-Plan.md) for the broader product design.
The existing Fixes review and shipping workflow is documented in `server/fixes/README.md`.

## Planned stack

| Layer | Choice |
|---|---|
| Frontend | React, Tailwind, `react-diff-viewer-continued`, `framer-motion`, Recharts |
| Backend | FastAPI (Python 3.11+), `asyncio`, PostgreSQL via SQLModel/SQLAlchemy |
| Live progress | Server-Sent Events (`/scans/{id}/events`) |
| Web ops | TinyFish Fetch / Agent / Search APIs |
| Rules engine | `axe-core` in headless Chromium via Playwright |
| LLM | Claude with structured JSON output, vision for alt text |
| Ship | `GitProvider` strategies with a GitHub REST adapter; App, OAuth, and PAT authentication |
| Deploy | Vercel (frontend), Render with Docker (backend) |

## Dashboard (3 screens)

1. **Scan:** URL, WCAG level (A/AA/AAA), scope (page or site), optional repo.
2. **Live agent scan:** terminal-style event feed, severity counters, stage progress.
3. **Fix & ship:** score gauge, issues grouped by WCAG principle, per-fix diff with a "validated ✓" badge, and an **Open PR** action.

The frontend runs without a backend by default, using a mock data layer. See `Docs/Frontend-Build-Prompt.md` for the phased build spec and design system.

## Getting started

### Frontend

```sh
cd client
cp .env.example .env     # VITE_USE_MOCKS=true runs against built-in mocks
npm install
npm run dev
```

| Script | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest |

To use the real backend, set `VITE_USE_MOCKS=false` and point `VITE_API_BASE_URL` at it (default `http://localhost:8000`).

### Backend (`server/`)

See [`server/README.md`](server/README.md) to run the API and connect GitHub. The
Fixes module lives in [`server/fixes/`](server/fixes/README.md).

PostgreSQL 18 is supported for GitHub, repository, and site data. From `server`, run
`powershell -ExecutionPolicy Bypass -File .\setup_postgres.ps1`; it securely prompts
for the local `postgres` password, creates the `equalink` database, and writes the
ignored `.env` file. Refresh the local PostgreSQL server in pgAdmin to see it.
It imports HTML snapshots and candidate fixes, validates them with axe-core,
persists review decisions, and opens GitHub PRs for selected validated fixes.

```sh
cd server
uv sync --dev
uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Install the frontend dependencies and Playwright Chromium as described in the
Fixes README before importing fixes. The frontend uses the backend by default;
set `VITE_USE_MOCKS=true` only for the browser-only scan demo. URL crawling and
automatic fix generation remain separate planned pipeline components.

Additional variables the finished scan pipeline will need:

| Variable | Purpose |
|---|---|
| `TINYFISH_API_KEY` | TinyFish Fetch / Agent / Search |
| `ANTHROPIC_API_KEY` | Claude for diagnosis and fixes |
| `GITHUB_APP_ID` | GitHub App identity |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App signing key |
| `GITHUB_WEBHOOK_SECRET` | Webhook verification |
| `DEMO_MODE` | `replay` serves recorded TinyFish responses as a demo fallback |

Never commit secrets. `.env` files and `*.pem` keys are git-ignored.

## Local intranet runner

`local_runner.py` is a standalone Python 3.11+ CLI with no third-party dependencies:

```powershell
python local_runner.py http://intranet.local/page --endpoint https://your-cloud.example/api/hybrid-scan
```

Alternatively set `EQUALINK_CLOUD_ENDPOINT`. Set `EQUALINK_CLOUD_TOKEN` in the runner's
environment to the server's `HYBRID_API_TOKEN` (`--token-env` selects another variable).
The runner fetches HTML locally, removes script elements and comments, sends only
`{"url": "http://intranet.local/page", "raw_html": "..."}`, and prints the response's `pr_url`.
Failures return exit code 1. `--timeout` sets the HTTP timeout in seconds, default 360.

Configure `HYBRID_REPO`, `HYBRID_FILE_PATH` (an existing `.html`/`.htm` file),
`HYBRID_BASE_BRANCH`, `HYBRID_API_TOKEN`, and `TINYFISH_API_KEY` on the server. Connect GitHub
and enable that repository's PR toggle. The server fetches the original source file so
runner-side script removal does not remove application code from the resulting commit.
Only fixes that preserve scripts and reduce axe violations without increasing another
rule/severity count are committed to a new branch. No-op/unverified fixes return an error.
See [hybrid endpoint setup](./server/README.md#hybrid-html-to-pr) for limits and retention boundaries.
The runner fetches source HTML without JavaScript rendering. It preserves semantic markup,
styles, and event-handler attributes for accessibility checks; it is not a sanitizer for
personal data, and remaining page text/form values are sent to the configured endpoint.
All payload processing is in memory, with a 5 MiB source limit; no page files are written.

## Dashboard accessibility

EquaLink is an accessibility product, so the dashboard targets WCAG 2.2 AA: semantic HTML, visible focus, full keyboard operation, and `prefers-reduced-motion` support. The goal is for EquaLink to pass its own scan.

## Roadmap

- **Expand the Hybrid SaaS workflow:** add multi-file/template-aware fixes, per-tenant URL-to-source
  mappings, and dashboard integration for the hybrid endpoint and validated scan shipping.
- **GitLab integration:** add `GitLabAdapter(GitProvider)`, provider-specific credentials
  and account storage, and registry selection for merge request creation.
- **Bitbucket integration:** add `BitbucketAdapter(GitProvider)` with repository-scoped
  authentication and pull request creation through the same strategy contract.
- **VS Code “Shift-Left” extension:** bring accessibility diagnostics and proposed fixes
  into the editor before changes reach CI, with developer review and the same content
  retention policy.

## Docs

- [`Docs/EquaLink-Execution-Plan.md`](Docs/EquaLink-Execution-Plan.md): scope, architecture, pipeline, 24-hour schedule, risks, demo script
- [`Docs/Frontend-Build-Prompt.md`](Docs/Frontend-Build-Prompt.md): phased frontend spec and design system
- `Docs/EquaLink — HackIIITD 2026 Pitch.pdf`: pitch deck

## License

TBD. Add a license before making the repository public.
