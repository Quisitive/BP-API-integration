// ---------------------------------------------------------------------------
// Vite Configuration — SOC Dashboard SPA
// ---------------------------------------------------------------------------
// Replaces Create React App (deprecated) with Vite for:
//   - Faster HMR during development
//   - Smaller, optimized production bundles
//   - ESM-native build pipeline
//   - Proxy configuration for backend API
// ---------------------------------------------------------------------------

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  // Load all env vars from .env files (no prefix filter) so CRA-style
  // REACT_APP_* keys are available to the define shim below.
  const env = loadEnv(mode, __dirname, '');

  return {
  plugins: [react()],

  root: '.',
  publicDir: 'public',

  // Shim CRA-style process.env references used in client code so they resolve
  // at build time (Vite runs this config in Node, where process.env exists).
  define: {
    'process.env.REACT_APP_BLACKPOINT_API_KEY': JSON.stringify(
      env.REACT_APP_BLACKPOINT_API_KEY || '',
    ),
    'process.env.REACT_APP_BLACKPOINT_TENANT_ID': JSON.stringify(
      env.REACT_APP_BLACKPOINT_TENANT_ID || '',
    ),
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },

  server: {
    port: 3000,
    proxy: {
      // Backend Express API (unified SOC dashboard)
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Legacy BP Dashboard — forward /v1/* to the CompassOne API
      // (replaces the CRA src/setupProxy.js, which Vite does not use).
      '/v1': {
        target: env.BLACKPOINT_API_URL || 'https://api.blackpointcyber.com',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          msal: ['@azure/msal-browser', '@azure/msal-react'],
        },
      },
    },
  },
  };
});
