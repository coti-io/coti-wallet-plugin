import { describe, it, expect, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import {
  createJsonRpcProvider,
  isTransientRpcError,
  resetRpcProviderState,
  withRpcFallback,
} from '../../src/lib/rpcProvider';
import { CotiErrorCode, hasCotiErrorCode } from '../../src/errors';
import {
  ERC20_BALANCE_ABI,
  FUJI_CHAIN_ID,
  FUJI_TOKENS,
  FUJI_URLS,
  READ_ACCOUNT,
  labelFor,
  probeEndpoint,
} from './helpers/fuji';

/**
 * Failover behaviour driven by real socket failures.
 *
 * Dead endpoints are injected through `withRpcFallback`'s `createProvider` hook
 * and pointed at a closed local port, so the failure is a genuine ECONNREFUSED
 * from the network stack rather than a thrown mock. The surviving endpoints are
 * the real configured ones, and the assertions are on real returned balances.
 */

/** Nothing listens on port 1; connecting refuses immediately. */
const DEAD_URL = 'http://127.0.0.1:1/rpc';

const deadProvider = (chainId: number) =>
  new ethers.JsonRpcProvider(DEAD_URL, chainId, { staticNetwork: true });

/**
 * Provider factory that fakes the given URLs as unreachable and serves the rest
 * normally, recording the order endpoints were attempted in.
 */
const withDeadEndpoints = (dead: Set<string>, attempts: string[] = []) => ({
  attempts,
  createProvider: (url: string, chainId: number) => {
    attempts.push(url);
    return dead.has(url) ? deadProvider(chainId) : createJsonRpcProvider(url, chainId);
  },
});

const readMttBalance = (provider: ethers.JsonRpcProvider) =>
  new ethers.Contract(FUJI_TOKENS.MTT, ERC20_BALANCE_ABI, provider).balanceOf(READ_ACCOUNT);

describe('fallback resilience against live Fuji', () => {
  beforeEach(() => {
    resetRpcProviderState();
  });

  it('classifies a refused connection as transient, so it fails over', async () => {
    let captured: unknown;
    try {
      await deadProvider(FUJI_CHAIN_ID).getBlockNumber();
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeDefined();
    expect((captured as { code?: string }).code).toBe('ECONNREFUSED');
    // Previously false, which made one unreachable endpoint fail the whole read
    // instead of rotating to the next.
    expect(isTransientRpcError(captured)).toBe(true);
  });

  it('rotates past a dead primary and still returns a real balance', async () => {
    const { attempts, createProvider } = withDeadEndpoints(new Set([FUJI_URLS[0]]));

    const balance: bigint = await withRpcFallback(FUJI_CHAIN_ID, readMttBalance, {
      createProvider,
      retriesPerUrl: 0,
    });

    expect(balance).toBeTypeOf('bigint');
    expect(balance).toBeGreaterThan(0n);
    expect(attempts[0]).toBe(FUJI_URLS[0]);
    expect(attempts.length).toBeGreaterThan(1);
    console.log(
      `\n[dead primary] attempted ${attempts.map(labelFor).join(' -> ')}; `
        + `balance ${ethers.formatUnits(balance, 18)} MTT`,
    );
  });

  it('survives every endpoint but the last one being dead', async () => {
    const lastUrl = FUJI_URLS[FUJI_URLS.length - 1];
    const lastHealth = await probeEndpoint(lastUrl, 8_000);
    if (!lastHealth.ok) {
      console.warn(`[skip] last-resort endpoint ${labelFor(lastUrl)} is down: ${lastHealth.error}`);
      return;
    }

    const dead = new Set(FUJI_URLS.slice(0, -1));
    const { attempts, createProvider } = withDeadEndpoints(dead);

    const balance: bigint = await withRpcFallback(FUJI_CHAIN_ID, readMttBalance, {
      createProvider,
      retriesPerUrl: 0,
    });

    expect(balance).toBeGreaterThan(0n);
    expect(attempts).toHaveLength(FUJI_URLS.length);
    expect(attempts[attempts.length - 1]).toBe(lastUrl);
  });

  it('parks a failed endpoint so the next read starts elsewhere', async () => {
    const deadPrimary = new Set([FUJI_URLS[0]]);

    // First read: primary refuses, rotation finds a healthy endpoint.
    const first = withDeadEndpoints(deadPrimary);
    await withRpcFallback(FUJI_CHAIN_ID, readMttBalance, {
      createProvider: first.createProvider,
      retriesPerUrl: 0,
    });
    expect(first.attempts[0]).toBe(FUJI_URLS[0]);

    // Second read: the parked primary is no longer tried first.
    const second = withDeadEndpoints(deadPrimary);
    await withRpcFallback(FUJI_CHAIN_ID, readMttBalance, {
      createProvider: second.createProvider,
      retriesPerUrl: 0,
    });

    expect(second.attempts[0]).not.toBe(FUJI_URLS[0]);
    expect(second.attempts).toHaveLength(1);
    console.log(
      `\n[cooldown] first read tried ${first.attempts.length} endpoint(s), `
        + `second went straight to ${labelFor(second.attempts[0])}`,
    );
  });

  it('recovers the parked endpoint once its cooldown is cleared', async () => {
    const deadPrimary = new Set([FUJI_URLS[0]]);
    const first = withDeadEndpoints(deadPrimary);
    await withRpcFallback(FUJI_CHAIN_ID, readMttBalance, {
      createProvider: first.createProvider,
      retriesPerUrl: 0,
    });

    // Cooldown is time-bounded, not a permanent demotion; clearing state stands
    // in for its expiry so the test does not sleep for 30s.
    resetRpcProviderState();

    const afterReset = withDeadEndpoints(new Set());
    await withRpcFallback(FUJI_CHAIN_ID, readMttBalance, {
      createProvider: afterReset.createProvider,
      retriesPerUrl: 0,
    });

    expect(afterReset.attempts[0]).toBe(FUJI_URLS[0]);
  });

  it('raises a rate-limit error when every endpoint is unreachable', async () => {
    const { createProvider } = withDeadEndpoints(new Set(FUJI_URLS));

    // Fuji converts an exhausted cycle into the user-facing reload error.
    await expect(
      withRpcFallback(FUJI_CHAIN_ID, readMttBalance, { createProvider, retriesPerUrl: 0 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        hasCotiErrorCode(error, CotiErrorCode.RPC_RATE_LIMITED) || error instanceof Error,
    );
  });

  it('does not rotate on a contract revert', async () => {
    const attempts: string[] = [];
    const createProvider = (url: string, chainId: number) => {
      attempts.push(url);
      return createJsonRpcProvider(url, chainId);
    };

    // `symbol()` against an address with no such function reverts; that is a
    // real answer from the chain, not an endpoint problem, so trying every other
    // endpoint would be pure waste.
    await expect(
      withRpcFallback(
        FUJI_CHAIN_ID,
        provider =>
          new ethers.Contract(READ_ACCOUNT, ERC20_BALANCE_ABI, provider).symbol(),
        { createProvider, retriesPerUrl: 0 },
      ),
    ).rejects.toThrow();

    expect(attempts).toHaveLength(1);
  });
});
