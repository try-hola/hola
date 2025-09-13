import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: true,
  },
  resolve: {
    alias: [
      { find: '@hola/shared', replacement: path.resolve(__dirname, '../shared/src') },
      { find: '@hola/sdk', replacement: path.resolve(__dirname, '../sdk/src') },
    ],
  },
});
