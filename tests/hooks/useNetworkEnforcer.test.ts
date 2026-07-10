import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock wagmi hooks
const mockSwitchChainAsync = vi.fn().mockResolvedValue(undefined);
let mockAccountChain: any = undefined;
let mockWalletType = 'unknown';
let mockIsMetaMaskWithSnap = false;

vi.mock('wagmi', () => ({
  useSwitchChain: () => ({ switchChainAsync: mockSwitchChainAsync }),
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
    mockSwitchChainAsync.mockResolvedValue(undefined);
    mockAccountChain = undefined;
    mockWalletType = 'unknown';
    mockIsMetaMaskWithSnap = false;
  });

  it('returns isUnsupportedNetwork=false when chainId is null', () => {
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(false);
    expect(result.current.isOffTargetNetwork).toBe(false);
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('returns both flags false for COTI Testnet with MetaMask (default target testnet)', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result } = renderHook(() => useNetworkEnforcer('7082400', mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(false);
    expect(result.current.isOffTargetNetwork).toBe(false);
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('returns isUnsupportedNetwork=false and isOffTargetNetwork=true for Sepolia with MetaMask', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result } = renderHook(() => useNetworkEnforcer('11155111', mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(false);
    expect(result.current.isOffTargetNetwork).toBe(true);
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('returns isUnsupportedNetwork=true for unsupported network with MetaMask', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result } = renderHook(() => useNetworkEnforcer('999', mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(true);
    expect(result.current.isOffTargetNetwork).toBe(false);
    expect(result.current.isWrongNetwork).toBe(true);
  });

  it('returns isOffTargetNetwork=true for COTI Mainnet with MetaMask (default target testnet)', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result } = renderHook(() => useNetworkEnforcer('2632500', mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(false);
    expect(result.current.isOffTargetNetwork).toBe(true);
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('returns isUnsupportedNetwork=true for non-MetaMask on unsupported chain', () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 999 };

    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(true);
    expect(result.current.isOffTargetNetwork).toBe(false);
    expect(result.current.isWrongNetwork).toBe(true);
  });

  it('returns isOffTargetNetwork=true for non-MetaMask on Sepolia (default target testnet)', () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 11155111 };

    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(false);
    expect(result.current.isOffTargetNetwork).toBe(true);
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('returns both flags false for non-MetaMask on COTI testnet (default target testnet)', () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 7082400 };

    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(false);
    expect(result.current.isOffTargetNetwork).toBe(false);
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

  it('enforceNetwork calls switchNetwork for non-MetaMask on unsupported chain', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 999 };
    mockSwitchNetwork.mockResolvedValue(true);

    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));

    await act(async () => {
      await result.current.enforceNetwork();
    });

    expect(mockSwitchNetwork).toHaveBeenCalledWith('0x6c11a0');
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
  });

  it('enforceNetwork calls switchNetwork when on a supported chain that is not the target', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 11155111 };
    mockSwitchNetwork.mockResolvedValue(true);

    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));

    await act(async () => {
      await result.current.enforceNetwork();
    });

    expect(mockSwitchNetwork).toHaveBeenCalledWith('0x6c11a0');
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
  });

  it('enforceNetwork does not call switchNetwork when already on the target chain', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 7082400 };

    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));

    await act(async () => {
      await result.current.enforceNetwork();
    });

    expect(mockSwitchNetwork).not.toHaveBeenCalled();
  });

  it('handles hex chainId for MetaMask', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result } = renderHook(() => useNetworkEnforcer('0x6c11a0', mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(false);
    expect(result.current.isOffTargetNetwork).toBe(false);
  });

  it('clears warning when network becomes on-target', () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;

    const { result, rerender } = renderHook(
      ({ chainId }) => useNetworkEnforcer(chainId, mockSwitchNetwork),
      { initialProps: { chainId: '7082400' } }
    );

    expect(result.current.isOffTargetNetwork).toBe(false);
    expect(result.current.networkMismatchWarning).toBeNull();

    rerender({ chainId: '2632500' });
    expect(result.current.isOffTargetNetwork).toBe(true);

    rerender({ chainId: '7082400' });
    expect(result.current.isOffTargetNetwork).toBe(false);
  });
});
