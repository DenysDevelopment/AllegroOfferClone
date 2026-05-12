import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, frontend runs on $PORT (default 5173) and proxies /api to the
// Express server on http://localhost:3000.
// In prod, the Express server serves the built bundle from web/dist.
export default defineConfig({
  plugins: [react()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
