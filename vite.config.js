import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/* Dev/preview API proxy. The frontend talks to the backend through THIS server
   (relative /api and /uploads URLs — see API_BASE in src/api/nexora.js), so every
   request is same-origin and CORS cannot fail. That kills a whole class of
   "Failed to fetch" traps: Vite rolling to :5174/:5175 when a port is busy, opening
   the app through the printed Network URL (http://192.168.x.x:5173) or from a phone,
   and localhost vs 127.0.0.1 mismatches. Point VITE_API_URL somewhere else to bypass
   the proxy (e.g. a deployed backend); production builds keep the absolute default. */
const API_TARGET = process.env.VITE_API_URL || 'http://localhost:8787'
const apiProxy = Object.fromEntries(
  ['/api', '/uploads'].map((prefix) => [prefix, { target: API_TARGET, changeOrigin: true }]),
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
