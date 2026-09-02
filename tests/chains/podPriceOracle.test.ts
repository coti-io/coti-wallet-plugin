import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';
import { COTI_MAINNET_CHAIN_ID } from '../../src/chains/coti';
import { CotiErrorCode } from '../../src/errors';

const h = vi.hoisted(() => ({
  getLivePrice: vi.fn(),
  createJsonRpcProvider: vi.fn(),
  isRateLimitedRpcError: vi.fn(() => false),
  reportPluginError: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class Contract {
    getLivePrice = h.getLivePrice;
  }
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      Contract,
    },
  };
});

vi.mock('../../src/lib/rpcProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/rpcProvider')>();
  return {
    ...actual,
    createJsonRpcProvider: (...args: unknown[]) => h.createJsonRpcProvider(...args),
    isRateLimitedRpcError: (...args: unknown[]) => h.isRateLimitedRpcError(...args),
  };
});

vi.mock('../../src/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/errors')>();
  return {
    ...actual,
    reportPluginError: (...args: unknown[]) => h.reportPluginError(...args),
  };
});

import { fetchPodOracleTokenUsdPrice } from '../../src/chains/podPriceOracle';

describe('fetchPodOracleTokenUsdPrice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.createJsonRpcProvider.mockReturnValue({});
    h.isRateLimitedRpcError.mockReturnValue(false);
    h.getLivePrice.mockResolvedValue(2n * 10n ** 18n);
  });

  it('returns null when the chain has no price oracle', async () => {
    await expect(fetchPodOracleTokenUsdPrice('COTI', COTI_MAINNET_CHAIN_ID)).resolves.toBeNull();
    expect(h.getLivePrice).not.toHaveBeenCalled();
  });

  it('returns null when the symbol has no oracle mapping', async () => {
    await expect(fetchPodOracleTokenUsdPrice('NOT_A_TOKEN', SEPOLIA_CHAIN_ID)).resolves.toBeNull();
  });

  it('returns null when the oracle feed is unset', async () => {
    h.getLivePrice.mockResolvedValue(0n);
    await expect(fetchPodOracleTokenUsdPrice('ETH', SEPOLIA_CHAIN_ID, {} as never)).resolves.toBeNull();
  });

  it('returns the USD price and maps private symbols to their public collateral', async () => {
    const price = await fetchPodOracleTokenUsdPrice('p.USDC', SEPOLIA_CHAIN_ID, {} as never);
    expect(price).toBe(2);
    expect(h.getLivePrice).toHaveBeenCalled();
  });

  it('throws a rate-limited plugin error when every RPC is rate limited', async () => {
    h.getLivePrice.mockRejectedValue(new Error('too many requests'));
    h.isRateLimitedRpcError.mockReturnValue(true);

    await expect(fetchPodOracleTokenUsdPrice('ETH', SEPOLIA_CHAIN_ID)).rejects.toMatchObject({
      code: CotiErrorCode.RPC_RATE_LIMITED,
    });
    expect(h.reportPluginError).toHaveBeenCalled();
  });

  it('returns null on a non-rate-limited RPC failure', async () => {
    h.getLivePrice.mockRejectedValue(new Error('oracle down'));
    await expect(fetchPodOracleTokenUsdPrice('ETH', SEPOLIA_CHAIN_ID, {} as never)).resolves.toBeNull();
  });
});
