import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAccount } from 'wagmi';
import { SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';
import { COTI_TESTNET_CHAIN_ID } from '../../src/chains/coti';

const h = vi.hoisted(() => ({
  quotePodPrivateTokenTransferFees: vi.fn(),
}));

vi.mock('../../src/chains/portal/executePodPrivateTokenTransfer', () => ({
  quotePodPrivateTokenTransferFees: (...args: unknown[]) => h.quotePodPrivateTokenTransferFees(...args),
}));

import { usePodTransferFees } from '../../src/hooks/bridge/usePodTransferFees';

const WALLET = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

describe('usePodTransferFees', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.quotePodPrivateTokenTransferFees.mockResolvedValue({
      display: { podInboxFee: '0.12', l1Gas: '0.03', feeSymbol: 'ETH' },
    });
    vi.mocked(useAccount).mockReturnValue({
      connector: { getProvider: vi.fn(async () => ({ request: vi.fn() })) },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
  };

  it('clears fees when disconnected or amount is zero', async () => {
    const { result, rerender } = renderHook(
      (props: Parameters<typeof usePodTransferFees>[0]) => usePodTransferFees(props),
      {
        initialProps: {
          isConnected: false,
          walletAddress: WALLET,
          chainId: SEPOLIA_CHAIN_ID,
          symbol: 'p.MTT',
          amount: '1',
        },
      },
    );

    await flush();
    expect(result.current.podInboxFee).toBeNull();
    expect(h.quotePodPrivateTokenTransferFees).not.toHaveBeenCalled();

    rerender({
      isConnected: true,
      walletAddress: WALLET,
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      amount: '0',
    });
    await flush();
    expect(h.quotePodPrivateTokenTransferFees).not.toHaveBeenCalled();
  });

  it('does not quote on a COTI-bridge chain', async () => {
    const { result } = renderHook(() => usePodTransferFees({
      isConnected: true,
      walletAddress: WALLET,
      chainId: COTI_TESTNET_CHAIN_ID,
      symbol: 'p.COTI',
      amount: '1',
    }));

    await flush();
    expect(result.current.isPodChain).toBe(false);
    expect(h.quotePodPrivateTokenTransferFees).not.toHaveBeenCalled();
  });

  it('quotes inbox and L1 gas on a PoD chain', async () => {
    const { result } = renderHook(() => usePodTransferFees({
      isConnected: true,
      walletAddress: WALLET,
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      recipient: RECIPIENT,
      amount: '1.5',
    }));

    await flush();
    expect(result.current.isPodChain).toBe(true);
    expect(result.current.podInboxFee).toBe('0.12');
    expect(result.current.l1GasFee).toBe('0.03');
    expect(result.current.feeSymbol).toBe('ETH');
    expect(h.quotePodPrivateTokenTransferFees).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: SEPOLIA_CHAIN_ID,
        symbol: 'p.MTT',
        recipient: RECIPIENT,
        amount: '1.5',
      }),
    );
  });

  it('clears fees when quoting throws', async () => {
    h.quotePodPrivateTokenTransferFees.mockRejectedValue(new Error('quote failed'));
    const { result } = renderHook(() => usePodTransferFees({
      isConnected: true,
      walletAddress: WALLET,
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      amount: '1',
    }));

    await flush();
    expect(result.current.podInboxFee).toBeNull();
    expect(result.current.l1GasFee).toBeNull();
    expect(result.current.isGasEstimating).toBe(false);
  });

  it('skips quoting when the connector has no provider', async () => {
    vi.mocked(useAccount).mockReturnValue({ connector: {} } as never);
    renderHook(() => usePodTransferFees({
      isConnected: true,
      walletAddress: WALLET,
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      amount: '1',
    }));

    await flush();
    expect(h.quotePodPrivateTokenTransferFees).not.toHaveBeenCalled();
  });
});
