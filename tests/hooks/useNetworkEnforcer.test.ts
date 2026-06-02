import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock wagmi hooks
const mockSwitchChain = vi.fn();
let mockAccountChain: any = undefined;
let mockWalletType = 'unknown';
let mockIsMetaMaskWithSnap = false;

vi.mock('wagmi', () => ({
  useSwitchChain: () => ({ switchChain: mockSwitchChain }),
  useAccount: () => ({ chain: mockAccountChain, connector: undefined }),
}));

vi.mock('../../src/hooks/useWalletType', () => ({
  useWalletType: () => ({
    walletType: mockWalletType,
    isMetaMaskWithSnap: mockIsMetaMaskWithSnap,
    connectorId: undefined,
  }),
}));

import { useNetworkEnforcer } from '../../src/hooks/useNetworkEnforcer';

describe('useNetworkEnforcer', () => {
  const mockSwitchNetwork = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountChain = undefined;
    mockWalletType = 'unknown';
    mockIsMetaMaskWithSnap = false;
  });

  it('returns isWrongNetwork=false when chainId is null', () => {
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('returns isWrongNetwork=false for COTI Testnet (7082400) with MetaMask', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result } = renderHook(() => useNetworkEnforcer('7082400', mockSwitchNetwork));
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('returns isWrongNetwork=true for wrong network with MetaMask', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result } = renderHook(() => useNetworkEnforcer('11155111', mockSwitchNetwork));
    expect(result.current.isWrongNetwork).toBe(true);
  });

  it('returns isWrongNetwork=false for COTI Mainnet (2632500) with MetaMask', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result } = renderHook(() => useNetworkEnforcer('2632500', mockSwitchNetwork));
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('returns isWrongNetwork=true for non-MetaMask on wrong chain', () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 999 };

    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    expect(result.current.isWrongNetwork).toBe(true);
  });

  it('returns isWrongNetwork=false for non-MetaMask on COTI chain', () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 7082400 };

    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('enforceNetwork calls switchNetwork for MetaMask on wrong network', async () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;
    mockSwitchNetwork.mockResolvedValue(true);

    const { result } = renderHook(() => useNetworkEnforcer('11155111', mockSwitchNetwork));

    await act(async () => {
      await result.current.enforceNetwork();
    });

    expect(mockSwitchNetwork).toHaveBeenCalled();
    expect(result.current.networkMismatchWarning).toBeNull();
  });

  it('sets warning when MetaMask switchNetwork returns false', async () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;
    mockSwitchNetwork.mockResolvedValue(false);

    const { result } = renderHook(() => useNetworkEnforcer('11155111', mockSwitchNetwork));

    await act(async () => {
      await result.current.enforceNetwork();
    });

    expect(result.current.networkMismatchWarning).toContain('rejected');
  });

  it('sets warning when MetaMask switchNetwork throws', async () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;
    mockSwitchNetwork.mockRejectedValue(new Error('User rejected'));

    const { result } = renderHook(() => useNetworkEnforcer('11155111', mockSwitchNetwork));

    await act(async () => {
      await result.current.enforceNetwork();
    });

    expect(result.current.networkMismatchWarning).toContain('manually');
  });

  it('enforceNetwork calls wagmi switchChain for non-MetaMask on wrong network', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 999 };

    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));

    await act(async () => {
      await result.current.enforceNetwork();
    });

    expect(mockSwitchChain).toHaveBeenCalledWith({ chainId: 2632500 });
  });

  it('handles hex chainId for MetaMask', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result } = renderHook(() => useNetworkEnforcer('0x6c11a0', mockSwitchNetwork));
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('clears warning when network becomes correct', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result, rerender } = renderHook(
      ({ chainId }) => useNetworkEnforcer(chainId, mockSwitchNetwork),
      { initialProps: { chainId: '7082400' } }
    );

    expect(result.current.isWrongNetwork).toBe(false);
    expect(result.current.networkMismatchWarning).toBeNull();
  });
});
