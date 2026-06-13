import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Allow web package to import from the local workspace package
      '@hola/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    // Allow Vite dev server to read files from the monorepo root (so it can load @hola/shared via workspace)
    fs: {
      allow: ['..'],
    },
    proxy: {
      // Target the local server by default; the compose dev override points
      // this at the server container (http://hola-server:3001).
      '/api': {
        target: process.env.HOLA_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // Ensure Rollup can resolve the local workspace package path
    rollupOptions: {
      // nothing externalized; resolve via alias
    },
    commonjsOptions: {
      include: [/shared/, /node_modules/],
    },
  },
});
