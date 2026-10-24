# EquaLink Client

Frontend dashboard for EquaLink (TanStack Start, React 19, Tailwind 4).

```sh
cp .env.example .env
npm install
npm run dev
```

Scripts: `dev`, `build`, `preview`, `lint`, `format`, `test`.

## Structure

```
src/routes/            File-based routes (one per sidebar item, plus /_design)
src/components/shell/  AppShell (sidebar, top bar, drawer), PagePlaceholder
src/components/ui/     Primitives
src/lib/               nav config, theme, utils
src/styles.css         Design tokens (dark on :root, light on [data-theme="light"])
```
