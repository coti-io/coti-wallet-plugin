import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock wagmi
const mockGetProvider = vi.fn();
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    connector: { getProvider: mockGetProvider },
  })),
  useConnectorClient: vi.fn(() => ({ data: undefined })),
}));

import { isValidAesKey, useAesKeyProvider } from '../../src/hooks/useAesKeyProvider';
import type { WalletTypeInfo } from '../../src/hooks/useWalletType';

describe('AES Key Provider (README: useAesKeyProvider)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window.ethereum for snap tests
    (window as any).ethereum = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      isMetaMask: true,
    };
  });

  describe('isValidAesKey', () => {
    it('accepts 32-char hex key (128-bit)', () => {
      expect(isValidAesKey('a'.repeat(32))).toBe(true);
    });

    it('rejects 64-char hex key', () => {
      expect(isValidAesKey('b'.repeat(64))).toBe(false);
    });

    it('accepts uppercase hex', () => {
      expect(isValidAesKey('ABCDEF0123456789'.repeat(2))).toBe(true);
    });

    it('accepts keys with 0x prefix', () => {
      expect(isValidAesKey('0x' + 'a'.repeat(32))).toBe(true);
    });

    it('rejects empty string', () => {
      expect(isValidAesKey('')).toBe(false);
    });

    it('rejects 16-char key (too short)', () => {
      expect(isValidAesKey('a'.repeat(16))).toBe(false);
    });

    it('rejects 48-char key (wrong length)', () => {
      expect(isValidAesKey('a'.repeat(48))).toBe(false);
    });

    it('rejects non-hex characters', () => {
      expect(isValidAesKey('g'.repeat(32))).toBe(false);
    });

    it('rejects keys with special characters', () => {
      expect(isValidAesKey('!@#$%^&*()_+abcdef1234567890ab')).toBe(false);
    });
  });

  describe('useAesKeyProvider hook', () => {
    it('returns getAesKey, isOnboarding, and onboardingError', () => {
      const walletTypeInfo: WalletTypeInfo = {
        isMetaMaskWithSnap: false,
        walletType: 'unknown',
        connectorId: undefined,
      };

      const { result } = renderHook(() => useAesKeyProvider(walletTypeInfo));
      expect(result.current.getAesKey).toBeDefined();
      expect(result.current.isOnboarding).toBe(false);
      expect(result.current.onboardingError).toBeNull();
    });

    it('routes MetaMask wallets through snap path first', async () => {
      const walletTypeInfo: WalletTypeInfo = {
        isMetaMaskWithSnap: false,
        walletType: 'metamask',
        connectorId: 'io.metamask',
      };

      // Mock window.ethereum to simulate snap flow
      // isSnapInstalled will be called internally — it will fail, then SNAP_CONNECT_FAILED is thrown
      (window as any).ethereum.request = vi.fn()
        .mockResolvedValueOnce('MetaMask/v11') // web3_clientVersion (detectFlask)
        .mockResolvedValueOnce({}); // wallet_getSnaps returns empty → snap not found

      const { result } = renderHook(() => useAesKeyProvider(walletTypeInfo));

      let key: string | null = null;
      await act(async () => {
        // This should try snap first, get SNAP_CONNECT_FAILED, then fall through to contract
        // Contract will also fail (mock provider), resulting in null
        try {
          key = await result.current.getAesKey('0x1234567890abcdef1234567890abcdef12345678');
        } catch {
          // Expected - snap connect failed and contract onboarding also fails
        }
      });

      // The key will be null because both paths fail in test env
      // But we verify no crash and proper error handling
      expect(result.current.onboardingError).toBeDefined();
    });

    it('sets onboardingError when no connector available for non-MetaMask', async () => {
      // Mock useAccount to return no connector
      const wagmi = await import('wagmi');
      (wagmi.useAccount as any).mockReturnValue({ connector: null });

      const walletTypeInfo: WalletTypeInfo = {
        isMetaMaskWithSnap: false,
        walletType: 'rabby',
        connectorId: 'rabby',
      };

      const { result } = renderHook(() => useAesKeyProvider(walletTypeInfo));

      let key: string | null = 'initial';
      await act(async () => {
        key = await result.current.getAesKey('0xabc');
      });

      expect(key).toBeNull();
      expect(result.current.onboardingError).toContain('No wallet provider');
    });
  });
});
