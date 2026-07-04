import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { CotiPluginError, CotiErrorCode } from '../../src/errors';
import { configureCotiPlugin } from '../../src/config/plugin';
import { encryptAesKeyBackup } from '../../src/crypto/aesKeyBackupVault';
import {
  unmuteChainUpdates,
  isChainUpdatesMuted,
} from '../../src/lib/chainMute';
import type { WalletTypeInfo } from '../../src/hooks/useWalletType';

const COTI_TESTNET = 7082400;
const COTI_MAINNET = 2632500;
const SEPOLIA = 11155111;
const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const VALID_KEY = 'a'.repeat(32);

// ─── Mocks ──────────────────────────────────────────────────────────────────

const snapState = vi.hoisted(() => ({
  getAESKeyFromSnap: vi.fn(),
  saveAESKeyToSnap: vi.fn().mockResolvedValue(true),
  clearSnapCache: vi.fn(),
}));
vi.mock('../../src/hooks/useSnap', () => ({
  useSnap: () => ({
    getAESKeyFromSnap: snapState.getAESKeyFromSnap,
    saveAESKeyToSnap: snapState.saveAESKeyToSnap,
    clearSnapCache: snapState.clearSnapCache,
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
  signer: null as ReturnType<typeof makeSigner> | null,
  JsonRpcSigner: vi.fn(),
  getSigner: vi.fn(),
  getBalance: vi.fn(),
}));

function makeSigner(aesKey: string | null | undefined, opts: { generateThrows?: any } = {}) {
  return {
    generateOrRecoverAes: opts.generateThrows
      ? vi.fn().mockRejectedValue(opts.generateThrows)
      : vi.fn().mockResolvedValue(undefined),
    getUserOnboardInfo: vi.fn().mockReturnValue(
      aesKey === undefined ? undefined : { aesKey },
    ),
    signTypedData: vi.fn().mockResolvedValue('0xbackup-signature'),
  };
}

vi.mock('@coti-io/coti-ethers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class BrowserProvider {
    constructor(_p: unknown) {}
    getSigner = ethersState.getSigner;
    getBalance = ethersState.getBalance;
  }
  class JsonRpcSigner {
    generateOrRecoverAes: ReturnType<typeof vi.fn>;
    getUserOnboardInfo: ReturnType<typeof vi.fn>;
    signTypedData: ReturnType<typeof vi.fn>;
    constructor(_provider: unknown, _address: string) {
      ethersState.JsonRpcSigner(_provider, _address);
      const signer = ethersState.signer ?? makeSigner(VALID_KEY);
      this.generateOrRecoverAes = signer.generateOrRecoverAes;
      this.getUserOnboardInfo = signer.getUserOnboardInfo;
      this.signTypedData = signer.signTypedData;
    }
  }
  return { ...actual, BrowserProvider, JsonRpcSigner };
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

const mobileState = vi.hoisted(() => ({
  isMetaMaskMobileBrowser: vi.fn(() => false),
}));
vi.mock('../../src/lib/metaMaskMobile', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isMetaMaskMobileBrowser: () => mobileState.isMetaMaskMobileBrowser(),
  };
});

