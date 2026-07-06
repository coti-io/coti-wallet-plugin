import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
