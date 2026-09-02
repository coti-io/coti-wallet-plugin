import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COTI_TESTNET_CHAIN_ID } from '../../../src/chains/coti';

const h = vi.hoisted(() => ({
  send: vi.fn(async () => '0x3b9aca00'),
  estimateBridgeFee: vi.fn(),
  estimateCotiBridgeGasFeeDisplay: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class JsonRpcProvider {
    send = h.send;
  }
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider,
    },
  };
});

vi.mock('../../../src/hooks/useEstimateBridgeFees', () => ({
  estimateBridgeFee: (...args: unknown[]) => h.estimateBridgeFee(...args),
}));

vi.mock('../../../src/chains/cotiBridgeGasEstimate', () => ({
  estimateCotiBridgeGasFeeDisplay: (...args: unknown[]) => h.estimateCotiBridgeGasFeeDisplay(...args),
}));

import { quoteCotiBridgeFees } from '../../../src/chains/coti-bridge/fees';

describe('quoteCotiBridgeFees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.send.mockResolvedValue('0x3b9aca00');
    h.estimateBridgeFee.mockResolvedValue({
      depositFee: '0.0100',
      withdrawFee: '0.0200',
      cotiLastUpdated: '1',
      tokenLastUpdated: '2',
      blockTimestamp: '3',
    });
    h.estimateCotiBridgeGasFeeDisplay.mockResolvedValue('0.001');
  });

  it('returns empty quotes when the amount is zero', async () => {
    await expect(quoteCotiBridgeFees({
      chainId: COTI_TESTNET_CHAIN_ID,
      symbol: 'COTI',
      direction: 'to-private',
      amount: '0',
    })).resolves.toEqual({
      portalFeeCoti: null,
      estimatedGasFee: null,
      feeDebugInfo: null,
    });
    expect(h.estimateBridgeFee).not.toHaveBeenCalled();
  });

  it('returns empty quotes when the chain has no bridge addresses', async () => {
    await expect(quoteCotiBridgeFees({
      chainId: 1,
      symbol: 'COTI',
      direction: 'to-private',
      amount: '1',
    })).resolves.toEqual({
      portalFeeCoti: null,
      estimatedGasFee: null,
      feeDebugInfo: null,
    });
  });

  it('quotes a native COTI deposit and strips trailing zeros', async () => {
    const quote = await quoteCotiBridgeFees({
      chainId: COTI_TESTNET_CHAIN_ID,
      symbol: 'COTI',
      direction: 'to-private',
      amount: '1',
      walletAddress: '0x' + '1'.repeat(40),
    });

    expect(quote.portalFeeCoti).toBe('0.01');
    expect(quote.estimatedGasFee).toBe('0.001');
    expect(quote.feeDebugInfo).toEqual({
      cotiLastUpdated: '1',
      tokenLastUpdated: '2',
      blockTimestamp: '3',
    });
  });

  it('uses the withdraw fee for to-public quotes', async () => {
    const quote = await quoteCotiBridgeFees({
      chainId: COTI_TESTNET_CHAIN_ID,
      symbol: 'WETH',
      direction: 'to-public',
      amount: '2',
    });
    expect(quote.portalFeeCoti).toBe('0.02');
  });

  it('returns a null portal fee when the estimator reports Error', async () => {
    h.estimateBridgeFee.mockResolvedValue({
      depositFee: 'Error',
      withdrawFee: 'Error',
      cotiLastUpdated: '0',
      tokenLastUpdated: '0',
      blockTimestamp: '0',
    });

    const quote = await quoteCotiBridgeFees({
      chainId: COTI_TESTNET_CHAIN_ID,
      symbol: 'USDT',
      direction: 'to-private',
      amount: '5',
    });
    expect(quote.portalFeeCoti).toBeNull();
    expect(quote.estimatedGasFee).toBe('0.001');
    expect(quote.feeDebugInfo).toBeNull();
  });

  it('falls back to 1 gwei when eth_gasPrice fails', async () => {
    h.send.mockRejectedValue(new Error('rpc down'));

    await quoteCotiBridgeFees({
      chainId: COTI_TESTNET_CHAIN_ID,
      symbol: 'WBTC',
      direction: 'to-private',
      amount: '1',
    });

    expect(h.estimateCotiBridgeGasFeeDisplay).toHaveBeenCalledWith(
      expect.objectContaining({ gasPrice: 1_000_000_000n, isErc20Token: true }),
    );
  });

  it('resolves USDC.e and NIGHT bridge addresses without a public token match', async () => {
    await quoteCotiBridgeFees({
      chainId: COTI_TESTNET_CHAIN_ID,
      symbol: 'NIGHT',
      direction: 'to-private',
      amount: '1',
    });
    expect(h.estimateCotiBridgeGasFeeDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'NIGHT',
        isErc20Token: true,
      }),
    );
  });
});
