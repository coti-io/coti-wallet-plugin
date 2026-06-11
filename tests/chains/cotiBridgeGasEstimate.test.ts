import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

vi.mock('../../src/chains/index', () => ({
  getRpcUrlForChain: vi.fn(() => 'https://rpc.test'),
}));
vi.mock('../../src/hooks/useEstimateBridgeFees', () => ({
  estimateBridgeFee: vi.fn(async () => ({
    depositFee: '0.01',
    withdrawFee: '0.02',
    cotiLastUpdated: '0',
    tokenLastUpdated: '0',
    blockTimestamp: '0',
  })),
}));

import { estimateCotiBridgeGasFeeDisplay } from '../../src/chains/cotiBridgeGasEstimate';
import { estimateBridgeFee } from '../../src/hooks/useEstimateBridgeFees';

const makeProvider = () =>
  ({
    getNetwork: vi.fn(async () => ({ chainId: 7082400n })),
    getSigner: vi.fn(async () => ({ getAddress: async () => '0x' + '1'.repeat(40) })),
  }) as unknown as ethers.BrowserProvider;

const reqMock = window.ethereum!.request as unknown as ReturnType<typeof vi.fn>;
const fmt = (wei: bigint) => ethers.formatEther(wei).replace(/\.?0+$/, '') || '0';

const baseParams = {
  currentChainId: 7082400,
  bridgeAddress: '0x' + 'a'.repeat(40),
  symbol: 'COTI',
  amountWei: ethers.parseEther('1'),
};

describe('estimateCotiBridgeGasFeeDisplay', () => {
  beforeEach(() => reqMock.mockReset());

  it('uses the 790000 gas constant for ERC20 deposits without calling eth_estimateGas', async () => {
    const gasPrice = 2_000_000_000n;
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      symbol: 'WETH',
      direction: 'to-private',
      gasPrice,
      isErc20Token: true,
    });
    expect(result).toBe(fmt(790000n * gasPrice));
    expect(reqMock).not.toHaveBeenCalled();
  });

  it('uses the eth_estimateGas result for native COTI deposits', async () => {
    const gasPrice = 1_000_000_000n;
    reqMock.mockResolvedValue('0x' + (300000).toString(16));
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
      gasPrice,
      isErc20Token: false,
    });
    expect(result).toBe(fmt(300000n * gasPrice));
  });

  it('falls back to 660000 gas for native deposits when eth_estimateGas fails', async () => {
    const gasPrice = 1_000_000_000n;
    // Invalid hex makes the SUT's own `BigInt(...)` throw inside its try/catch.
    reqMock.mockResolvedValue('not-a-hex');
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
      gasPrice,
      isErc20Token: false,
    });
    expect(result).toBe(fmt(660000n * gasPrice));
  });

  it('falls back to 500000 gas for withdrawals when eth_estimateGas fails', async () => {
    const gasPrice = 1_000_000_000n;
    reqMock.mockResolvedValue('not-a-hex');
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-public',
      gasPrice,
      isErc20Token: false,
    });
    expect(result).toBe(fmt(500000n * gasPrice));
  });

  it('still returns the ERC20 deposit constant when dynamic fee lookup throws', async () => {
    vi.mocked(estimateBridgeFee).mockRejectedValueOnce(new Error('rpc down'));
    const gasPrice = 2_000_000_000n;
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      symbol: 'WETH',
      direction: 'to-private',
      gasPrice,
      isErc20Token: true,
    });
    expect(result).toBe(fmt(790000n * gasPrice));
  });

  it('treats an "Error" fee string as zero native fee for an ERC20 withdraw', async () => {
    vi.mocked(estimateBridgeFee).mockResolvedValueOnce({
      depositFee: 'Error',
      withdrawFee: 'Error',
      cotiLastUpdated: '0',
      tokenLastUpdated: '0',
      blockTimestamp: '0',
    });
    const gasPrice = 1_000_000_000n;
    reqMock.mockResolvedValue('0x' + (200000).toString(16));
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      symbol: 'WETH',
      direction: 'to-public',
      gasPrice,
      isErc20Token: true,
    });
    expect(result).toBe(fmt(200000n * gasPrice));
  });

  it('uses the eth_estimateGas result for an ERC20 withdraw with a real fee', async () => {
    const gasPrice = 1_000_000_000n;
    reqMock.mockResolvedValue('0x' + (250000).toString(16));
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      symbol: 'WETH',
      direction: 'to-public',
      gasPrice,
      isErc20Token: true,
    });
    expect(result).toBe(fmt(250000n * gasPrice));
  });

  it('returns "0" for an ERC20 deposit when gas price is zero', async () => {
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      symbol: 'WETH',
      direction: 'to-private',
      gasPrice: 0n,
      isErc20Token: true,
    });
    expect(result).toBe('0');
  });

  it('returns "0" for a native deposit when gas price is zero', async () => {
    reqMock.mockResolvedValue('0x' + (300000).toString(16));
    const result = await estimateCotiBridgeGasFeeDisplay({
      ...baseParams,
      provider: makeProvider(),
      direction: 'to-private',
      gasPrice: 0n,
      isErc20Token: false,
    });
    expect(result).toBe('0');
  });
});
