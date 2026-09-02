import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAccount } from 'wagmi';
import { CotiErrorCode, CotiPluginError } from '../../src/errors';
import { configureCotiPlugin } from '../../src/config/plugin';

const h = vi.hoisted(() => ({
  walletType: {
    walletType: 'metamask' as const,
    isMetaMaskWithSnap: true,
    connectorId: 'io.metamask',
  },
  persist: vi.fn(),
  resolveStrategy: vi.fn(),
  sendTransfer: vi.fn(),
  resolveProvider: vi.fn(),
  getValidated: vi.fn(),
}));

vi.mock('../../src/hooks/useWalletType', () => ({
  useWalletType: () => h.walletType,
}));

vi.mock('../../src/lib/persistEncryptedAesBackup', () => ({
  persistEncryptedAesBackup: (...args: unknown[]) => h.persist(...args),
}));

vi.mock('../../src/lib/aesAccessStrategy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/aesAccessStrategy')>();
  return {
    ...actual,
    resolveAesAccessStrategy: (...args: unknown[]) => h.resolveStrategy(...args),
  };
});

vi.mock('../../src/hooks/bridge/executePrivateTokenTransfer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/bridge/executePrivateTokenTransfer')>();
  return {
    ...actual,
    sendPrivateTokenTransfer: (...args: unknown[]) => h.sendTransfer(...args),
  };
});

vi.mock('../../src/lib/ethereum', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/ethereum')>();
  return {
    ...actual,
    resolveConnectedProvider: (...args: unknown[]) => h.resolveProvider(...args),
  };
});

vi.mock('../../src/crypto/aesKeyValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/crypto/aesKeyValidation')>();
  return {
    ...actual,
    getValidatedAesKeyForUnlock: (...args: unknown[]) => h.getValidated(...args),
  };
});

import { usePluginUnlockSession } from '../../src/context/plugin/usePluginUnlockSession';

const WALLET = '0x' + 'a'.repeat(40);
const AES_KEY = 'a'.repeat(32);

const localStrategy = {
  mode: 'local' as const,
  snapInstalled: false,
  snapHasKey: false,
  hasEncryptedBackup: false,
  aesKeyChainId: 7082400,
};

function makeCore(overrides: Record<string, unknown> = {}) {
  return {
    walletAddress: WALLET,
    sessionAesKey: AES_KEY,
    setSnapError: vi.fn(),
    setSessionAesKey: vi.fn(),
    aesKeyChainId: 7082400,
    setAesKeyChainId: vi.fn(),
    arePrivateBalancesHidden: false,
    setArePrivateBalancesHidden: vi.fn(),
    handleManualOnboarding: vi.fn(),
    handleKeyVerification: vi.fn(),
    clearSnapCache: vi.fn(),
    setPrivateTokens: vi.fn(),
    wagmiSyncRef: { current: false },
    hasSnap: true,
    hasAesKeyInSnap: vi.fn().mockResolvedValue(true),
    checkSnapStatus: vi.fn().mockResolvedValue(true),
    getAESKeyFromSnap: vi.fn(),
    encryptUint256ViaSnap: vi.fn(),
    decryptCtUint256ViaSnap: vi.fn(),
    ...overrides,
  };
}

function makeAccountSync(overrides: Record<string, unknown> = {}) {
  return {
    establishAesSession: vi.fn().mockResolvedValue({ ok: true, aesKey: AES_KEY }),
    refreshPublicBalances: vi.fn().mockResolvedValue({ ok: true }),
    refreshPrivateBalances: vi.fn().mockResolvedValue({ ok: true }),
    currentChainId: 7082400,
    ...overrides,
  };
}

