import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureCotiPlugin } from '../../src/config/plugin';
import {
  isTransientRpcError,
  resolveRpcUrlsForChain,
  withRpcFallback,
} from '../../src/lib/rpcProvider';
import { SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';
import { SEPOLIA_RPC, SEPOLIA_RPC_FALLBACK } from '../../src/chains/viemChains';

describe('isTransientRpcError', () => {
  it('detects Infura rate limit payloads', () => {
    const error = new Error(
      'missing response for request (value=[ { "code": -32005, "message": "Too Many Requests" } ])',
    );
    expect(isTransientRpcError(error)).toBe(true);
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
