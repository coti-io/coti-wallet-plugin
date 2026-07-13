import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import type { FeeEstimate } from '../../src/hooks/useEstimateBridgeFees';

const rpc = vi.hoisted(() => ({
  estimateGas: vi.fn(async () => 300000n),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockJsonRpcProvider {
    constructor(..._a: unknown[]) {}
    estimateGas = (...a: unknown[]) => rpc.estimateGas(...a);
  }
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: MockJsonRpcProvider,
    },
  };
});

vi.mock('../../src/chains/index', () => ({
  getRpcUrlForChain: vi.fn(() => 'https://rpc.test'),
}));

import { estimateCotiBridgeGasFeeDisplay } from '../../src/chains/cotiBridgeGasEstimate';

const makeProvider = () =>
  ({
    getNetwork: vi.fn(async () => ({ chainId: 7082400n })),
    getSigner: vi.fn(async () => ({ getAddress: async () => '0x' + '1'.repeat(40) })),
  }) as unknown as ethers.BrowserProvider;

const fmt = (wei: bigint) => ethers.formatEther(wei).replace(/\.?0+$/, '') || '0';

const feeEstimate = (overrides: Partial<FeeEstimate> = {}): FeeEstimate => ({
  depositFee: '0.01',
  withdrawFee: '0.02',
  cotiLastUpdated: '1700000000',
  tokenLastUpdated: '1700000000',
  blockTimestamp: '1700000000',
  ...overrides,
});

const baseParams = {
  currentChainId: 7082400,
  bridgeAddress: '0x' + 'a'.repeat(40),
  amountWei: ethers.parseEther('1'),
};

describe('estimateCotiBridgeGasFeeDisplay', () => {
  beforeEach(() => {
    rpc.estimateGas.mockReset();
    rpc.estimateGas.mockResolvedValue(300000n);
  });

  it('returns null when cotiLastUpdated is missing (no oracle price data yet)', async () => {
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
      gasPrice: 1_000_000_000n,
      isErc20Token: true,
      feeEstimate: feeEstimate({ cotiLastUpdated: '0' }),
    });
    expect(result).toBeNull();
    expect(rpc.estimateGas).not.toHaveBeenCalled();
  });

  it('returns null when tokenLastUpdated is missing for an ERC20 quote', async () => {
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
      gasPrice: 1_000_000_000n,
      isErc20Token: true,
      feeEstimate: feeEstimate({ tokenLastUpdated: '0' }),
    });
    expect(result).toBeNull();
    expect(rpc.estimateGas).not.toHaveBeenCalled();
  });

  it('uses the live eth_estimateGas result for an ERC20 deposit', async () => {
    const gasPrice = 2_000_000_000n;
    rpc.estimateGas.mockResolvedValue(846_000n);
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
      gasPrice,
      isErc20Token: true,
      feeEstimate: feeEstimate(),
    });
    expect(result).toBe(fmt(846_000n * gasPrice));
  });

  it('returns null for an ERC20 deposit when eth_estimateGas reverts (no allowance yet)', async () => {
    rpc.estimateGas.mockRejectedValue(new Error('execution reverted'));
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
      gasPrice: 1_000_000_000n,
      isErc20Token: true,
      feeEstimate: feeEstimate(),
    });
    expect(result).toBeNull();
  });

  it('uses the live eth_estimateGas result for a native COTI deposit', async () => {
    const gasPrice = 1_000_000_000n;
    rpc.estimateGas.mockResolvedValue(795_000n);
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
      gasPrice,
      isErc20Token: false,
      feeEstimate: feeEstimate(),
    });
    expect(result).toBe(fmt(795_000n * gasPrice));
  });

  it('returns null for a native deposit when eth_estimateGas fails', async () => {
    rpc.estimateGas.mockRejectedValue(new Error('estimate failed'));
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
      gasPrice: 1_000_000_000n,
      isErc20Token: false,
      feeEstimate: feeEstimate(),
    });
    expect(result).toBeNull();
  });

  it('uses the live eth_estimateGas result for an ERC20 withdraw', async () => {
    const gasPrice = 1_000_000_000n;
    rpc.estimateGas.mockResolvedValue(1_600_000n);
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-public',
      gasPrice,
      isErc20Token: true,
      feeEstimate: feeEstimate(),
    });
    expect(result).toBe(fmt(1_600_000n * gasPrice));
  });

  it('uses the live eth_estimateGas result for a native COTI withdraw', async () => {
    const gasPrice = 1_000_000_000n;
    rpc.estimateGas.mockResolvedValue(1_260_000n);
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-public',
      gasPrice,
      isErc20Token: false,
      feeEstimate: feeEstimate(),
    });
    expect(result).toBe(fmt(1_260_000n * gasPrice));
  });

  it('returns null for a withdraw when eth_estimateGas fails', async () => {
    rpc.estimateGas.mockRejectedValue(new Error('estimate failed'));
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-public',
      gasPrice: 1_000_000_000n,
      isErc20Token: false,
      feeEstimate: feeEstimate(),
    });
    expect(result).toBeNull();
  });

  it('treats an "Error" fee string as zero native fee for an ERC20 withdraw', async () => {
    const gasPrice = 1_000_000_000n;
    rpc.estimateGas.mockResolvedValue(200000n);
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-public',
      gasPrice,
      isErc20Token: true,
      feeEstimate: feeEstimate({ withdrawFee: 'Error' }),
    });
    expect(result).toBe(fmt(200000n * gasPrice));
  });

  it('returns "0" when gas price is zero', async () => {
    rpc.estimateGas.mockResolvedValue(300000n);
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
      gasPrice: 0n,
      isErc20Token: false,
      feeEstimate: feeEstimate(),
    });
    expect(result).toBe('0');
  });

  it('uses fromAddress instead of calling provider.getSigner()', async () => {
    const provider = makeProvider();
    await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider,
      direction: 'to-private',
      gasPrice: 1_000_000_000n,
      isErc20Token: false,
      fromAddress: '0x' + '2'.repeat(40),
      feeEstimate: feeEstimate(),
    });
    expect(provider.getSigner).not.toHaveBeenCalled();
  });
});
