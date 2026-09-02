import { describe, it, expect, vi, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { configureCotiPlugin } from '../../src/config/plugin';
import { SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';
import { COTI_TESTNET_CHAIN_ID } from '../../src/chains/coti';
import { AVALANCHE_FUJI_CHAIN_ID } from '../../src/chains/avalancheFuji';
import {
  isTransientRpcError,
  isRateLimitedRpcError,
  resolveRpcUrlsForChain,
  markFujiPrimaryRateLimited,
  markPrimaryRateLimited,
  withRpcFallback,
  waitForTransactionResilient,
  createJsonRpcProvider,
} from '../../src/lib/rpcProvider';

describe('rpcProvider remaining branches', () => {
  afterEach(() => {
    configureCotiPlugin({ sepoliaRpcUrl: undefined, cotiTestnetRpcUrl: undefined });
  });

  it('classifies string, empty, nested status, and SERVER_ERROR transients', () => {
    expect(isTransientRpcError('')).toBe(false);
    expect(isTransientRpcError('ETIMEDOUT')).toBe(true);
    expect(isTransientRpcError({ code: 'TIMEOUT' })).toBe(true);
    expect(isTransientRpcError({ code: 'NETWORK_ERROR' })).toBe(true);
    expect(isTransientRpcError({ code: 'SERVER_ERROR' })).toBe(true);
    expect(isTransientRpcError({ info: { responseStatus: '429' } })).toBe(true);
    expect(isTransientRpcError({ status: 'too many requests' })).toBe(true);
    expect(isRateLimitedRpcError({ error: { code: '-32005' } })).toBe(true);
    expect(isRateLimitedRpcError({ data: { httpStatus: 429 } })).toBe(true);
  });

  it('stringifies circular Error payloads without throwing', () => {
    const err = new Error('coalesce') as Error & { info?: unknown };
    const circular: { self?: unknown } = {};
    circular.self = circular;
    err.info = circular;
    expect(isTransientRpcError(err)).toBe(false);
  });

  it('resolves COTI RPC override and unknown/null chain ids', () => {
    expect(resolveRpcUrlsForChain(undefined).length).toBeGreaterThan(0);
    configureCotiPlugin({ cotiTestnetRpcUrl: 'https://custom-coti.example' });
    expect(resolveRpcUrlsForChain(COTI_TESTNET_CHAIN_ID)[0]).toBe('https://custom-coti.example');
    markFujiPrimaryRateLimited();
    markPrimaryRateLimited(SEPOLIA_CHAIN_ID);
    const fuji = resolveRpcUrlsForChain(AVALANCHE_FUJI_CHAIN_ID);
    expect(fuji.length).toBeGreaterThan(1);
  });

  it('rethrows non-transient errors from withRpcFallback and wraps non-Error last failures', async () => {
    await expect(withRpcFallback(SEPOLIA_CHAIN_ID, async () => {
      throw new Error('execution reverted');
    })).rejects.toThrow('execution reverted');

    await expect(withRpcFallback(SEPOLIA_CHAIN_ID, async () => {
      throw 'not-an-error';
    })).rejects.toThrow(/All RPC endpoints failed|not-an-error/);
  });

  it('throws when waitForTransactionResilient is called without a hash', async () => {
    await expect(waitForTransactionResilient(SEPOLIA_CHAIN_ID, '')).rejects.toThrow(
      'missing transaction hash',
    );
  });

  it('polls until confirmations are met and retries transient receipt errors', async () => {
    vi.useFakeTimers();
    const receipt = { hash: '0xabc', status: 1, blockNumber: 10 } as never;
    const getTransactionReceipt = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(receipt);
    const getBlockNumber = vi
      .spyOn(ethers.JsonRpcProvider.prototype, 'getBlockNumber')
      .mockResolvedValue(12);

    try {
      const pending = expect(waitForTransactionResilient(SEPOLIA_CHAIN_ID, '0xabc', {
        confirmations: 2,
        timeoutMs: 5_000,
        pollIntervalMs: 10,
        createProvider: () => ({ getTransactionReceipt }) as never,
      })).resolves.toBe(receipt);
      await vi.advanceTimersByTimeAsync(50);
      await pending;
    } finally {
      getBlockNumber.mockRestore();
      vi.useRealTimers();
    }
  });

  it('returns null then times out when no receipt is mined', async () => {
    vi.useFakeTimers();
    try {
      const pending = expect(waitForTransactionResilient(SEPOLIA_CHAIN_ID, '0xdead', {
        timeoutMs: 20,
        pollIntervalMs: 5,
        createProvider: () => ({
          getTransactionReceipt: vi.fn().mockResolvedValue(null),
        }) as never,
      })).rejects.toThrow(/Timed out waiting|All RPC/);
      await vi.advanceTimersByTimeAsync(50);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rethrows TRANSACTION_REPLACED from the primary waiter', async () => {
    await expect(waitForTransactionResilient(SEPOLIA_CHAIN_ID, '0xabc', {
      primary: {
        waitForTransaction: vi.fn().mockRejectedValue(
          Object.assign(new Error('replaced'), { code: 'TRANSACTION_REPLACED' }),
        ),
      } as never,
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ code: 'TRANSACTION_REPLACED' });
  });

  it('rethrows non-transient primary wait errors', async () => {
    await expect(waitForTransactionResilient(SEPOLIA_CHAIN_ID, '0xabc', {
      primary: {
        waitForTransaction: vi.fn().mockRejectedValue(new Error('execution reverted')),
      } as never,
      timeoutMs: 1_000,
    })).rejects.toThrow('execution reverted');
  });

  it('falls through when primary wait returns a null receipt', async () => {
    const receipt = { hash: '0xabc', status: 1, blockNumber: 1 } as never;
    const result = await waitForTransactionResilient(SEPOLIA_CHAIN_ID, '0xabc', {
      timeoutMs: 5_000,
      pollIntervalMs: 1,
      primary: {
        waitForTransaction: vi.fn().mockResolvedValue(null),
      } as never,
      createProvider: () => ({
        getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
      }) as never,
    });
    expect(result).toBe(receipt);
  });

  it('creates a Fuji provider with a short throttle', () => {
    const provider = createJsonRpcProvider('https://fuji.example', AVALANCHE_FUJI_CHAIN_ID);
    expect(provider).toBeTruthy();
  });
});
