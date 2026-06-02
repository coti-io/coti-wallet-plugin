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
    },
  },
  resolve: {
    alias: {
      '@coti-io/coti-sdk-typescript': path.resolve(__dirname, 'tests/__mocks__/coti-sdk.ts'),
      '@coti-io/coti-ethers': path.resolve(__dirname, 'tests/__mocks__/coti-ethers.ts'),
      '@rainbow-me/rainbowkit': path.resolve(__dirname, 'tests/__mocks__/rainbowkit.ts'),
    },
  },
});
