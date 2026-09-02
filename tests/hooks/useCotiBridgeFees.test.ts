import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { COTI_TESTNET_CHAIN_ID } from '../../src/chains/coti';
import { SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';

const h = vi.hoisted(() => ({
  quoteCotiBridgeFees: vi.fn(),
}));

vi.mock('../../src/chains/coti-bridge/fees', () => ({
  quoteCotiBridgeFees: (...args: unknown[]) => h.quoteCotiBridgeFees(...args),
}));

import { useCotiBridgeFees } from '../../src/hooks/bridge/useCotiBridgeFees';

describe('useCotiBridgeFees', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.quoteCotiBridgeFees.mockResolvedValue({
      portalFeeCoti: '0.01',
      estimatedGasFee: '0.002',
      feeDebugInfo: { cotiLastUpdated: '1', tokenLastUpdated: '2', blockTimestamp: '3' },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
  };

  it('does nothing until a COTI-bridge chain is connected with a positive amount', async () => {
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useCotiBridgeFees>[0]) => useCotiBridgeFees(props),
      {
        initialProps: {
          isConnected: true,
          chainId: SEPOLIA_CHAIN_ID,
          publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '0', isPrivate: false }],
          selectedTokenIndex: 0,
          direction: 'to-private' as const,
          amount: '1',
        },
      },
    );

    await flush();
    expect(h.quoteCotiBridgeFees).not.toHaveBeenCalled();
    expect(result.current.isPodChain).toBe(false);

    rerender({
      isConnected: true,
      chainId: COTI_TESTNET_CHAIN_ID,
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '0', isPrivate: false }],
      selectedTokenIndex: 0,
      direction: 'to-private',
      amount: '0',
    });
    await flush();
    expect(h.quoteCotiBridgeFees).not.toHaveBeenCalled();
  });

  it('stores the quoted COTI bridge fees', async () => {
    const { result } = renderHook(() => useCotiBridgeFees({
      isConnected: true,
      walletAddress: '0x' + '1'.repeat(40),
      chainId: COTI_TESTNET_CHAIN_ID,
      publicTokens: [{ symbol: 'p.WETH', name: 'p.WETH', balance: '0', isPrivate: true }],
      selectedTokenIndex: 0,
      direction: 'to-public',
      amount: '2',
    }));

    await flush();
    expect(result.current.portalFeeCoti).toBe('0.01');
    expect(result.current.estimatedGasFee).toBe('0.002');
    expect(h.quoteCotiBridgeFees).toHaveBeenCalledWith({
      chainId: COTI_TESTNET_CHAIN_ID,
      symbol: 'WETH',
      direction: 'to-public',
      amount: '2',
      walletAddress: '0x' + '1'.repeat(40),
    });
  });

  it('clears fees when quoting throws', async () => {
    h.quoteCotiBridgeFees.mockRejectedValue(new Error('estimator boom'));
    const { result } = renderHook(() => useCotiBridgeFees({
      isConnected: true,
      chainId: COTI_TESTNET_CHAIN_ID,
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '0', isPrivate: false }],
      selectedTokenIndex: 0,
      direction: 'to-private',
      amount: '1',
    }));

    await flush();
    expect(result.current.portalFeeCoti).toBeNull();
    expect(result.current.estimatedGasFee).toBeNull();
    expect(result.current.isGasEstimating).toBe(false);
  });
});
