import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Im Entwicklungsbetrieb liegt die Oberfläche auf 4300 und die API auf 4301.
// Die 4300 ist bewusst dieselbe Adresse wie im Betrieb – so ändert sich beim
// Wechsel zwischen Entwicklung und Container nichts im Browser.
// Im Container liefert die API das gebaute Frontend selbst aus.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: Number(process.env.MAPPE_PORT ?? 4300),
    proxy: {
      '/api': {
        target: process.env.API_URL || 'http://localhost:4301',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
})
