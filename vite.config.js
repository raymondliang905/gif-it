import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Default base is root ('/'), which is correct for Vercel/Netlify/Cloudflare
  // Pages (served at the subdomain root) and for a future custom domain. The
  // GitHub Pages project site is the odd one out — it serves this repo under
  // /gif-it/, not root — so that workflow passes `vite build --base=/gif-it/`
  // to override this at build time (see .github/workflows/deploy-pages.yml).
  // Vite prefixes build output (and injects import.meta.env.BASE_URL) with
  // whichever base is active; see src/lib/encoder-worker.js and the logo
  // <img> tags for the handful of asset references that read it explicitly.
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
