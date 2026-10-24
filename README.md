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

## Repository layout

```
Docs/        Execution plan, frontend build prompt, pitch deck and reference screenshots
client/      Frontend dashboard (TanStack Start, React 19, Tailwind 4)
server/      FastAPI backend: GitHub integration live; scan pipeline planned
demo-site/   "ShopEasy", a deliberately broken storefront used for demos  (planned)
```

`client/`, `server/` and `Docs/` exist today; the server currently implements the GitHub integration only (see `server/README.md`). See `Docs/EquaLink-Execution-Plan.md` for the full architecture, data model and API surface.

## Planned stack

| Layer | Choice |
|---|---|
| Frontend | React, Tailwind, `react-diff-viewer-continued`, `framer-motion`, Recharts |
| Backend | FastAPI (Python 3.11), `BackgroundTasks` + `asyncio`, SQLite via SQLModel |
| Live progress | Server-Sent Events (`/scans/{id}/events`) |
| Web ops | TinyFish Fetch / Agent / Search APIs |
| Rules engine | `axe-core` in headless Chromium via Playwright |
| LLM | Claude with structured JSON output, vision for alt text |
| Ship | GitHub App via `PyGithub` (PAT fallback for dev) |
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

See `server/README.md` to run it and connect GitHub.

Full set of variables the finished backend will need:

Environment variables the backend will need:

| Variable | Purpose |
|---|---|
| `TINYFISH_API_KEY` | TinyFish Fetch / Agent / Search |
| `ANTHROPIC_API_KEY` | Claude for diagnosis and fixes |
| `GITHUB_APP_ID` | GitHub App identity |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App signing key |
| `GITHUB_WEBHOOK_SECRET` | Webhook verification |
| `DEMO_MODE` | `replay` serves recorded TinyFish responses as a demo fallback |

Never commit secrets. `.env` files and `*.pem` keys are git-ignored.

## Accessibility

EquaLink is an accessibility product, so the dashboard targets WCAG 2.2 AA: semantic HTML, visible focus, full keyboard operation, and `prefers-reduced-motion` support. The goal is for EquaLink to pass its own scan.

## Docs

- [`Docs/EquaLink-Execution-Plan.md`](Docs/EquaLink-Execution-Plan.md): scope, architecture, pipeline, 24-hour schedule, risks, demo script
- [`Docs/Frontend-Build-Prompt.md`](Docs/Frontend-Build-Prompt.md): phased frontend spec and design system
- `Docs/EquaLink — HackIIITD 2026 Pitch.pdf`: pitch deck

## License

TBD. Add a license before making the repository public.
