import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureCotiPlugin } from '../../src/config/plugin';
import { encryptAesKeyBackup } from '../../src/crypto/aesKeyBackupVault';
import { CotiErrorCode } from '../../src/errors';

const VALID_KEY = 'a'.repeat(32);
const ADDR = '0x1234567890123456789012345678901234567890';
const CHAIN_ID = 7082400;
const FIXED_SIG = '0x' + 'ab'.repeat(65);
const OTHER_SIG = '0x' + 'cd'.repeat(65);

const ethersState = vi.hoisted(() => ({
  getSigner: vi.fn(),
}));

function makeSigner(signature: string = FIXED_SIG) {
  return {
    signTypedData: vi.fn().mockResolvedValue(signature),
  };
}

vi.mock('@coti-io/coti-ethers', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  class BrowserProvider {
    constructor(_provider: unknown) {}
    getSigner = ethersState.getSigner;
  }
  class JsonRpcSigner {
    signTypedData = vi.fn().mockResolvedValue(FIXED_SIG);
    constructor(_provider: unknown, _address: string) {}
  }
  return { ...actual, BrowserProvider, JsonRpcSigner };
});

vi.mock('../../src/crypto/aesKeyBackupVault', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/crypto/aesKeyBackupVault')>();
  return {
    ...actual,
    encryptAesKeyBackup: vi.fn(actual.encryptAesKeyBackup),
  };
});

import { persistEncryptedAesBackup } from '../../src/lib/persistEncryptedAesBackup';

