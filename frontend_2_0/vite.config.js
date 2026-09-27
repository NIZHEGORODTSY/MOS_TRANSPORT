import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // the backend CORS allows only :5173 — fail loudly instead of silently moving to :5174
  server: {
    port: 5173,
    strictPort: true,
  },
})
