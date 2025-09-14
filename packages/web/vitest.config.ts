import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react({
    // Explicitly configure JSX for tests
    jsxImportSource: 'react',
    include: ['**/*.tsx', '**/*.jsx', '**/*.ts', '**/*.js'],
  })],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: true,
    // Add more specific test configuration
    css: false,
    deps: {
      inline: ['@hola/shared', '@hola/sdk'],
    },
  },
  resolve: {
    alias: [
      { find: '@hola/shared', replacement: path.resolve(__dirname, '../shared/src') },
      { find: '@hola/sdk', replacement: path.resolve(__dirname, '../sdk/src') },
    ],
  },
  esbuild: {
    // Ensure JSX is handled correctly
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
});
