import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAccount } from 'wagmi';
import { SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';
import { COTI_TESTNET_CHAIN_ID } from '../../src/chains/coti';

const h = vi.hoisted(() => ({
  quotePodPortalTransactionFees: vi.fn(),
  getSigner: vi.fn(async () => ({})),
}));

vi.mock('../../src/chains/portal/fees', () => ({
  quotePodPortalTransactionFees: (...args: unknown[]) => h.quotePodPortalTransactionFees(...args),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class BrowserProvider {
    getSigner = () => h.getSigner();
  }
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      BrowserProvider,
    },
  };
});

import { usePodPortalFees } from '../../src/hooks/bridge/usePodPortalFees';

const WALLET = '0x' + '1'.repeat(40);
const publicTokens = [{ symbol: 'MTT', name: 'MTT', balance: '0', isPrivate: false }];

describe('usePodPortalFees', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.quotePodPortalTransactionFees.mockResolvedValue({
      display: {
        portalFee: '0.01',
        portalFeeSymbol: 'ETH',
        podInboxFee: '0.02',
        l1Gas: '0.003',
      },
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

  it('clears fees when disconnected or the amount is zero', async () => {
    const { result, rerender } = renderHook(
      (props: Parameters<typeof usePodPortalFees>[0]) => usePodPortalFees(props),
      {
        initialProps: {
          isConnected: false,
          walletAddress: WALLET,
          chainId: SEPOLIA_CHAIN_ID,
          publicTokens,
          selectedTokenIndex: 0,
          direction: 'to-private' as const,
          amount: '1',
        },
      },
    );

    await flush();
    expect(result.current.portalFee).toBeNull();
    expect(h.quotePodPortalTransactionFees).not.toHaveBeenCalled();

    rerender({
      isConnected: true,
      walletAddress: WALLET,
      chainId: SEPOLIA_CHAIN_ID,
      publicTokens,
      selectedTokenIndex: 0,
      direction: 'to-private',
      amount: '0',
    });
    await flush();
    expect(h.quotePodPortalTransactionFees).not.toHaveBeenCalled();
  });

  it('does not quote on a COTI-bridge chain', async () => {
    renderHook(() => usePodPortalFees({
      isConnected: true,
      walletAddress: WALLET,
      chainId: COTI_TESTNET_CHAIN_ID,
      publicTokens,
      selectedTokenIndex: 0,
      direction: 'to-private',
      amount: '1',
    }));
    await flush();
    expect(h.quotePodPortalTransactionFees).not.toHaveBeenCalled();
  });

  it('quotes portal, inbox, and L1 fees on a PoD chain', async () => {
    const { result } = renderHook(() => usePodPortalFees({
      isConnected: true,
      walletAddress: WALLET,
      chainId: SEPOLIA_CHAIN_ID,
      publicTokens,
      selectedTokenIndex: 0,
      direction: 'to-private',
      amount: '1.5',
    }));

    await flush();
    expect(result.current.portalFee).toBe('0.01');
    expect(result.current.podInboxFee).toBe('0.02');
    expect(result.current.l1GasFee).toBe('0.003');
    expect(result.current.portalFeeSymbol).toBe('ETH');
    expect(h.quotePodPortalTransactionFees).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: SEPOLIA_CHAIN_ID,
        direction: 'to-private',
        amount: '1.5',
      }),
    );
  });

  it('treats a zero-quoted fee as null and clears on quote failure', async () => {
    h.quotePodPortalTransactionFees.mockResolvedValueOnce({
      display: { portalFee: '0', portalFeeSymbol: 'ETH', podInboxFee: '0', l1Gas: '0' },
    });
    const { result, rerender } = renderHook(
      (props: Parameters<typeof usePodPortalFees>[0]) => usePodPortalFees(props),
      {
        initialProps: {
          isConnected: true,
          walletAddress: WALLET,
          chainId: SEPOLIA_CHAIN_ID,
          publicTokens,
          selectedTokenIndex: 0,
          direction: 'to-public' as const,
          amount: '1',
        },
      },
    );
    await flush();
    expect(result.current.portalFee).toBeNull();
    expect(result.current.podInboxFee).toBeNull();

    h.quotePodPortalTransactionFees.mockRejectedValueOnce(new Error('quote failed'));
    rerender({
      isConnected: true,
      walletAddress: WALLET,
      chainId: SEPOLIA_CHAIN_ID,
      publicTokens,
      selectedTokenIndex: 0,
      direction: 'to-public',
      amount: '2',
    });
    await flush();
    expect(result.current.portalFee).toBeNull();
    expect(result.current.isGasEstimating).toBe(false);
  });

  it('skips quoting when the connector has no requestable provider', async () => {
    vi.mocked(useAccount).mockReturnValue({ connector: {} } as never);
    renderHook(() => usePodPortalFees({
      isConnected: true,
      walletAddress: WALLET,
      chainId: SEPOLIA_CHAIN_ID,
      publicTokens,
      selectedTokenIndex: 0,
      direction: 'to-private',
      amount: '1',
    }));
    await flush();
    expect(h.quotePodPortalTransactionFees).not.toHaveBeenCalled();

    vi.mocked(useAccount).mockReturnValue({
      connector: { getProvider: vi.fn(async () => ({})) },
    } as never);
    renderHook(() => usePodPortalFees({
      isConnected: true,
      walletAddress: WALLET,
      chainId: SEPOLIA_CHAIN_ID,
      publicTokens,
      selectedTokenIndex: 0,
      direction: 'to-private',
      amount: '1',
    }));
    await flush();
    expect(h.quotePodPortalTransactionFees).not.toHaveBeenCalled();
  });
});
