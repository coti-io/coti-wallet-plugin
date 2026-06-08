import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
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
    '@metamask/providers',
    '@rainbow-me/rainbowkit',
    '@tanstack/react-query',
  ],
});
