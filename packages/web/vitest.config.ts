import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react({
    // Use the automatic JSX transform.
    jsxRuntime: 'automatic',
    include: ['**/*.tsx', '**/*.jsx'],
  })],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: true,
    // Add more specific test configuration
    css: false,
    deps: {
      // Use new optimizer configuration instead of deprecated inline
      optimizer: {
        web: {
          include: ['@hola/shared', '@hola/sdk', 'react', 'react-dom'],
        },
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      // Force single React instance from workspace root for both react and react-dom
      { find: 'react', replacement: path.resolve(__dirname, '../../node_modules/react') },
      { find: 'react-dom', replacement: path.resolve(__dirname, '../../node_modules/react-dom') },
      { find: '@hola/shared', replacement: path.resolve(__dirname, '../shared/src') },
      { find: '@hola/sdk', replacement: path.resolve(__dirname, '../sdk/src') },
    ],
  },
});
