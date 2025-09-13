import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const rootNodeModules = path.resolve(__dirname, '../../node_modules');
const reactRoot = path.join(rootNodeModules, 'react');
const reactDomRoot = path.join(rootNodeModules, 'react-dom');

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    server: {
      deps: {
        inline: [/^react(\/.*)?$/, /^react-dom(\/.*)?$/],
      },
    },
  },
  resolve: {
    alias: [
      { find: /^react$/, replacement: reactRoot },
      { find: /^react\/jsx-runtime$/, replacement: path.join(reactRoot, 'jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: path.join(reactRoot, 'jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: reactDomRoot },
      { find: /^react-dom\/client$/, replacement: path.join(reactDomRoot, 'client.js') },
      { find: '@hola/shared', replacement: path.resolve(__dirname, '../shared/src') },
    ],
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
});
