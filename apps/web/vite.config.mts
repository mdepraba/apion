/// <reference types='vitest' />
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web',
  server: {
    port: 4200,
    host: 'localhost',
    // The SPA and API are same-origin in production, where Fastify serves the
    // built assets. In development the proxy keeps that true so nothing has to
    // know about CORS or a second base URL.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  preview: {
    port: 4300,
    host: 'localhost',
  },
  plugins: [
    // Must precede the React plugin: it generates the route tree the app imports.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      // A test beside the routes it covers is not itself a route.
      routeFileIgnorePattern: '[.]spec[.]tsx?$',
    }),
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: '@apion/web',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
