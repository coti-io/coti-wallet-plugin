import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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
    ],
    alias: {
      // Force all imports to resolve to the example app's node_modules copy
      '@tanstack/react-query': path.resolve(__dirname, 'node_modules/@tanstack/react-query'),
      wagmi: path.resolve(__dirname, 'node_modules/wagmi'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
});
