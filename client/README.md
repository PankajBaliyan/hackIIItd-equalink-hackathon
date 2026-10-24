# EquaLink Client

Frontend dashboard for EquaLink: scan → diagnose → fix → verify → open a GitHub PR. TanStack Start, React 19, Tailwind 4.

## Setup

```sh
cp .env.example .env
npm install
npm run dev        # http://localhost:5173
```

| Variable | Default | Purpose |
|---|---|---|
| `VITE_USE_MOCKS` | `true` | `true` runs the whole app on built-in mock data. |
| `VITE_API_BASE_URL` | `http://localhost:8000` | FastAPI backend base URL. |

**Switching to the real backend:** set `VITE_USE_MOCKS=false` and point `VITE_API_BASE_URL` at it. No code changes. The client expects `POST /scans`, `GET /scans`, `GET /scans/:id`, `POST /scans/:id/ship` and the SSE stream at `GET /scans/:id/events` (see `Docs/EquaLink-Execution-Plan.md`).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (includes `jsx-a11y`) |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Playwright: axe on every route in both themes, plus the full mock demo flow |

First run of the e2e tests needs `npx playwright install chromium`.

## Structure

```
src/routes/            File-based routes, one per sidebar item (plus /_design)
src/components/shell/  AppShell, sidebar, top bar, accessibility badge
src/components/scan/   New Scan form, pipeline graphic, live feed, score ring
src/components/fixes/  Fixes page, diff viewer, score gauge, PR card
src/components/ui/     Design-system primitives (see /_design)
src/lib/               types, api client, SSE, mocks, scoring, WCAG metadata, theme
src/state/             scanStore (Context + useReducer)
e2e/                   Playwright specs
src/styles.css         Design tokens (dark on :root, light on [data-theme="light"])
```
