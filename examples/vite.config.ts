import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sdkPath = path.resolve(__dirname, '../../coti-sdk-typescript');

// Deduplicate shared dependencies to avoid multiple React/wagmi/query contexts
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      '@tanstack/react-query',
      'wagmi',
      'viem',
      '@rainbow-me/rainbowkit',
      '@coti-io/coti-sdk-typescript',
    ],
    alias: {
      '@coti-io/coti-sdk-typescript': sdkPath,
    },
  },
  optimizeDeps: {
    include: ['@coti-io/coti-sdk-typescript'],
  },
  build: {
    commonjsOptions: {
      include: [/coti-sdk-typescript/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
});
