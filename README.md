# Nexora

React 19 + Vite frontend (`src/`) with an Express 5 + `node:sqlite` API (`backend/`).

## Run it

```powershell
npm install; npm --prefix backend install
npm run dev:all
```

`dev:all` starts the API on **8787** and Vite on **5173** together, so the page can never
be open while its backend is forgotten. Open `http://localhost:5173`. The frontend calls
relative `/api` URLs that Vite proxies to the API, so a second Vite port (`:5174`), the
printed LAN address or a phone on the same Wi-Fi all work — no CORS setup, no `VITE_API_URL`.
Without `OPENAI_API_KEY` in `backend/.env` the API streams mock replies, so every flow is
demonstrable offline. Individual commands: `npm run dev` (web only), `npm run dev:api`
(API only), `npm run build`, `npm run lint`, `npm --prefix backend test`.

### One-process mode

After `npm run build`, the API serves the built app itself — **`http://localhost:8787`** is
the whole product (page + `/api` + `/uploads` on one origin, no Vite needed). Useful for a
test build or showing the app to someone; edit `src/` and you are back in dev mode. Set
`HOSTED_CLIENT=0` in `backend/.env` for an API-only process.

> Whatever address you open, the page always talks to itself: a request that fails means
> the server behind that address is not running, never a CORS rule. `Failed to fetch` in
> the browser used to look like a wrong password — that class is now structurally impossible.

## React + Vite template notes

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
