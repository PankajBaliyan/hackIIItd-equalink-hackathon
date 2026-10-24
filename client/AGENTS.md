## Architecture rules
- Design tokens live in src/styles.css (dark on :root, light on [data-theme="light"]); components use semantic utilities only — keeps both themes AA-checked in one place.
- Sidebar items and page placeholder copy come from src/lib/nav.ts — one source for nav, titles and routes.
- App shell (sidebar, top bar, skip link, main landmark) wraps <Outlet /> in src/routes/__root.tsx — every page gets the same landmarks.
