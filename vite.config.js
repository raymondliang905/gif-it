import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages project site serves this repo under /gif-it/, not root.
  // Vite prefixes build output (and injects import.meta.env.BASE_URL) with
  // this value; see src/lib/encoder-worker.js and the logo <img> tags for the
  // handful of asset references that read it explicitly.
  base: '/gif-it/',
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