describe('usePluginUnlockSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.walletType.walletType = 'metamask';
    h.walletType.isMetaMaskWithSnap = true;
    h.resolveStrategy.mockResolvedValue(localStrategy);
    h.persist.mockResolvedValue({ status: 'saved' });
    h.sendTransfer.mockResolvedValue({ txHash: '0x1' });
    h.resolveProvider.mockResolvedValue({ request: vi.fn() });
    h.getValidated.mockReturnValue(undefined);
    vi.mocked(useAccount).mockReturnValue({
      connector: { id: 'io.metamask', getProvider: vi.fn() },
    } as never);
    configureCotiPlugin({ autoInitTokens: true, waitForBalanceRefreshAfterTransfer: false });
  });

  it('skips public catalog refresh on restoreOnly and when autoInitTokens is off', async () => {
    const accountSync = makeAccountSync();
    const { result, rerender } = renderHook(
      (props: { autoInitTokens: boolean }) => usePluginUnlockSession({
        core: makeCore() as never,
        network: { wagmiChainId: 7082400 } as never,
        accountSync: accountSync as never,
        autoInitTokens: props.autoInitTokens,
      }),
      { initialProps: { autoInitTokens: false } },
    );

    await expect(result.current.refreshPrivateBalances()).resolves.toEqual({ ok: true });
    expect(accountSync.refreshPublicBalances).not.toHaveBeenCalled();
    expect(accountSync.refreshPrivateBalances).not.toHaveBeenCalled();

    rerender({ autoInitTokens: true });
    await expect(result.current.refreshPrivateBalances({ restoreOnly: true })).resolves.toEqual({ ok: true });
    expect(accountSync.refreshPublicBalances).not.toHaveBeenCalled();
    expect(accountSync.refreshPrivateBalances).toHaveBeenCalled();
  });

  it('returns the AES session failure from composeUnlockRefresh', async () => {
    const accountSync = makeAccountSync({
      establishAesSession: vi.fn().mockResolvedValue({ ok: false, reason: 'no_aes_key' }),
    });
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: accountSync as never,
    }));
    await expect(result.current.refreshPrivateBalances()).resolves.toEqual({
      ok: false,
      reason: 'no_aes_key',
    });
  });

  it('returns a failed result when public catalog refresh fails during unlock', async () => {
    const accountSync = makeAccountSync({
      refreshPublicBalances: vi.fn().mockResolvedValue({ ok: false, reason: 'failed' }),
    });
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: accountSync as never,
    }));
    await expect(result.current.refreshPrivateBalances()).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('saves a manual AES key and reports backup outcomes', async () => {
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync() as never,
    }));

    await expect(result.current.saveManualAesKey(AES_KEY)).resolves.toEqual({});

    h.persist.mockResolvedValueOnce({
      status: 'failed',
      code: CotiErrorCode.AES_BACKUP_WALLET_NOT_SUPPORTED,
      message: 'no typed data',
    });
    await expect(result.current.saveManualAesKey(AES_KEY, { saveBackup: true })).resolves.toMatchObject({
      backupWarning: expect.stringContaining('cannot save'),
    });

    h.persist.mockResolvedValueOnce({ status: 'cancelled', code: CotiErrorCode.USER_REJECTED });
    await expect(result.current.saveManualAesKey(AES_KEY, { saveBackup: true })).resolves.toMatchObject({
      backupCancelled: true,
    });

    h.persist.mockResolvedValueOnce({
      status: 'failed',
      code: CotiErrorCode.AES_BACKUP_STORAGE_FAILED,
      message: 'quota',
    });
    await expect(result.current.saveManualAesKey(AES_KEY, { saveBackup: true })).resolves.toMatchObject({
      backupWarning: expect.stringContaining('not saved'),
    });
  });

  it('rejects an invalid manual AES key and requires a connected wallet', async () => {
    const { result, rerender } = renderHook(
      (props: { walletAddress: string }) => usePluginUnlockSession({
        core: makeCore({ walletAddress: props.walletAddress }) as never,
        network: { wagmiChainId: 7082400 } as never,
        accountSync: makeAccountSync() as never,
      }),
      { initialProps: { walletAddress: WALLET } },
    );
    await expect(result.current.saveManualAesKey('zz')).rejects.toThrow('32 hexadecimal');

    rerender({ walletAddress: '' });
    await expect(result.current.saveManualAesKey(AES_KEY)).rejects.toThrow('Connect your wallet first');
    await expect(result.current.refreshPublicBalances()).resolves.toEqual({
      ok: false,
      reason: 'not_connected',
    });
    await expect(result.current.refreshPrivateBalances()).resolves.toEqual({
      ok: false,
      reason: 'not_connected',
    });
  });

  it('encrypts and decrypts with the local AES key, and via Snap', async () => {
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync() as never,
    }));

    const encrypted = await result.current.encryptPrivateValue({ amount: '1' });
    expect(encrypted.ciphertext).toEqual(expect.any(String));
    const decrypted = await result.current.decryptPrivateValue({ ciphertext: encrypted.ciphertext });
    expect(decrypted.amount).toMatch(/^1/);

    h.resolveStrategy.mockResolvedValue({
      ...localStrategy,
      mode: 'snap',
      snapInstalled: true,
    });
    const core = makeCore({
      encryptUint256ViaSnap: vi.fn().mockResolvedValue({ ciphertextHigh: 1n, ciphertextLow: 2n }),
      decryptCtUint256ViaSnap: vi.fn().mockResolvedValue(10n ** 18n),
    });
    const { result: snap } = renderHook(() => usePluginUnlockSession({
      core: core as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync() as never,
    }));
    await expect(snap.current.encryptPrivateValue({ amount: '1' })).resolves.toMatchObject({
      ciphertext: expect.any(String),
    });
    await expect(snap.current.decryptPrivateValue({
      ciphertext: encrypted.ciphertext,
    })).resolves.toMatchObject({ amount: expect.any(String) });

    const nullSnapCore = makeCore({
      encryptUint256ViaSnap: vi.fn().mockResolvedValue(null),
      decryptCtUint256ViaSnap: vi.fn().mockResolvedValue(null),
    });
    const { result: nullSnap } = renderHook(() => usePluginUnlockSession({
      core: nullSnapCore as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync() as never,
    }));
    await expect(nullSnap.current.encryptPrivateValue({ amount: '1' })).rejects.toThrow('Snap encrypt');
    await expect(nullSnap.current.decryptPrivateValue({
      ciphertext: encrypted.ciphertext,
    })).rejects.toThrow('Snap decrypt');
  });

  it('rejects encrypt/decrypt while onboard is required and when locked', async () => {
    h.resolveStrategy.mockResolvedValue({ ...localStrategy, mode: 'onboard' });
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync() as never,
    }));
    await expect(result.current.encryptPrivateValue({ amount: '1' })).rejects.toThrow(
      'Unlock private balances before encrypting',
    );
    await expect(result.current.decryptPrivateValue({ ciphertext: '{}' })).rejects.toThrow(
      'Unlock private balances before decrypting',
    );

    const locked = renderHook(() => usePluginUnlockSession({
      core: makeCore({ arePrivateBalancesHidden: true }) as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync() as never,
    }));
    await expect(locked.result.current.encryptPrivateValue({ amount: '1' })).rejects.toThrow('locked');
  });

  it('locks private balances and zeroes token catalogs when tokens are disabled', () => {
    const setPrivateTokens = vi.fn();
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore({ setPrivateTokens }) as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync() as never,
      autoInitTokens: false,
    }));
    act(() => result.current.lockPrivateBalances());
    expect(setPrivateTokens).toHaveBeenCalled();
  });

  it('sends a private transfer and refreshes balances in the background', async () => {
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync() as never,
    }));
    await expect(result.current.sendPrivateToken({
      symbol: 'p.COTI',
      recipient: '0x' + 'b'.repeat(40),
      amount: '1',
    })).resolves.toEqual({ txHash: '0x1' });
    expect(h.sendTransfer).toHaveBeenCalled();
  });

  it('rejects private transfers when locked, disconnected, or off-network', async () => {
    const locked = renderHook(() => usePluginUnlockSession({
      core: makeCore({ arePrivateBalancesHidden: true }) as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync() as never,
    }));
    await expect(locked.result.current.sendPrivateToken({
      symbol: 'p.COTI',
      recipient: '0x' + 'b'.repeat(40),
      amount: '1',
    })).rejects.toThrow('Private balances are locked');

    const disconnected = renderHook(() => usePluginUnlockSession({
      core: makeCore({ walletAddress: '' }) as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync() as never,
    }));
    await expect(disconnected.result.current.sendPrivateToken({
      symbol: 'p.COTI',
      recipient: '0x' + 'b'.repeat(40),
      amount: '1',
    })).rejects.toThrow('Wallet not connected');

    const offline = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync({ currentChainId: Number.NaN }) as never,
    }));
    await expect(offline.result.current.sendPrivateToken({
      symbol: 'p.COTI',
      recipient: '0x' + 'b'.repeat(40),
      amount: '1',
    })).rejects.toThrow('Network not available');
  });

  it('awaits a balance refresh after transfer when configured', async () => {
    configureCotiPlugin({ autoInitTokens: true, waitForBalanceRefreshAfterTransfer: true });
    const accountSync = makeAccountSync();
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: accountSync as never,
    }));
    await result.current.sendPrivateToken({
      symbol: 'p.COTI',
      recipient: '0x' + 'b'.repeat(40),
      amount: '1',
    });
    expect(accountSync.establishAesSession).toHaveBeenCalled();
  });

  it('returns unsupported_chain when the network is unavailable', async () => {
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: makeAccountSync({ currentChainId: Number.NaN }) as never,
    }));
    await expect(result.current.refreshPrivateBalances()).resolves.toEqual({
      ok: false,
      reason: 'unsupported_chain',
    });
  });

  it('returns user_rejected when the wallet request is rejected', async () => {
    const accountSync = makeAccountSync({
      refreshPrivateBalances: vi.fn().mockRejectedValue(
        Object.assign(new Error('User rejected the request'), { code: 4001 }),
      ),
    });
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: accountSync as never,
    }));
    await expect(result.current.refreshPrivateBalances()).resolves.toEqual({
      ok: false,
      reason: 'user_rejected',
    });
  });

  it('surfaces public refresh failures as a failed result', async () => {
    const accountSync = makeAccountSync({
      refreshPublicBalances: vi.fn().mockRejectedValue(new Error('rpc down')),
    });
    const { result } = renderHook(() => usePluginUnlockSession({
      core: makeCore() as never,
      network: { wagmiChainId: 7082400 } as never,
      accountSync: accountSync as never,
    }));
    await expect(result.current.refreshPublicBalances()).resolves.toEqual({ ok: false, reason: 'failed' });
  });
});
