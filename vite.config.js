import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API port must come from the same env var the server reads, or overriding
// it (WEB_PORT=3000 PORT=3001 ./start.sh) starts both processes on the new ports
// while the proxy keeps pointing at the old one — the app loads but every AI
// call silently fails.
const API_PORT = process.env.PORT ?? 8787

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
})