describe('useAesKeyProvider (full branch coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unmuteChainUpdates();
    wagmiState.connector = undefined;
    wagmiState.chainId = undefined;
    wagmiState.connectorClient = undefined;
    ethersState.signer = makeSigner(VALID_KEY);
    ethersState.getSigner.mockResolvedValue(makeSigner(VALID_KEY));
    ethersState.getBalance.mockResolvedValue(1n);
    mobileState.isMetaMaskMobileBrowser.mockReturnValue(false);
    configureCotiPlugin({
      onboardingServices: {
        mode: 'disabled',
        grantNativeCoti: undefined,
        fetchEncryptedAesBackup: undefined,
        saveEncryptedAesBackup: undefined,
        replaceEncryptedAesBackup: undefined,
      },
    });
  });

  afterEach(() => {
    unmuteChainUpdates();
  });

  // ─── MetaMask / Snap route ──────────────────────────────────────────────

  describe('MetaMask snap route', () => {
    it('returns the snap key when valid', async () => {
      mobileState.isMetaMaskMobileBrowser.mockReturnValue(false);
      snapState.getAESKeyFromSnap.mockResolvedValue(VALID_KEY);
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBe(VALID_KEY);
      expect(snapState.getAESKeyFromSnap).toHaveBeenCalledWith(ADDR, { skipCache: true });
    });

    it('skips snap on MetaMask Mobile and uses contract onboarding', async () => {
      mobileState.isMetaMaskMobileBrowser.mockReturnValue(true);
      snapState.getAESKeyFromSnap.mockResolvedValue(VALID_KEY);
      ethersState.signer = makeSigner('c'.repeat(32));
      wagmiState.connector = {
        getProvider: vi.fn().mockResolvedValue({ request: vi.fn().mockResolvedValue(undefined) }),
      };
      wagmiState.chainId = COTI_TESTNET;

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });

      expect(snapState.getAESKeyFromSnap).not.toHaveBeenCalled();
      expect(key).toBe('c'.repeat(32));
      expect(ethersState.JsonRpcSigner).toHaveBeenCalled();
    });

    it('skips snap and uses contract onboarding when forceContractOnboarding is set', async () => {
      const contractKey = 'b'.repeat(32);
      ethersState.signer = makeSigner(contractKey);
      wagmiState.connector = {
        getProvider: vi.fn().mockResolvedValue({ request: vi.fn().mockResolvedValue(undefined) }),
      };
      wagmiState.chainId = COTI_TESTNET;

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR, undefined, { forceContractOnboarding: true });
      });

      expect(snapState.clearSnapCache).toHaveBeenCalled();
      expect(snapState.getAESKeyFromSnap).not.toHaveBeenCalled();
      expect(key).toBe(contractKey);
      expect(snapState.saveAESKeyToSnap).toHaveBeenCalledWith(contractKey, ADDR);
    });

    it('does not export snap key during restore-only unlock', async () => {
      const walletProvider = { request: vi.fn().mockResolvedValue(undefined) };
      wagmiState.connector = {
        getProvider: vi.fn().mockResolvedValue(walletProvider),
      };
      wagmiState.chainId = COTI_TESTNET;

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR, undefined, { restoreOnly: true });
      });

      expect(key).toBeNull();
      expect(snapState.getAESKeyFromSnap).not.toHaveBeenCalled();
      expect(walletProvider.request).not.toHaveBeenCalled();
      expect(ethersState.getSigner).not.toHaveBeenCalled();
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

    it('restores an encrypted backup before contract onboarding', async () => {
      const signer = makeSigner(VALID_KEY);
      const backup = await encryptAesKeyBackup(VALID_KEY, signer, {
        address: ADDR,
        chainId: COTI_TESTNET,
      });
      ethersState.getSigner.mockResolvedValue(signer);
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      const fetchEncryptedAesBackup = vi.fn().mockResolvedValue(backup);
      configureCotiPlugin({
        onboardingServices: {
          mode: 'custom',
          fetchEncryptedAesBackup,
        },
      });

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });

      expect(key).toBe(VALID_KEY);
      expect(fetchEncryptedAesBackup).toHaveBeenCalledWith({ address: ADDR, chainId: COTI_TESTNET });
      expect(signer.generateOrRecoverAes).not.toHaveBeenCalled();
    });

    it('persists a MetaMask backup restore to Snap before returning the key', async () => {
      const signer = makeSigner(VALID_KEY);
      const backup = await encryptAesKeyBackup(VALID_KEY, signer, {
        address: ADDR,
        chainId: COTI_TESTNET,
      });
      ethersState.getSigner.mockResolvedValue(signer);
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      configureCotiPlugin({
        onboardingServices: {
          mode: 'custom',
          fetchEncryptedAesBackup: vi.fn().mockResolvedValue(backup),
        },
      });

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR, undefined, { restoreOnly: true });
      });

      expect(key).toBe(VALID_KEY);
      expect(snapState.getAESKeyFromSnap).not.toHaveBeenCalled();
      expect(snapState.saveAESKeyToSnap).toHaveBeenCalledWith(VALID_KEY, ADDR);
      expect(signer.generateOrRecoverAes).not.toHaveBeenCalled();
    });

    it('persists restored backup to Snap and returns null when hydrateSnapFromBackup is set', async () => {
      const signer = makeSigner(VALID_KEY);
      const backup = await encryptAesKeyBackup(VALID_KEY, signer, {
        address: ADDR,
        chainId: COTI_TESTNET,
      });
      ethersState.getSigner.mockResolvedValue(signer);
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      configureCotiPlugin({
        onboardingServices: {
          mode: 'custom',
          fetchEncryptedAesBackup: vi.fn().mockResolvedValue(backup),
        },
      });

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'metamask' })));

      let key: string | null = 'pending';
      await act(async () => {
        key = await result.current.getAesKey(ADDR, undefined, {
          restoreOnly: true,
          hydrateSnapFromBackup: true,
        });
      });

      expect(key).toBeNull();
      expect(snapState.getAESKeyFromSnap).not.toHaveBeenCalled();
      expect(snapState.saveAESKeyToSnap).toHaveBeenCalledWith(VALID_KEY, ADDR);
    });

    it('falls back to onboarding when backup restore fails', async () => {
      const signer = makeSigner(VALID_KEY);
      ethersState.signer = signer;
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      configureCotiPlugin({
        onboardingServices: {
          mode: 'custom',
          fetchEncryptedAesBackup: vi.fn().mockResolvedValue({
            version: 1,
            address: ADDR,
            chainId: COTI_TESTNET,
            signatureKind: 'eip712',
            iv: 'bad',
            ciphertext: 'bad',
            createdAt: new Date().toISOString(),
          }),
        },
      });

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });

      expect(key).toBe(VALID_KEY);
      expect(signer.generateOrRecoverAes).toHaveBeenCalled();
      expect(result.current.onboardingWarning).toContain('Encrypted backup could not be restored');
    });

    it('calls grant and waits for balance when native COTI is below threshold', async () => {
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      ethersState.getBalance
        .mockResolvedValueOnce(0n)
        .mockResolvedValueOnce(10n);
      const grantNativeCoti = vi.fn().mockResolvedValue({ status: 'submitted' });
      configureCotiPlugin({
        onboardingServices: {
          mode: 'custom',
          grantNativeCoti,
        },
        onboardingGrantMinBalanceWei: 10,
        onboardingGrantPollIntervalMs: 0,
        onboardingGrantTimeoutMs: 50,
      });

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });

      expect(key).toBe(VALID_KEY);
      expect(grantNativeCoti).toHaveBeenCalledWith({ address: ADDR, chainId: COTI_TESTNET });
    });

    it('skips grant polling when the grant service returns skipped', async () => {
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      ethersState.getBalance.mockResolvedValue(0n);
      const grantNativeCoti = vi.fn().mockResolvedValue({ status: 'skipped' });
      configureCotiPlugin({
        onboardingServices: {
          mode: 'custom',
          grantNativeCoti,
        },
        onboardingGrantMinBalanceWei: 10,
        onboardingGrantPollIntervalMs: 0,
        onboardingGrantTimeoutMs: 50,
      });

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });

      expect(key).toBe(VALID_KEY);
      expect(grantNativeCoti).toHaveBeenCalledWith({ address: ADDR, chainId: COTI_TESTNET });
      expect(ethersState.getBalance).toHaveBeenCalledTimes(1);
    });

    it('continues onboarding when the grant API rejects', async () => {
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      ethersState.getBalance.mockResolvedValue(0n);
      const grantNativeCoti = vi.fn().mockRejectedValue(new Error('grant rejected'));
      const signer = makeSigner(VALID_KEY);
      ethersState.signer = signer;
      configureCotiPlugin({
        onboardingServices: {
          mode: 'custom',
          grantNativeCoti,
        },
        onboardingGrantMinBalanceWei: 10,
      });

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });

      expect(key).toBe(VALID_KEY);
      expect(grantNativeCoti).toHaveBeenCalledWith({ address: ADDR, chainId: COTI_TESTNET });
      expect(signer.generateOrRecoverAes).toHaveBeenCalled();
      expect(result.current.onboardingError).toBeNull();
    });

    it('saves an encrypted backup after onboarding when requested', async () => {
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      const saveEncryptedAesBackup = vi.fn().mockResolvedValue(undefined);
      configureCotiPlugin({
        onboardingServices: {
          mode: 'custom',
          saveEncryptedAesBackup,
        },
      });

      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = null;
      await act(async () => {
        key = await result.current.getAesKey(ADDR, undefined, { saveBackup: true });
      });

      expect(key).toBe(VALID_KEY);
      expect(saveEncryptedAesBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          address: ADDR,
          chainId: COTI_TESTNET,
          backup: expect.objectContaining({ signatureKind: 'eip712' }),
        }),
      );
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
      ethersState.signer = makeSigner('bad-key');
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
      ethersState.signer = makeSigner(undefined);
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
      ethersState.signer = makeSigner(VALID_KEY, { generateThrows: { code: 4001 } });
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
      ethersState.signer = makeSigner(VALID_KEY, { generateThrows: new Error('boom onboarding') });
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
      ethersState.signer = makeSigner(VALID_KEY, { generateThrows: 'string failure' });
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }) };
      wagmiState.chainId = COTI_TESTNET;
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });
      expect(key).toBeNull();
      expect(result.current.onboardingError).toBe('string failure');
    });

    it('attempts to restore the original chain after an onboarding error on a non-COTI chain', async () => {
      const request = vi.fn().mockResolvedValue(undefined);
      const getProvider = vi.fn().mockResolvedValue({ request });
      ethersState.signer = makeSigner(VALID_KEY, { generateThrows: new Error('onboard failed') });
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

    it('restores the wallet request wrapper when signer setup fails', async () => {
      const request = vi.fn().mockResolvedValue(undefined);
      const walletProvider = { request };
      wagmiState.connector = { getProvider: vi.fn().mockResolvedValue(walletProvider) };
      wagmiState.chainId = COTI_TESTNET;
      ethersState.JsonRpcSigner.mockImplementationOnce(() => {
        throw new Error('eth_accounts failed');
      });
      const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

      let key: string | null = 'x';
      await act(async () => {
        key = await result.current.getAesKey(ADDR);
      });

      expect(key).toBeNull();
      expect(result.current.onboardingError).toBe('eth_accounts failed');
    });

    it('warns when restoring the original chain in the catch path also fails', async () => {
      const request = vi.fn()
        .mockResolvedValueOnce(undefined) // initial switch to COTI
        .mockRejectedValue(new Error('restore failed')); // restore attempts fail
      const getProvider = vi.fn().mockResolvedValue({ request });
      ethersState.signer = makeSigner(VALID_KEY, { generateThrows: new Error('onboard failed') });
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
