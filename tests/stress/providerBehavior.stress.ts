import { describe, it, expect, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { createJsonRpcProvider, resetRpcProviderState } from '../../src/lib/rpcProvider';
import { RpcMeter } from './helpers/rpcMeter';
import {
  ERC20_BALANCE_ABI,
  FUJI_CHAIN_ID,
  FUJI_TOKENS,
  READ_ACCOUNT,
  probeEndpoint,
  table,
} from './helpers/fuji';

/**
 * Measures what the provider actually puts on the wire against live Fuji.
 *
 * These are the claims the request-volume work rests on, checked against a real
 * endpoint rather than a mock: no `eth_chainId` shadow request, concurrent
 * reads batched into one round trip, and providers reused across calls.
 */

// Ava Labs' own endpoint: the most consistently available of the configured set
// (see liveEndpoints.stress.ts), so measurements are not lost to third-party
// flakiness. Behaviour under test is transport-independent.
const MEASURE_URL = 'https://api.avax-test.network/ext/bc/C/rpc';

/** The read set a real Fuji refresh performs: native balance + every public ERC-20. */
const readPublicBalances = async (runner: ethers.Provider) => {
  const tokens = [FUJI_TOKENS.MTT, FUJI_TOKENS.USDC, FUJI_TOKENS.WAVAX];
  return Promise.all([
    runner.getBalance(READ_ACCOUNT),
    ...tokens.map(address =>
      new ethers.Contract(address, ERC20_BALANCE_ABI, runner).balanceOf(READ_ACCOUNT),
    ),
  ]);
};

describe('provider behaviour against live Fuji', () => {
  beforeEach(() => {
    resetRpcProviderState();
  });

  it('reaches the measurement endpoint', async () => {
    const health = await probeEndpoint(MEASURE_URL);
    expect(health.ok, `measurement endpoint unavailable: ${health.error}`).toBe(true);
    expect(health.blockNumber).toBeGreaterThan(0);
  });

  it('sends no eth_chainId, because staticNetwork resolves it from config', async () => {
    const meter = new RpcMeter();
    await meter.attach(createJsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID));

    const provider = createJsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID);
    await provider.getBalance(READ_ACCOUNT);

    expect(meter.countMethod('eth_chainId')).toBe(0);
    expect(meter.countMethod('eth_getBalance')).toBe(1);
  });

  it('batches a whole balance refresh into a single HTTP round trip', async () => {
    const meter = new RpcMeter();
    await meter.attach(createJsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID));

    const balances = await readPublicBalances(createJsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID));

    // Real values, not stubs: this account holds MTT on Fuji.
    expect(balances).toHaveLength(4);
    expect(balances.some(b => (b as bigint) > 0n)).toBe(true);

    expect(meter.rpcCalls).toBe(4);
    expect(meter.roundTrips).toBe(1);
    expect(meter.maxBatchSize).toBe(4);
  });

  it('reuses one provider instance per (chainId, url)', () => {
    const first = createJsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID);
    expect(createJsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID)).toBe(first);
    // Distinct key, distinct instance.
    expect(createJsonRpcProvider(MEASURE_URL, 11155111)).not.toBe(first);
  });

  it('cuts round trips versus the previous per-call provider construction', async () => {
    // Reproduces the old createJsonRpcProvider exactly: a fresh provider per
    // call, no staticNetwork. Each read therefore pays for its own eth_chainId
    // and cannot share a batch queue with any other read.
    const legacyMeter = new RpcMeter();
    const legacyRead = async (fn: (p: ethers.JsonRpcProvider) => Promise<unknown>) => {
      const provider = new ethers.JsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID);
      await legacyMeter.attach(provider);
      return fn(provider);
    };
    await Promise.all([
      legacyRead(p => p.getBalance(READ_ACCOUNT)),
      ...[FUJI_TOKENS.MTT, FUJI_TOKENS.USDC, FUJI_TOKENS.WAVAX].map(address =>
        legacyRead(p => new ethers.Contract(address, ERC20_BALANCE_ABI, p).balanceOf(READ_ACCOUNT)),
      ),
    ]);

    resetRpcProviderState();
    const currentMeter = new RpcMeter();
    await currentMeter.attach(createJsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID));
    await readPublicBalances(createJsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID));

    console.log(
      '\n[round trips for one 4-read balance refresh]\n'
        + table([
          ['', 'http round trips', 'rpc calls', 'eth_chainId'],
          [
            'per-call provider',
            String(legacyMeter.roundTrips),
            String(legacyMeter.rpcCalls),
            String(legacyMeter.countMethod('eth_chainId')),
          ],
          [
            'memoized + static',
            String(currentMeter.roundTrips),
            String(currentMeter.rpcCalls),
            String(currentMeter.countMethod('eth_chainId')),
          ],
        ]),
    );

    // Same useful work either way.
    expect(currentMeter.countMethod('eth_call')).toBe(legacyMeter.countMethod('eth_call'));
    // But far fewer requests for the endpoint's rate limiter to count.
    expect(currentMeter.roundTrips).toBeLessThan(legacyMeter.roundTrips);
    expect(currentMeter.countMethod('eth_chainId')).toBe(0);
    expect(legacyMeter.countMethod('eth_chainId')).toBeGreaterThan(0);
  });

  it('keeps batches within the configured batchMaxCount', async () => {
    const meter = new RpcMeter();
    await meter.attach(createJsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID));
    const provider = createJsonRpcProvider(MEASURE_URL, FUJI_CHAIN_ID);

    // 25 concurrent reads against a batchMaxCount of 10.
    const contract = new ethers.Contract(FUJI_TOKENS.MTT, ERC20_BALANCE_ABI, provider);
    await Promise.all(Array.from({ length: 25 }, () => contract.balanceOf(READ_ACCOUNT)));

    expect(meter.maxBatchSize).toBeLessThanOrEqual(10);
    // Still dramatically fewer round trips than one-per-call.
    expect(meter.roundTrips).toBeLessThan(25);
  });
});
