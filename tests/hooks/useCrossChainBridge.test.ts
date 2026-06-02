import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockSendTransactionAsync = vi.fn();
const mockWriteContractAsync = vi.fn();
const mockGetBalance = vi.fn();
const mockEstimateGas = vi.fn();
const mockGetGasPrice = vi.fn();

let mockAccountState: any = { address: undefined, chainId: undefined };

vi.mock('wagmi', () => ({
  useAccount: () => mockAccountState,
  useSendTransaction: () => ({ sendTransactionAsync: mockSendTransactionAsync }),
  useWriteContract: () => ({ writeContractAsync: mockWriteContractAsync }),
  usePublicClient: () => ({
    getBalance: mockGetBalance,
    estimateGas: mockEstimateGas,
    getGasPrice: mockGetGasPrice,
  }),
}));

vi.mock('viem', () => ({
  erc20Abi: [],
  parseEther: (value: string) => BigInt(Math.floor(parseFloat(value) * 1e18)),
  defineChain: (chain: any) => chain,
}));

import { useCrossChainBridge } from '../../src/hooks/useCrossChainBridge';

describe('useCrossChainBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountState = { address: '0x1234567890abcdef1234567890abcdef12345678', chainId: 7082400 };
    mockGetBalance.mockResolvedValue(BigInt('100000000000000000000')); // 100 tokens
    mockEstimateGas.mockResolvedValue(BigInt(21000));
    mockGetGasPrice.mockResolvedValue(BigInt(1000000000)); // 1 gwei
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ remainingLimit: '1000000' }),
    });
  });

  it('returns the expected interface', () => {
    const { result } = renderHook(() => useCrossChainBridge());
    expect(result.current.bridgeNative).toBeDefined();
    expect(result.current.bridgeERC20).toBeDefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.txHash).toBeNull();
  });

  describe('bridgeNative', () => {
    it('sets UNSUPPORTED_TOKEN error for unknown tokenId', async () => {
      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeNative(BigInt('1000000000000000000'), 'UNKNOWN_TOKEN');
      });

      expect(result.current.error).not.toBeNull();
      expect(result.current.error!.code).toBe('UNSUPPORTED_TOKEN');
      expect(result.current.isLoading).toBe(false);
    });

    it('sets TRANSACTION_FAILED when wallet is not connected', async () => {
      mockAccountState = { address: undefined, chainId: undefined };

      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeNative(BigInt('1000000000000000000'), 'COTI');
      });

      expect(result.current.error!.code).toBe('TRANSACTION_FAILED');
      expect(result.current.error!.message).toContain('not connected');
    });

    it('submits transaction and sets txHash on success', async () => {
      mockSendTransactionAsync.mockResolvedValue('0xtxhash123');

      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeNative(BigInt('1000000000000000000'), 'COTI');
      });

      expect(result.current.txHash).toBe('0xtxhash123');
      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('sets TRANSACTION_FAILED on sendTransaction rejection', async () => {
      mockSendTransactionAsync.mockRejectedValue(new Error('User rejected'));

      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeNative(BigInt('1000000000000000000'), 'COTI');
      });

      expect(result.current.error!.code).toBe('TRANSACTION_FAILED');
      expect(result.current.error!.message).toContain('User rejected');
    });

    it('sets BELOW_MINIMUM for amounts below threshold', async () => {
      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeNative(BigInt('100'), 'COTI'); // way below 0.001
      });

      expect(result.current.error!.code).toBe('BELOW_MINIMUM');
    });

    it('sets INSUFFICIENT_BALANCE when balance is too low', async () => {
      mockGetBalance.mockResolvedValue(BigInt(100)); // nearly zero balance

      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeNative(BigInt('50000000000000000000'), 'COTI'); // 50 tokens
      });

      expect(result.current.error!.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('uses fallback gas limit when estimation fails', async () => {
      mockEstimateGas.mockRejectedValue(new Error('estimation failed'));
      mockSendTransactionAsync.mockResolvedValue('0xfallback_hash');

      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeNative(BigInt('1000000000000000000'), 'COTI');
      });

      // Should still succeed with fallback gas
      expect(result.current.txHash).toBe('0xfallback_hash');
    });
  });

  describe('bridgeERC20', () => {
    it('sets UNSUPPORTED_TOKEN for unknown tokenId', async () => {
      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeERC20(
          BigInt('1000000000000000000'),
          'UNKNOWN_TOKEN',
          '0x1234567890abcdef1234567890abcdef12345678',
        );
      });

      expect(result.current.error!.code).toBe('UNSUPPORTED_TOKEN');
    });

    it('sets TRANSACTION_FAILED when wallet is not connected', async () => {
      mockAccountState = { address: undefined, chainId: undefined };

      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeERC20(
          BigInt('1000000000000000000'),
          'COTI',
          '0x1234567890abcdef1234567890abcdef12345678',
        );
      });

      expect(result.current.error!.code).toBe('TRANSACTION_FAILED');
    });

    it('submits writeContract and sets txHash on success', async () => {
      mockWriteContractAsync.mockResolvedValue('0xerc20hash');

      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeERC20(
          BigInt('1000000000000000000'),
          'COTI',
          '0x1234567890abcdef1234567890abcdef12345678',
        );
      });

      expect(result.current.txHash).toBe('0xerc20hash');
      expect(result.current.error).toBeNull();
    });

    it('sets INSUFFICIENT_BALANCE when native balance cant cover gas', async () => {
      mockGetBalance.mockResolvedValue(BigInt(0)); // no native balance for gas

      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeERC20(
          BigInt('1000000000000000000'),
          'COTI',
          '0x1234567890abcdef1234567890abcdef12345678',
        );
      });

      expect(result.current.error!.code).toBe('INSUFFICIENT_BALANCE');
    });
  });

  describe('daily limit check', () => {
    it('sets DAILY_LIMIT_EXCEEDED when amount exceeds limit', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ remainingLimit: '0.0001' }), // very low limit
      });

      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeNative(BigInt('10000000000000000000'), 'COTI'); // 10 tokens
      });

      expect(result.current.error!.code).toBe('DAILY_LIMIT_EXCEEDED');
    });

    it('proceeds when cap meter API fails (graceful degradation)', async () => {
      (global.fetch as any).mockRejectedValue(new Error('API down'));
      mockSendTransactionAsync.mockResolvedValue('0xgraceful');

      const { result } = renderHook(() => useCrossChainBridge());

      await act(async () => {
        await result.current.bridgeNative(BigInt('1000000000000000000'), 'COTI');
      });

      // Should proceed without limit check
      expect(result.current.txHash).toBe('0xgraceful');
    });
  });
});
