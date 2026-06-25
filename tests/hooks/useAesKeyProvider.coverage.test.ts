import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { CotiPluginError, CotiErrorCode } from '../../src/errors';
import {
  unmuteChainUpdates,
  isChainUpdatesMuted,
} from '../../src/lib/chainMute';
import type { WalletTypeInfo } from '../../src/hooks/useWalletType';

const COTI_TESTNET = 7082400;
const COTI_MAINNET = 2632500;
const SEPOLIA = 11155111;
const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const VALID_KEY = 'a'.repeat(64);

// ─── Mocks ──────────────────────────────────────────────────────────────────

const snapState = vi.hoisted(() => ({
  getAESKeyFromSnap: vi.fn(),
  saveAESKeyToSnap: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../src/hooks/useSnap', () => ({
  useSnap: () => ({
    getAESKeyFromSnap: snapState.getAESKeyFromSnap,
    saveAESKeyToSnap: snapState.saveAESKeyToSnap,
  }),
}));

vi.mock('../../src/lib/snapOrigins', () => ({
  canPersistAesKeyToSnap: vi.fn(() => true),
}));

const wagmiState = vi.hoisted(() => ({
  connector: undefined as any,
  chainId: undefined as number | undefined,
  connectorClient: undefined as any,
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({ connector: wagmiState.connector, chainId: wagmiState.chainId }),
  useConnectorClient: () => ({ data: wagmiState.connectorClient }),
}));

const ethersState = vi.hoisted(() => ({
  getSigner: vi.fn(),
}));
vi.mock('@coti-io/coti-ethers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class BrowserProvider {
    constructor(_p: unknown) {}
    getSigner = ethersState.getSigner;
  }
  return { ...actual, BrowserProvider };
});

import { useAesKeyProvider } from '../../src/hooks/useAesKeyProvider';

function walletInfo(overrides: Partial<WalletTypeInfo> = {}): WalletTypeInfo {
  return {
    isMetaMaskWithSnap: false,
    walletType: 'unknown',
    connectorId: undefined,
    ...overrides,
  };
}

function makeSigner(aesKey: string | null | undefined, opts: { generateThrows?: any } = {}) {
  return {
    generateOrRecoverAes: opts.generateThrows
      ? vi.fn().mockRejectedValue(opts.generateThrows)
      : vi.fn().mockResolvedValue(undefined),
    getUserOnboardInfo: vi.fn().mockReturnValue(
      aesKey === undefined ? undefined : { aesKey },
    ),
  };
}

