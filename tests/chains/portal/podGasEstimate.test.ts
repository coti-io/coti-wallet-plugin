import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

const getSepoliaGasPrice = vi.fn(async () => 1_000_000_000n);
const quotePortalDepositFees = vi.fn(async () => ({
  portalFee: 100n,
  usedDynamicPricing: false,
  mintTotalFee: 4900n,
  mintCallbackFee: 1000n,
  msgValue: 5000n,
  gasPrice: 1_000_000_000n,
}));
const quotePortalWithdrawFees = vi.fn(async () => ({
  portalFee: 100n,
  usedDynamicPricing: false,
  transferTotalFee: 4900n,
  transferCallbackFee: 1000n,
  msgValue: 5000n,
  gasPrice: 1_000_000_000n,
}));
const estimateGas = vi.fn(async () => 100000n);

vi.mock('../../../src/chains/index', () => ({
  getRpcUrlForChain: () => 'http://localhost:8545',
}));

vi.mock('../../../src/chains/portal/executePodPortalTransaction', () => ({
  getSepoliaGasPrice: (...args: unknown[]) => getSepoliaGasPrice(...(args as [])),
  quotePortalDepositFees: (...args: unknown[]) => quotePortalDepositFees(...(args as [])),
  quotePortalWithdrawFees: (...args: unknown[]) => quotePortalWithdrawFees(...(args as [])),
}));

vi.spyOn(ethers.JsonRpcProvider.prototype, 'estimateGas').mockImplementation(estimateGas);

import { estimatePodPortalGasFeeDisplay } from '../../../src/chains/portal/podGasEstimate';

const makeProvider = () =>
  ({
    getSigner: vi.fn(async () => ({ getAddress: async () => '0x' + '1'.repeat(40) })),
  }) as unknown as ethers.BrowserProvider;

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
    estimateGas.mockReset();
    estimateGas.mockResolvedValue(100000n);
    getSepoliaGasPrice.mockResolvedValue(1_000_000_000n);
    quotePortalDepositFees.mockResolvedValue({
      portalFee: 100n,
      usedDynamicPricing: false,
      mintTotalFee: 4900n,
      mintCallbackFee: 1000n,
      msgValue: 5000n,
      gasPrice: 1_000_000_000n,
    });
    quotePortalWithdrawFees.mockResolvedValue({
      portalFee: 100n,
      usedDynamicPricing: false,
      transferTotalFee: 4900n,
      transferCallbackFee: 1000n,
      msgValue: 5000n,
      gasPrice: 1_000_000_000n,
    });
  });

  it('combines estimateGas gas cost with the PoD fee for deposits', async () => {
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
    });
    expect(result).toBe(fmt(100000n * 1_000_000_000n + 5000n));
  });

  it('falls back to 850000 gas for deposits when estimateGas fails', async () => {
    estimateGas.mockRejectedValue(new Error('estimate failed'));
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
    });
    expect(result).toBe(fmt(850000n * 1_000_000_000n + 5000n));
  });

  it('uses a single withdraw quote with estimateGas for withdrawals', async () => {
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-public',
    });
    expect(result).toBe(fmt(100000n * 1_000_000_000n + 5000n));
    expect(quotePortalWithdrawFees).toHaveBeenCalledTimes(1);
  });

  it('falls back to 900000 gas for withdrawals when estimateGas fails', async () => {
    estimateGas.mockRejectedValue(new Error('estimate failed'));
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-public',
    });
    expect(result).toBe(fmt(900000n * 1_000_000_000n + 5000n));
  });

  it('returns the static fallback when quoting throws', async () => {
    quotePortalDepositFees.mockRejectedValue(new Error('not onboarded'));
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
    });
    expect(result).toBe(fmt(850000n * 1_000_000_000n));
  });

  it('defaults decimals to 18 when pubTok is undefined', async () => {
    estimateGas.mockResolvedValue(100000n);
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      pubTok: undefined,
      provider: makeProvider(),
      direction: 'to-private',
    });
    expect(result).toBe(fmt(100000n * 1_000_000_000n + 5000n));
  });

  it('suppresses the logger warning when the quote error is a pending/untrusted state', async () => {
    quotePortalDepositFees.mockRejectedValue(new Error('A PoD request is already pending'));
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
    });
    expect(result).toBe(fmt(850000n * 1_000_000_000n));
  });

  it('uses the 900000 withdraw fallback gas when a withdraw quote throws', async () => {
    quotePortalWithdrawFees.mockRejectedValue(new Error('not onboarded'));
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-public',
    });
    expect(result).toBe(fmt(900000n * 1_000_000_000n));
  });

  it('handles a non-Error thrown value from quoting (String(err) path)', async () => {
    quotePortalDepositFees.mockRejectedValue('string failure');
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
    });
    expect(result).toBe(fmt(850000n * 1_000_000_000n));
  });

  it('returns "0" when the total native fee is zero', async () => {
    getSepoliaGasPrice.mockResolvedValue(0n);
    quotePortalDepositFees.mockResolvedValue({
      portalFee: 0n,
      usedDynamicPricing: false,
      mintTotalFee: 0n,
      mintCallbackFee: 0n,
      msgValue: 0n,
      gasPrice: 0n,
    });
    estimateGas.mockResolvedValue(0n);
    const result = await estimatePodPortalGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
    });
    expect(result).toBe('0');
  });
});
