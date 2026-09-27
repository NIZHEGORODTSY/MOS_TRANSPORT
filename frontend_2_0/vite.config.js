import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // the backend CORS allows only :5173 — fail loudly instead of silently moving to :5174
  server: {
    port: 5173,
    strictPort: true,
    // the app calls the backend on its own origin (/api, /ws), as behind nginx in docker
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/ws': {target: 'ws://127.0.0.1:8000', ws: true},
    },
  },
})
