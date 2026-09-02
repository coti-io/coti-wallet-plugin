import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/types/**', 'src/**/*.d.ts'],
      // Floors from the 2026-09-02 suite (92.91 / 94.26 / 93.9 / 85.13).
      thresholds: {
        statements: 92.9,
        lines: 94.2,
        functions: 93.9,
        branches: 85.1,
      },
    },
  },
  resolve: {
    alias: {
      '@coti-io/coti-sdk-typescript': path.resolve(__dirname, 'tests/__mocks__/coti-sdk.ts'),
      '@coti-io/coti-ethers': path.resolve(__dirname, 'tests/__mocks__/coti-ethers.ts'),
      '@coti-io/pod-sdk': path.resolve(__dirname, 'tests/__mocks__/pod-sdk.ts'),
      '@rainbow-me/rainbowkit/wallets': path.resolve(__dirname, 'tests/__mocks__/rainbowkit-wallets.ts'),
      '@rainbow-me/rainbowkit': path.resolve(__dirname, 'tests/__mocks__/rainbowkit.ts'),
    },
  },
});
