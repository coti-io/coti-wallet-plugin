import { describe, expect, it, vi } from 'vitest';
import {
  decryptAesKeyBackup,
  encryptAesKeyBackup,
  type AesBackupSigner,
} from '../../src/crypto/aesKeyBackupVault';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const CHAIN_ID = 7082400;

function signer(signature = '0xabc'): AesBackupSigner {
  return {
    signTypedData: vi.fn().mockResolvedValue(signature),
  };
}

describe('aesKeyBackupVault', () => {
  it('encrypts and decrypts a 32-char AES key', async () => {
    const aesKey = 'a'.repeat(32);
    const backupSigner = signer();
    const backup = await encryptAesKeyBackup(aesKey, backupSigner, {
      address: ADDRESS,
      chainId: CHAIN_ID,
    });

    await expect(
      decryptAesKeyBackup(backup, backupSigner, {
        address: ADDRESS,
        chainId: CHAIN_ID,
      }),
    ).resolves.toBe(aesKey);
  });

  it('encrypts and decrypts a 64-char AES key', async () => {
    const aesKey = 'b'.repeat(64);
    const backupSigner = signer();
    const backup = await encryptAesKeyBackup(aesKey, backupSigner, {
      address: ADDRESS,
      chainId: CHAIN_ID,
    });

    await expect(
      decryptAesKeyBackup(backup, backupSigner, {
        address: ADDRESS,
        chainId: CHAIN_ID,
      }),
    ).resolves.toBe(aesKey);
  });

  it('rejects backups for a different address', async () => {
    const backup = await encryptAesKeyBackup('c'.repeat(32), signer(), {
      address: ADDRESS,
      chainId: CHAIN_ID,
    });

    await expect(
      decryptAesKeyBackup(backup, signer(), {
        address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        chainId: CHAIN_ID,
      }),
    ).rejects.toThrow('address does not match');
  });

  it('rejects backups for a different COTI network', async () => {
    const backup = await encryptAesKeyBackup('d'.repeat(32), signer(), {
      address: ADDRESS,
      chainId: CHAIN_ID,
    });

    await expect(
      decryptAesKeyBackup(backup, signer(), {
        address: ADDRESS,
        chainId: 2632500,
      }),
    ).rejects.toThrow('network does not match');
  });
});

