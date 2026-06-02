import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWallet } from '../../src/hooks/useWallet';

describe('useWallet', () => {
  let mockRequest: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest = vi.fn().mockResolvedValue([]);
    (window as any).ethereum = {
      request: mockRequest,
      on: vi.fn(),
      removeListener: vi.fn(),
      isMetaMask: true,
    };
  });

  it('returns the full UseWalletResult interface', () => {
    const { result } = renderHook(() => useWallet());
    // Connection
    expect(result.current.isConnected).toBe(false);
    expect(result.current.walletAddress).toBe('');
    expect(result.current.connect).toBeDefined();
    expect(result.current.disconnect).toBeDefined();
    // Network
    expect(result.current.networkName).toBeDefined();
    expect(result.current.chainId).toBeDefined();
    expect(result.current.switchNetwork).toBeDefined();
    expect(result.current.COTI_MAINNET_ID).toBe('0x282b34');
    expect(result.current.COTI_TESTNET_ID).toBe('0x6c11a0');
    expect(result.current.SEPOLIA_ID).toBe('0xaa36a7');
    // AES Key
    expect(result.current.sessionAesKey).toBeNull();
    expect(result.current.isPrivateUnlocked).toBe(false);
    expect(result.current.getAesKey).toBeDefined();
    expect(result.current.unlockPrivateBalances).toBeDefined();
    expect(result.current.lockPrivateBalances).toBeDefined();
    expect(result.current.clearKeyCache).toBeDefined();
    // Snap
    expect(result.current.isSnapInstalled).toBeDefined();
    expect(result.current.connectToSnap).toBeDefined();
    expect(result.current.snapError).toBeNull();
    // Onboarding
    expect(result.current.handleOnboard).toBeDefined();
    // MetaMask
    expect(result.current.metamaskDetected).toBe(true);
    expect(result.current.showInstallModal).toBe(false);
  });

  it('metamaskDetected is false when window.ethereum is missing', () => {
    delete (window as any).ethereum;
    const { result } = renderHook(() => useWallet());
    expect(result.current.metamaskDetected).toBe(false);
  });

  describe('connect', () => {
    it('shows install modal when METAMASK_NOT_INSTALLED', async () => {
      delete (window as any).ethereum;
      const { result } = renderHook(() => useWallet());

      await act(async () => {
        await result.current.connect();
      });

      expect(result.current.showInstallModal).toBe(true);
      expect(result.current.metamaskDetected).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('clears isConnected, walletAddress, and sessionAesKey', async () => {
      // Setup: mock connected state
      mockRequest.mockResolvedValue(undefined);
      const { result } = renderHook(() => useWallet());

      await act(async () => {
        await result.current.disconnect();
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.walletAddress).toBe('');
      expect(result.current.sessionAesKey).toBeNull();
    });

    it('handles wallet_revokePermissions failure gracefully', async () => {
      mockRequest.mockRejectedValue(new Error('unsupported'));
      const { result } = renderHook(() => useWallet());

      // Should not throw
      await act(async () => {
        await result.current.disconnect();
      });

      expect(result.current.isConnected).toBe(false);
    });
  });

  describe('lockPrivateBalances', () => {
    it('clears sessionAesKey', () => {
      const { result } = renderHook(() => useWallet());
      act(() => {
        result.current.lockPrivateBalances();
      });
      expect(result.current.sessionAesKey).toBeNull();
      expect(result.current.isPrivateUnlocked).toBe(false);
    });
  });

  describe('unlockPrivateBalances', () => {
    it('returns false when walletAddress is empty', async () => {
      const { result } = renderHook(() => useWallet());
      let success: boolean = false;
      await act(async () => {
        success = await result.current.unlockPrivateBalances();
      });
      expect(success).toBe(false);
    });
  });
});
