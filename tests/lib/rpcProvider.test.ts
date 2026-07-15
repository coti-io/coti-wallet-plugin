import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configureCotiPlugin } from '../../src/config/plugin';
import {
  isTransientRpcError,
  resolveRpcUrlsForChain,
  withRpcFallback,
  waitForTransactionResilient,
} from '../../src/lib/rpcProvider';
import { SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';
import { SEPOLIA_RPC, SEPOLIA_RPC_FALLBACK } from '../../src/chains/viemChains';
import { AVALANCHE_FUJI_CHAIN_ID } from '../../src/chains/avalancheFuji';

describe('isTransientRpcError', () => {
  it('detects Infura rate limit payloads', () => {
    const error = new Error(
      'missing response for request (value=[ { "code": -32005, "message": "Too Many Requests" } ])',
    );
    expect(isTransientRpcError(error)).toBe(true);
  });

  it('detects QuikNode / ethers coalesce rate-limit errors', () => {
    const error = new Error(
      'could not coalesce error (error={ "code": -32005, "data": { "httpStatus": 429 }, "message": "Request is being rate limited." })',
    );
    expect(isTransientRpcError(error)).toBe(true);
  });

  it('detects nested httpStatus 429', () => {
    expect(isTransientRpcError({ code: 'UNKNOWN_ERROR', data: { httpStatus: 429 } })).toBe(true);
  });

  it('detects nested JSON-RPC -32005', () => {
    expect(isTransientRpcError({ error: { code: -32005, message: 'rate limited' } })).toBe(true);
  });

  it('returns false for contract reverts', () => {
    expect(isTransientRpcError(new Error('execution reverted'))).toBe(false);
  });
});

describe('resolveRpcUrlsForChain', () => {
  beforeEach(() => {
    configureCotiPlugin({ sepoliaRpcUrl: undefined, cotiTestnetRpcUrl: undefined });
  });

  it('returns primary and fallback URLs for Sepolia', () => {
    expect(resolveRpcUrlsForChain(SEPOLIA_CHAIN_ID)).toEqual([
      SEPOLIA_RPC,
      SEPOLIA_RPC_FALLBACK,
    ]);
  });

  it('prepends plugin override without duplicates', () => {
    const custom = 'https://custom-sepolia.example';
    configureCotiPlugin({ sepoliaRpcUrl: custom });
    expect(resolveRpcUrlsForChain(SEPOLIA_CHAIN_ID)).toEqual([
      custom,
      SEPOLIA_RPC,
      SEPOLIA_RPC_FALLBACK,
    ]);
  });
});

describe('withRpcFallback', () => {
  it('retries on transient RPC errors', async () => {
    const rateLimit = new Error('Too Many Requests');
    const fn = vi.fn()
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce('ok');

    const result = await withRpcFallback(SEPOLIA_CHAIN_ID, fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('waitForTransactionResilient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns receipt from primary wait when available', async () => {
    const receipt = { hash: '0xabc', status: 1, blockNumber: 10 } as any;
    const primary = {
      waitForTransaction: vi.fn().mockResolvedValue(receipt),
    };

    const result = await waitForTransactionResilient(AVALANCHE_FUJI_CHAIN_ID, '0xabc', {
      primary: primary as any,
      timeoutMs: 5_000,
    });

    expect(result).toBe(receipt);
    expect(primary.waitForTransaction).toHaveBeenCalledWith('0xabc', 1, expect.any(Number));
  });

  it('falls back across RPCs after primary rate limit', async () => {
    const rateLimit = new Error('Request is being rate limited.');
    const receipt = { hash: '0xdef', status: 1, blockNumber: 11 } as any;
    const primary = {
      waitForTransaction: vi.fn().mockRejectedValue(rateLimit),
    };

    const getTransactionReceipt = vi.fn()
      .mockRejectedValueOnce(rateLimit)
      .mockResolvedValueOnce(receipt);

    const result = await waitForTransactionResilient(AVALANCHE_FUJI_CHAIN_ID, '0xdef', {
      primary: primary as any,
      timeoutMs: 5_000,
      pollIntervalMs: 10,
      createProvider: () => ({ getTransactionReceipt }) as any,
    });

    expect(result).toBe(receipt);
    expect(getTransactionReceipt).toHaveBeenCalled();
  });

  it('rethrows CALL_EXCEPTION from primary wait', async () => {
    const revert = Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' });
    const primary = {
      waitForTransaction: vi.fn().mockRejectedValue(revert),
    };

    await expect(
      waitForTransactionResilient(AVALANCHE_FUJI_CHAIN_ID, '0xdead', {
        primary: primary as any,
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'CALL_EXCEPTION' });
  });
});