describe('persistEncryptedAesBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ethersState.getSigner.mockResolvedValue(makeSigner());
    configureCotiPlugin({
      unsafeSkipBackupDeterminismCheck: false,
      onboardingServices: { mode: 'disabled' },
    });
  });

  it('skips when onboarding services are disabled', async () => {
    const connector = {
      getProvider: vi.fn(),
    };

    const result = await persistEncryptedAesBackup({
      aesKey: VALID_KEY,
      address: ADDR,
      chainId: CHAIN_ID,
      connector: connector as never,
    });

    expect(result).toEqual({ status: 'skipped' });
    expect(connector.getProvider).not.toHaveBeenCalled();
  });

  it('encrypts, verifies determinism with a second signature, then saves', async () => {
    const saveEncryptedAesBackup = vi.fn().mockResolvedValue(undefined);
    const fetchEncryptedAesBackup = vi.fn().mockResolvedValue(null);
    configureCotiPlugin({
      onboardingServices: {
        mode: 'custom',
        fetchEncryptedAesBackup,
        saveEncryptedAesBackup,
      },
    });

    const signTypedData = vi.fn().mockResolvedValue(FIXED_SIG);
    ethersState.getSigner.mockResolvedValue({ signTypedData });

    const request = vi.fn().mockResolvedValue(undefined);
    const connector = {
      getProvider: vi.fn().mockResolvedValue({ request }),
    };

    const onBeforeSign = vi.fn();
    const result = await persistEncryptedAesBackup({
      aesKey: VALID_KEY,
      address: ADDR,
      chainId: CHAIN_ID,
      connector: connector as never,
      onBeforeSign,
    });

    expect(onBeforeSign).toHaveBeenCalledTimes(1);
    expect(encryptAesKeyBackup).toHaveBeenCalled();
    expect(signTypedData).toHaveBeenCalledTimes(2);
    expect(saveEncryptedAesBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ADDR,
        chainId: CHAIN_ID,
        backup: expect.objectContaining({ version: 2, kdf: 'hkdf-sha256' }),
      }),
    );
    expect(result).toEqual({ status: 'saved' });
  });

  it('does not save when a mock signer returns a different signature each request', async () => {
    const saveEncryptedAesBackup = vi.fn().mockResolvedValue(undefined);
    configureCotiPlugin({
      onboardingServices: {
        mode: 'custom',
        saveEncryptedAesBackup,
      },
    });

    const sigs = [FIXED_SIG, OTHER_SIG];
    let i = 0;
    ethersState.getSigner.mockResolvedValue({
      signTypedData: vi.fn().mockImplementation(async () => {
        const value = sigs[Math.min(i, sigs.length - 1)];
        i += 1;
        return value;
      }),
    });

    const connector = {
      getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }),
    };

    const result = await persistEncryptedAesBackup({
      aesKey: VALID_KEY,
      address: ADDR,
      chainId: CHAIN_ID,
      connector: connector as never,
    });

    expect(saveEncryptedAesBackup).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.code).toBe(CotiErrorCode.AES_BACKUP_WALLET_NOT_SUPPORTED);
      expect(result.message).toContain(CotiErrorCode.AES_BACKUP_WALLET_NOT_SUPPORTED);
    }
  });

  it('returns cancelled when the user rejects the determinism check signature', async () => {
    const saveEncryptedAesBackup = vi.fn().mockResolvedValue(undefined);
    configureCotiPlugin({
      onboardingServices: {
        mode: 'custom',
        saveEncryptedAesBackup,
      },
    });

    let i = 0;
    ethersState.getSigner.mockResolvedValue({
      signTypedData: vi.fn().mockImplementation(async () => {
        i += 1;
        if (i === 1) return FIXED_SIG;
        const rejection = Object.assign(new Error('User rejected the request'), { code: 4001 });
        throw rejection;
      }),
    });

    const connector = {
      getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }),
    };

    const result = await persistEncryptedAesBackup({
      aesKey: VALID_KEY,
      address: ADDR,
      chainId: CHAIN_ID,
      connector: connector as never,
    });

    expect(saveEncryptedAesBackup).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'cancelled',
      code: CotiErrorCode.USER_REJECTED,
    });
  });

  it('skips the second signature only when unsafeSkipBackupDeterminismCheck is true', async () => {
    const saveEncryptedAesBackup = vi.fn().mockResolvedValue(undefined);
    configureCotiPlugin({
      unsafeSkipBackupDeterminismCheck: true,
      onboardingServices: {
        mode: 'custom',
        saveEncryptedAesBackup,
      },
    });

    const signTypedData = vi.fn().mockResolvedValue(FIXED_SIG);
    ethersState.getSigner.mockResolvedValue({ signTypedData });

    const connector = {
      getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }),
    };

    const result = await persistEncryptedAesBackup({
      aesKey: VALID_KEY,
      address: ADDR,
      chainId: CHAIN_ID,
      connector: connector as never,
    });

    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(saveEncryptedAesBackup).toHaveBeenCalled();
    expect(result).toEqual({ status: 'saved' });
  });

  it('returns AES_BACKUP_STORAGE_FAILED when the storage service rejects', async () => {
    const saveEncryptedAesBackup = vi.fn().mockRejectedValue(new Error('quota exceeded'));
    configureCotiPlugin({
      onboardingServices: {
        mode: 'custom',
        saveEncryptedAesBackup,
      },
    });

    ethersState.getSigner.mockResolvedValue(makeSigner());
    const connector = {
      getProvider: vi.fn().mockResolvedValue({ request: vi.fn() }),
    };

    const result = await persistEncryptedAesBackup({
      aesKey: VALID_KEY,
      address: ADDR,
      chainId: CHAIN_ID,
      connector: connector as never,
    });

    expect(result).toEqual({
      status: 'failed',
      code: CotiErrorCode.AES_BACKUP_STORAGE_FAILED,
      message: 'quota exceeded',
    });
  });

  it('replaces an existing backup when one is already stored', async () => {
    const backup = await encryptAesKeyBackup(VALID_KEY, makeSigner(), {
      address: ADDR,
      chainId: CHAIN_ID,
    });
    const replaceEncryptedAesBackup = vi.fn().mockResolvedValue(undefined);
    const fetchEncryptedAesBackup = vi.fn().mockResolvedValue(backup);
    configureCotiPlugin({
      onboardingServices: {
        mode: 'custom',
        fetchEncryptedAesBackup,
        replaceEncryptedAesBackup,
      },
    });

    const request = vi.fn().mockResolvedValue(undefined);
    const connector = {
      getProvider: vi.fn().mockResolvedValue({ request }),
    };

    const result = await persistEncryptedAesBackup({
      aesKey: VALID_KEY,
      address: ADDR,
      chainId: CHAIN_ID,
      connector: connector as never,
    });

    expect(replaceEncryptedAesBackup).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'saved' });
  });

  it('prefers replace without probing when requested', async () => {
    const replaceEncryptedAesBackup = vi.fn().mockResolvedValue(undefined);
    const fetchEncryptedAesBackup = vi.fn().mockResolvedValue(null);
    configureCotiPlugin({
      onboardingServices: {
        mode: 'custom',
        fetchEncryptedAesBackup,
        replaceEncryptedAesBackup,
      },
    });

    const request = vi.fn().mockResolvedValue(undefined);
    const connector = {
      getProvider: vi.fn().mockResolvedValue({ request }),
    };

    const result = await persistEncryptedAesBackup({
      aesKey: VALID_KEY,
      address: ADDR,
      chainId: CHAIN_ID,
      connector: connector as never,
      preferReplace: true,
    });

    expect(fetchEncryptedAesBackup).not.toHaveBeenCalled();
    expect(replaceEncryptedAesBackup).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'saved' });
  });

  it('returns cancelled when the wallet rejects the first signature', async () => {
    vi.mocked(encryptAesKeyBackup).mockRejectedValueOnce({ code: 4001 });
    configureCotiPlugin({
      onboardingServices: {
        mode: 'custom',
        saveEncryptedAesBackup: vi.fn(),
      },
    });

    const request = vi.fn().mockResolvedValue(undefined);
    const connector = {
      getProvider: vi.fn().mockResolvedValue({ request }),
    };

    const result = await persistEncryptedAesBackup({
      aesKey: VALID_KEY,
      address: ADDR,
      chainId: CHAIN_ID,
      connector: connector as never,
    });

    expect(result).toEqual({
      status: 'cancelled',
      code: CotiErrorCode.USER_REJECTED,
    });
  });
});
