import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureCotiPlugin } from '../../src/config/plugin';
import { encryptAesKeyBackup } from '../../src/crypto/aesKeyBackupVault';

const VALID_KEY = 'a'.repeat(32);
const ADDR = '0x1234567890123456789012345678901234567890';
const CHAIN_ID = 7082400;

const ethersState = vi.hoisted(() => ({
  getSigner: vi.fn(),
}));

function makeSigner() {
  return {
    signTypedData: vi.fn().mockResolvedValue('0x' + 'ab'.repeat(65)),
  };
}

vi.mock('@coti-io/coti-ethers', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  class BrowserProvider {
    constructor(_provider: unknown) {}
    getSigner = ethersState.getSigner;
  }
  class JsonRpcSigner {
    signTypedData = vi.fn().mockResolvedValue('0x' + 'ab'.repeat(65));
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

  it('encrypts and saves a new backup', async () => {
    const saveEncryptedAesBackup = vi.fn().mockResolvedValue(undefined);
    const fetchEncryptedAesBackup = vi.fn().mockResolvedValue(null);
    configureCotiPlugin({
      onboardingServices: {
        mode: 'custom',
        fetchEncryptedAesBackup,
        saveEncryptedAesBackup,
      },
    });

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
    expect(saveEncryptedAesBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ADDR,
        chainId: CHAIN_ID,
        backup: expect.objectContaining({ version: 1 }),
      }),
    );
    expect(result).toEqual({ status: 'saved' });
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

  it('returns cancelled when the wallet rejects the signature', async () => {
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

    expect(result).toEqual({ status: 'cancelled' });
  });
});
