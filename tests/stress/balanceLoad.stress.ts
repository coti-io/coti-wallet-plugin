import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import {
  createJsonRpcProvider,
  isRateLimitedRpcError,
  resetRpcProviderState,
  withRpcFallback,
} from '../../src/lib/rpcProvider';
import { RpcMeter, percentile } from './helpers/rpcMeter';
import {
  ERC20_BALANCE_ABI,
  FUJI_CHAIN_ID,
  FUJI_TOKENS,
  FUJI_URLS,
  READ_ACCOUNT,
  labelFor,
  table,
} from './helpers/fuji';

/**
 * Sustained-load behaviour: how many concurrent balance refreshes the provider
 * absorbs before endpoints start refusing, and whether fallback keeps reads
 * succeeding when they do.
 *
 * Deliberately modest by default — these are shared public endpoints and the
 * QuikNode key is a shared quota. Override with STRESS_MAX_CONCURRENCY and
 * STRESS_ROUNDS if you want a harder push.
 */

const MAX_CONCURRENCY = Number(process.env.STRESS_MAX_CONCURRENCY ?? 8);
const ROUNDS = Number(process.env.STRESS_ROUNDS ?? 2);

/** One unit of work = the public balance refresh a Fuji wallet performs. */
const refreshPublicBalances = (provider: ethers.JsonRpcProvider) => {
  const tokens = [FUJI_TOKENS.MTT, FUJI_TOKENS.USDC, FUJI_TOKENS.WAVAX];
  return Promise.all([
    provider.getBalance(READ_ACCOUNT),
    ...tokens.map(address =>
      new ethers.Contract(address, ERC20_BALANCE_ABI, provider).balanceOf(READ_ACCOUNT),
    ),
  ]);
};

type RoundResult = {
  concurrency: number;
  ok: number;
  failed: number;
  rateLimited: number;
  p50: number;
  p95: number;
  roundTrips: number;
};

describe('balance-read load against live Fuji', () => {
  const meter = new RpcMeter();

  beforeAll(async () => {
    // Attach once per configured endpoint. Providers are memoized, so these are
    // the same instances withRpcFallback will use.
    for (const url of FUJI_URLS) {
      await meter.attach(createJsonRpcProvider(url, FUJI_CHAIN_ID));
    }
  });

  beforeEach(() => {
    meter.reset();
  });

  it(`absorbs concurrent balance refreshes up to ${MAX_CONCURRENCY}x`, async () => {
    const levels = [1, 2, 4, 8, 16, 32].filter(n => n <= MAX_CONCURRENCY);
    const results: RoundResult[] = [];

    for (const concurrency of levels) {
      const latencies: number[] = [];
      let ok = 0;
      let failed = 0;
      let rateLimited = 0;
      meter.reset();

      for (let round = 0; round < ROUNDS; round++) {
        const work = Array.from({ length: concurrency }, async () => {
          const started = Date.now();
          try {
            const balances = await withRpcFallback(FUJI_CHAIN_ID, refreshPublicBalances);
            latencies.push(Date.now() - started);
            expect(balances).toHaveLength(4);
            ok++;
          } catch (error) {
            failed++;
            if (isRateLimitedRpcError(error)) rateLimited++;
          }
        });
        await Promise.all(work);
      }

      results.push({
        concurrency,
        ok,
        failed,
        rateLimited,
        p50: Math.round(percentile(latencies, 50)),
        p95: Math.round(percentile(latencies, 95)),
        roundTrips: meter.roundTrips,
      });
    }

    console.log(
      '\n[balance refresh under load]\n'
        + table([
          ['concurrency', 'ok', 'failed', 'rate-limited', 'p50', 'p95', 'http round trips'],
          ...results.map(r => [
            String(r.concurrency),
            String(r.ok),
            String(r.failed),
            String(r.rateLimited),
            `${r.p50}ms`,
            `${r.p95}ms`,
            String(r.roundTrips),
          ]),
        ]),
    );

    // The contract under load is not "never rate-limited" — public endpoints
    // throttle and that is expected. It is that fallback keeps reads succeeding.
    for (const result of results) {
      expect(
        result.ok,
        `every refresh failed at concurrency ${result.concurrency}`,
      ).toBeGreaterThan(0);
    }

    const total = results.reduce((n, r) => n + r.ok + r.failed, 0);
    const succeeded = results.reduce((n, r) => n + r.ok, 0);
    expect(succeeded / total, 'success rate collapsed under load').toBeGreaterThan(0.9);
  });

  it('keeps round trips well below one-per-read under concurrency', async () => {
    resetRpcProviderState();
    for (const url of FUJI_URLS) {
      await meter.attach(createJsonRpcProvider(url, FUJI_CHAIN_ID));
    }
    meter.reset();

    const concurrentRefreshes = 6;
    await Promise.all(
      Array.from({ length: concurrentRefreshes }, () =>
        withRpcFallback(FUJI_CHAIN_ID, refreshPublicBalances),
      ),
    );

    const readsIssued = concurrentRefreshes * 4;
    console.log(
      `\n[batching under concurrency] ${readsIssued} reads -> ${meter.rpcCalls} rpc call(s) `
        + `in ${meter.roundTrips} round trip(s), max batch ${meter.maxBatchSize}`,
    );

    // Two separate savings compound here, and both depend on the shared provider:
    //   1. ethers' 250ms response cache collapses identical concurrent reads, so
    //      fewer rpc calls are issued than reads requested.
    //   2. whatever survives is batched into a handful of round trips.
    // A fresh provider per call defeated both — every read was its own request.
    expect(meter.rpcCalls).toBeLessThanOrEqual(readsIssued);
    expect(meter.roundTrips).toBeLessThan(readsIssued / 2);
    expect(meter.countMethod('eth_chainId')).toBe(0);
  });

  it('reports which endpoints carried the load', async () => {
    resetRpcProviderState();
    const used = new Map<string, number>();
    const createProvider = (url: string, chainId: number) => {
      used.set(url, (used.get(url) ?? 0) + 1);
      return createJsonRpcProvider(url, chainId);
    };

    await Promise.all(
      Array.from({ length: 8 }, () =>
        withRpcFallback(FUJI_CHAIN_ID, refreshPublicBalances, { createProvider }).catch(() => null),
      ),
    );

    console.log(
      '\n[endpoint attempts during load]\n'
        + table([
          ['endpoint', 'attempts'],
          ...FUJI_URLS.map(url => [labelFor(url), String(used.get(url) ?? 0)]),
        ]),
    );

    expect([...used.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
