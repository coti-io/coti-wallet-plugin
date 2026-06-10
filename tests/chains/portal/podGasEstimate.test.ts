import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

const getSepoliaGasPrice = vi.fn(async () => 1_000_000_000n);
const quotePortalPodRequest = vi.fn(async () => ({ totalFeeWei: 5_000n, callbackFeeWei: 1_000n }));

vi.mock('../../../src/chains/portal/executePodPortalTransaction', () => ({
  getSepoliaGasPrice: (...args: unknown[]) => getSepoliaGasPrice(...(args as [])),
  quotePortalPodRequest: (...args: unknown[]) => quotePortalPodRequest(...(args as [])),
}));

import { estimatePodPortalGasFeeDisplay } from '../../../src/chains/portal/podGasEstimate';

const makeProvider = () =>
  ({
    getSigner: vi.fn(async () => ({ getAddress: async () => '0x' + '1'.repeat(40) })),
  }) as unknown as ethers.BrowserProvider;

const reqMock = window.ethereum!.request as unknown as ReturnType<typeof vi.fn>;
const fmt = (wei: bigint) => ethers.formatEther(wei).replace(/\.?0+$/, '') || '0';

const baseParams = {
  currentChainId: 11155111,
  addresses: {} as Record<string, string>,
  symbol: 'WETH',
  bridgeAddress: '0x' + 'a'.repeat(40),
  pubTok: { symbol: 'WETH', name: 'WETH', icon: '', decimals: 18, isPrivate: false },
  estimationAmount: '1',
};

describe('estimatePodPortalGasFeeDisplay', () => {
  beforeEach(() => {
    reqMock.mockReset();
    getSepoliaGasPrice.mockResolvedValue(1_000_000_000n);
    quotePortalPodRequest.mockResolvedValue({ totalFeeWei: 5_000n, callbackFeeWei: 1_000n });
  });

  it('combines eth_estimateGas gas cost with the PoD fee for deposits', async () => {
    reqMock.mockResolvedValue('0x' + (100000).toString(16));
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
    });
    expect(result).toBe(fmt(100000n * 1_000_000_000n + 5_000n));
  });

  it('falls back to 850000 gas for deposits when eth_estimateGas fails', async () => {
    reqMock.mockRejectedValue(new Error('estimate failed'));
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
    });
    expect(result).toBe(fmt(850000n * 1_000_000_000n + 5_000n));
  });

  it('sums both withdraw quotes with a 900000 gas constant for withdrawals', async () => {
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-public',
    });
    // transferQuote + burnQuote = 5000 + 5000 = 10000 PoD wei
    expect(result).toBe(fmt(900000n * 1_000_000_000n + 10_000n));
  });

  it('returns the static fallback when quoting throws', async () => {
    quotePortalPodRequest.mockRejectedValue(new Error('not onboarded'));
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
    });
    expect(result).toBe(fmt(850000n * 1_000_000_000n));
  });
});
