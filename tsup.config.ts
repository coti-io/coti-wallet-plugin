import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  // Avoid wiping dist mid-watch rebuild — Vite HMR can reload index.mjs before
  // index.mjs.map is rewritten, causing ENOENT source-map warnings.
  clean: !process.argv.includes('--watch'),
  external: [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom',
    'ethers',
    'viem',
    'wagmi',
    '@coti-io/coti-sdk-typescript',
    '@coti-io/coti-ethers',
    '@coti-io/pod-sdk',
    '@metamask/providers',
    '@rainbow-me/rainbowkit',
    '@rainbow-me/rainbowkit/wallets',
    '@tanstack/react-query',
  ],
});