describe('useAesKeyProvider (full branch coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unmuteChainUpdates();
    wagmiState.connector = undefined;
    wagmiState.chainId = undefined;
    wagmiState.connectorClient = undefined;
    ethersState.getSigner.mockResolvedValue(makeSigner(VALID_KEY));
  });

  afterEach(() => {
    unmuteChainUpdates();
  });

  // ─── MetaMask / Snap route ──────────────────────────────────────────────

  describe('MetaMask snap route', () => {
    it('returns the snap key when valid', async () => {
      snapState.getAESKeyFromSnap.mockResolvedValue(VALID_KEY);
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe(VALID_KEY);
    });

    it('returns null when snap key fails format validation', async () => {
      snapState.getAESKeyFromSnap.mockResolvedValue('zzzz');
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
    });

    it('returns null when snap returns null (user cancelled)', async () => {
      snapState.getAESKeyFromSnap.mockResolvedValue(null);
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
    });

    it('returns null when snap throws a user rejection (code 4001)', async () => {
      snapState.getAESKeyFromSnap.mockRejectedValue({ code: 4001 });
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
    });

    it('returns null when snap throws an error whose message includes "rejected the request"', async () => {
      snapState.getAESKeyFromSnap.mockRejectedValue({ message: 'User rejected the request' });
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
    });

    it('rethrows non-rejection, non-SNAP_CONNECT_FAILED errors', async () => {
      snapState.getAESKeyFromSnap.mockRejectedValue(new Error('unexpected'));
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      await expect(
        act(async () => {
          await result.current.getAesKey(ADDR);
        }),
      ).rejects.toThrow('unexpected');
    });

    it('falls through to the contract route on SNAP_CONNECT_FAILED', async () => {
      snapState.getAESKeyFromSnap.mockRejectedValue(
        new CotiPluginError(CotiErrorCode.SNAP_CONNECT_FAILED, 'no snap'),
      );
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET; // already on COTI → no chain switch

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe(VALID_KEY);
      expect(snapState.saveAESKeyToSnap).toHaveBeenCalledWith(VALID_KEY, ADDR);
    });

    it('falls through to the contract route when Snap has no AES key', async () => {
      snapState.getAESKeyFromSnap.mockRejectedValue(
        new CotiPluginError(CotiErrorCode.AES_KEY_MISSING, 'empty snap'),
      );
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe(VALID_KEY);
      expect(snapState.saveAESKeyToSnap).toHaveBeenCalledWith(VALID_KEY, ADDR);
    });

    it('does not persist to Snap for non-MetaMask contract onboarding', async () => {
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      await act(async () => {
        await result.current.getAesKey(ADDR);
      });
      expect(snapState.saveAESKeyToSnap).not.toHaveBeenCalled();
    });
  });

  // ─── Contract route, no chain switch (already on COTI) ───────────────────

  describe('contract route (no connector / provider issues)', () => {
    it('sets error and returns null when no connector is available', async () => {
      wagmiState.connector = undefined;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
      expect(result.current.onboardingError).toContain('No wallet provider available');
    });

    it('sets error and returns null when the connector provides no provider', async () => {
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue(null) };
      wagmiState.chainId = COTI_TESTNET;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
      expect(result.current.onboardingError).toContain('Could not get provider');
    });
  });

  describe('contract route on a COTI chain (no switching)', () => {
    it('returns the AES key when already on COTI testnet', async () => {
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe(VALID_KEY);
      expect(isChainUpdatesMuted()).toBe(false);
    });

    it('returns the AES key when already on COTI mainnet', async () => {
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_MAINNET;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe(VALID_KEY);
    });

    it('sets an error but still returns the key when the onboard key has an invalid format', async () => {
      ethersState.getSigner.mockResolvedValue(makeSigner('bad-key'));
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe('bad-key');
      expect(result.current.onboardingError).toContain('invalid format');
    });

    it('returns null when the onboard info has no aes key', async () => {
      ethersState.getSigner.mockResolvedValue(makeSigner(undefined));
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
    });
  });

  // ─── Contract route with chain switching (non-COTI) ──────────────────────

  // The contract route mutes chain updates and, in its finally block, waits
  // 1500ms (real setTimeout) before unmuting. We intentionally use REAL timers
  // here: both vi.useFakeTimers() and spying on global.setTimeout were observed
  // to break v8 coverage collection for the module under test.
  describe('contract route requiring a chain switch', () => {
    it('switches to COTI, onboards, switches back, then unmutes', async () => {
      const request = vi.fn().mockResolvedValue(undefined);
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request }) };
      wagmiState.chainId = SEPOLIA;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe(VALID_KEY);
      // switch to COTI + switch back to original
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'wallet_switchEthereumChain' }),
      );
      expect(isChainUpdatesMuted()).toBe(false);
    });

    it('warns but still resolves when switching back to the original chain fails', async () => {
      const request = vi.fn()
        .mockResolvedValueOnce(undefined) // switch to COTI
        .mockRejectedValueOnce(new Error('switch back failed')); // switch back
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request }) };
      wagmiState.chainId = SEPOLIA;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe(VALID_KEY);
    });

    it('adds the COTI chain when switch fails with 4902, then onboards', async () => {
      const request = vi.fn()
        .mockRejectedValueOnce({ code: 4902 }) // switch → not added
        .mockResolvedValueOnce(undefined) // add chain
        .mockResolvedValueOnce(undefined); // switch back
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request }) };
      wagmiState.chainId = SEPOLIA;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe(VALID_KEY);
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'wallet_addEthereumChain' }),
      );
    });

    it('returns null and sets an error when adding the COTI chain fails', async () => {
      const request = vi.fn()
        .mockRejectedValueOnce({ code: 4902 }) // switch
        .mockRejectedValueOnce(new Error('add failed')); // add
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request }) };
      wagmiState.chainId = SEPOLIA;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
      expect(result.current.onboardingError).toContain('Failed to add COTI Testnet');
      expect(isChainUpdatesMuted()).toBe(false);
    });

    it('returns null without an error when the user rejects the switch (4001)', async () => {
      const request = vi.fn().mockRejectedValueOnce({ code: 4001 });
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request }) };
      wagmiState.chainId = SEPOLIA;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
      expect(result.current.onboardingError).toBeNull();
      expect(isChainUpdatesMuted()).toBe(false);
    });

    it('returns null and sets an error on a non-4902/4001 switch failure', async () => {
      const request = vi.fn().mockRejectedValueOnce({ code: 5000 });
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request }) };
      wagmiState.chainId = SEPOLIA;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
      expect(result.current.onboardingError).toContain('Failed to switch to COTI Testnet');
    });

    it('handles a null connectedChainId (no originalChainHex, no switch back)', async () => {
      const request = vi.fn().mockResolvedValue(undefined);
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request }) };
      wagmiState.chainId = undefined; // isCotiChain=false, originalChainHex=null
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe(VALID_KEY);
    });
  });

  // ─── Error handling in the main try/catch ────────────────────────────────

  describe('onboarding errors', () => {
    it('returns null without error when onboarding signing is rejected (4001) on a COTI chain', async () => {
      ethersState.getSigner.mockResolvedValue(makeSigner(VALID_KEY, { generateThrows: { code: 4001 } }));
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
      expect(result.current.onboardingError).toBeNull();
    });

    it('sets an Error message when onboarding throws a generic Error on a COTI chain', async () => {
      ethersState.getSigner.mockResolvedValue(
        makeSigner(VALID_KEY, { generateThrows: new Error('boom onboarding') }),
      );
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
      expect(result.current.onboardingError).toBe('boom onboarding');
    });

    it('uses a fallback message when onboarding throws a non-Error value', async () => {
      ethersState.getSigner.mockResolvedValue(
        makeSigner(VALID_KEY, { generateThrows: 'string failure' }),
      );
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
      expect(result.current.onboardingError).toContain('Failed to retrieve AES key');
    });

    it('attempts to restore the original chain after an onboarding error on a non-COTI chain', async () => {
      const request = vi.fn().mockResolvedValue(undefined);
      const getProvider = vi.fn().mockResolvedValue({ request });
      ethersState.getSigner.mockResolvedValue(
        makeSigner(VALID_KEY, { generateThrows: new Error('onboard failed') }),
      );
      wagmiState.connector = { getProvider };
      wagmiState.chainId = SEPOLIA;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
      // getProvider called once for the BrowserProvider and again in the catch for restore
      expect(getProvider.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('warns when restoring the original chain in the catch path also fails', async () => {
      const request = vi.fn()
        .mockResolvedValueOnce(undefined) // initial switch to COTI
        .mockRejectedValue(new Error('restore failed')); // restore attempts fail
      const getProvider = vi.fn().mockResolvedValue({ request });
      ethersState.getSigner.mockResolvedValue(
        makeSigner(VALID_KEY, { generateThrows: new Error('onboard failed') }),
      );
      wagmiState.connector = { getProvider };
      wagmiState.chainId = SEPOLIA;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
    });
  });

  it('exposes the isOnboarding flag and clears prior errors on each call', async () => {
    snapState.getAESKeyFromSnap.mockResolvedValue(VALID_KEY);
    const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));
    expect(result.current.isOnboarding).toBe(false);

    await act(async () => {
      await result.current.getAesKey(ADDR);
    });
    expect(result.current.onboardingError).toBeNull();
  });
});
