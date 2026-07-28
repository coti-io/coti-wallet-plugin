import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configureCotiPlugin } from '../../src/config/plugin';
import {
  createJsonRpcProvider,
  isTransientRpcError,
  isRateLimitedRpcError,
  resetRpcProviderState,
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

  it('detects ethers exhausted retry limit as rate-limit', () => {
    expect(isRateLimitedRpcError(new Error('exceeded maximum retry limit'))).toBe(true);
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

describe('createJsonRpcProvider', () => {
  beforeEach(() => {
    resetRpcProviderState();
  });

  it('memoizes one provider per chain and url so ethers can batch concurrent calls', () => {
    const first = createJsonRpcProvider(SEPOLIA_RPC, SEPOLIA_CHAIN_ID);
    expect(createJsonRpcProvider(SEPOLIA_RPC, SEPOLIA_CHAIN_ID)).toBe(first);
    expect(createJsonRpcProvider(SEPOLIA_RPC_FALLBACK, SEPOLIA_CHAIN_ID)).not.toBe(first);
    expect(createJsonRpcProvider(SEPOLIA_RPC, AVALANCHE_FUJI_CHAIN_ID)).not.toBe(first);
  });

  it('resolves the network from config instead of sending eth_chainId', async () => {
    // Unroutable endpoint: this can only resolve because staticNetwork is enabled.
    const provider = createJsonRpcProvider('http://127.0.0.1:1/rpc', SEPOLIA_CHAIN_ID);
    await expect(provider.getNetwork()).resolves.toMatchObject({
      chainId: BigInt(SEPOLIA_CHAIN_ID),
    });
  });
});

describe('withRpcFallback', () => {
  const rateLimit = () => new Error('Request is being rate limited.');
  /** Tags each provider with its URL so tests can assert rotation order. */
  const taggedProvider = (url: string) => ({ url }) as any;
  const fujiUrls = () => resolveRpcUrlsForChain(AVALANCHE_FUJI_CHAIN_ID);

  beforeEach(() => {
    resetRpcProviderState();
    configureCotiPlugin({ sepoliaRpcUrl: undefined, cotiTestnetRpcUrl: undefined });
  });

  it('retries on transient RPC errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Too Many Requests'))
      .mockResolvedValueOnce('ok');

    const result = await withRpcFallback(SEPOLIA_CHAIN_ID, fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries the same endpoint before rotating to the next', async () => {
    const seen: string[] = [];
    const fn = vi.fn(async (provider: any) => {
      seen.push(provider.url);
      if (seen.length < 3) throw rateLimit();
      return 'ok';
    });

    const result = await withRpcFallback(AVALANCHE_FUJI_CHAIN_ID, fn, {
      retriesPerUrl: 1,
      createProvider: taggedProvider,
    });

    const urls = fujiUrls();
    expect(result).toBe('ok');
    expect(seen).toEqual([urls[0], urls[0], urls[1]]);
  });

  it('deprioritizes a rate-limited endpoint on the next call', async () => {
    const urls = fujiUrls();

    await withRpcFallback(
      AVALANCHE_FUJI_CHAIN_ID,
      async (provider: any) => {
        if (provider.url === urls[0]) throw rateLimit();
        return 'ok';
      },
      { retriesPerUrl: 0, createProvider: taggedProvider },
    );

    const seen: string[] = [];
    await withRpcFallback(
      AVALANCHE_FUJI_CHAIN_ID,
      async (provider: any) => {
        seen.push(provider.url);
        return 'ok';
      },
      { retriesPerUrl: 0, createProvider: taggedProvider },
    );

    // The parked primary is skipped; the read starts on a healthy endpoint.
    expect(seen).toEqual([urls[1]]);
  });

  it('rethrows non-transient errors without trying other endpoints', async () => {
    const fn = vi.fn(async () => {
      throw new Error('execution reverted');
    });

    await expect(
      withRpcFallback(AVALANCHE_FUJI_CHAIN_ID, fn, {
        retriesPerUrl: 2,
        createProvider: taggedProvider,
      }),
    ).rejects.toThrow('execution reverted');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up once every endpoint is exhausted', async () => {
    const fn = vi.fn(async () => {
      throw rateLimit();
    });

    await expect(
      withRpcFallback(AVALANCHE_FUJI_CHAIN_ID, fn, {
        retriesPerUrl: 0,
        createProvider: taggedProvider,
      }),
    ).rejects.toThrow('rate limited');
    expect(fn).toHaveBeenCalledTimes(fujiUrls().length);
  });

  it('falls back across Fuji RPCs then reports rate-limit even if fallback succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(rateLimit())
      .mockResolvedValueOnce('ok');
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const result = await withRpcFallback(AVALANCHE_FUJI_CHAIN_ID, fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(dispatchSpy).toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it('raises Fuji rate-limit after every RPC fails', async () => {
    const fn = vi.fn().mockRejectedValue(rateLimit());

    await expect(
      withRpcFallback(AVALANCHE_FUJI_CHAIN_ID, fn, { retriesPerUrl: 0 }),
    ).rejects.toMatchObject({ code: 'RPC_RATE_LIMITED' });
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
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
