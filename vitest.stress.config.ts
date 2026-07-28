import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Stress / integration suite. These tests hit real Avalanche Fuji RPC endpoints
 * and real deployed contracts, so they are deliberately kept out of `npm test`:
 * they are slow, they depend on third-party uptime, and they consume endpoint
 * quota. Run them explicitly with `npm run test:stress`.
 *
 * Files use a `.stress.ts` suffix rather than `.test.ts` so the unit config's
 * `tests/**\/*.test.ts` glob can never pick them up by accident.
 */
export default defineConfig({
  test: {
    globals: true,
    // Node, not jsdom. Under jsdom, Vite resolves ethers' `browser` field to the
    // fetch-based transport, which mis-parses batched JSON-RPC responses ("bad
    // response data / invalid BytesLike value"). The Node build uses the
    // http/https modules and handles batches correctly, which is also what these
    // tests need to measure. Consequence: `window` is undefined here, so
    // `reportPluginError` no-ops — its dispatch path is covered by the unit
    // suite, which does run under jsdom.
    environment: 'node',
    // No setupFiles: tests/setup.ts mocks window.ethereum and needs a DOM.
    include: ['tests/stress/**/*.stress.ts'],
    // Real network round trips plus deliberate backoff; the load ramp is slowest.
    testTimeout: 240_000,
    hookTimeout: 60_000,
    // Measurements are request-count based, and the provider cache plus the
    // endpoint cooldown map are module-level singletons. Parallel files would
    // race on both and produce meaningless numbers.
    fileParallelism: false,
    // A retried stress test measures a warmed-up cache, not a cold one.
    retry: 0,
    // These tests exist to report numbers, and Vitest otherwise buffers console
    // output and only replays it for failing tests — which would hide every
    // measurement table on a green run.
    disableConsoleIntercept: true,
    reporters: ['verbose'],
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
