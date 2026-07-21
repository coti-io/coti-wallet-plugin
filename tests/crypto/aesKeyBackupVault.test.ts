import { describe, expect, it, vi } from 'vitest';
import {
  backupFromChainTuple,
  decryptAesKeyBackup,
  encryptAesKeyBackup,
  OUTDATED_AES_BACKUP_ERROR,
  type AesBackupSigner,
} from '../../src/crypto/aesKeyBackupVault';
import type { EncryptedAesBackup } from '../../src/config/plugin';
import { ethers } from 'ethers';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const CHAIN_ID = 7082400;
const VALID_SIG = '0x' + 'ab'.repeat(65);
const OTHER_SIG = '0x' + 'cd'.repeat(65);

function signer(signature: string | string[] = VALID_SIG): AesBackupSigner {
  const values = Array.isArray(signature) ? signature : [signature];
  let i = 0;
  return {
    signTypedData: vi.fn().mockImplementation(async () => {
      const value = values[Math.min(i, values.length - 1)];
      i += 1;
      return value;
    }),
  };
}

describe('aesKeyBackupVault', () => {
  it('encrypts and decrypts a 32-char AES key (v2 HKDF + AAD)', async () => {
    const aesKey = 'a'.repeat(32);
    const backupSigner = signer();
    const backup = await encryptAesKeyBackup(aesKey, backupSigner, {
      address: ADDRESS,
      chainId: CHAIN_ID,
    });

    expect(backup.version).toBe(2);
    expect(backup.kdf).toBe('hkdf-sha256');
    expect(backup.signatureKind).toBe('eip712');

    await expect(
      decryptAesKeyBackup(backup, backupSigner, {
        address: ADDRESS,
        chainId: CHAIN_ID,
      }),
    ).resolves.toBe(aesKey);
  });

  it('omits chainId from the EIP-712 domain (message still binds chain)', async () => {
    const backupSigner = signer();
    await encryptAesKeyBackup('a'.repeat(32), backupSigner, {
      address: ADDRESS,
      chainId: CHAIN_ID,
    });

    expect(backupSigner.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'COTI AES Backup',
        version: '2',
      }),
      expect.any(Object),
      expect.objectContaining({
        address: ADDRESS,
        chainId: CHAIN_ID,
        version: 2,
      }),
    );
    const domain = vi.mocked(backupSigner.signTypedData).mock.calls[0][0];
    expect(domain).not.toHaveProperty('chainId');
    expect(domain).toHaveProperty('salt');
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

  it('rejects outdated v1 backups', async () => {
    const v1Backup = {
      version: 1,
      address: ADDRESS,
      chainId: CHAIN_ID,
      signatureKind: 'eip712',
      iv: btoa('0123456789ab'),
      ciphertext: btoa('not-a-real-ciphertext'),
      createdAt: new Date().toISOString(),
    } as unknown as EncryptedAesBackup;

    await expect(
      decryptAesKeyBackup(v1Backup, signer(), {
        address: ADDRESS,
        chainId: CHAIN_ID,
      }),
    ).rejects.toThrow(OUTDATED_AES_BACKUP_ERROR);
  });

  it('fails decryption when AAD-bound metadata is tampered', async () => {
    const aesKey = 'e'.repeat(32);
    const backupSigner = signer();
    const backup = await encryptAesKeyBackup(aesKey, backupSigner, {
      address: ADDRESS,
      chainId: CHAIN_ID,
    });

    // App-level address check is bypassed by forging matching context metadata on
    // the blob, but AES-GCM AAD still binds the encrypt-time address — decrypt must fail.
    const tampered: EncryptedAesBackup = {
      ...backup,
      address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    };

    await expect(
      decryptAesKeyBackup(tampered, backupSigner, {
        address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        chainId: CHAIN_ID,
      }),
    ).rejects.toThrow();
  });

  it('fails when the second signature differs (nondeterministic wallet)', async () => {
    const aesKey = 'f'.repeat(32);
    const backupSigner = signer([VALID_SIG, OTHER_SIG]);
    const backup = await encryptAesKeyBackup(aesKey, backupSigner, {
      address: ADDRESS,
      chainId: CHAIN_ID,
    });

    await expect(
      decryptAesKeyBackup(backup, backupSigner, {
        address: ADDRESS,
        chainId: CHAIN_ID,
      }),
    ).rejects.toThrow();
  });

  it('maps an on-chain getBackup tuple into EncryptedAesBackup', () => {
    const iv = ethers.randomBytes(12);
    const ciphertext = ethers.randomBytes(48);
    const backup = backupFromChainTuple({
      address: ADDRESS,
      chainId: CHAIN_ID,
      version: 2,
      iv,
      ciphertext,
      updatedAt: 1_700_000_000,
    });

    expect(backup.version).toBe(2);
    expect(backup.kdf).toBe('hkdf-sha256');
    expect(backup.address).toBe(ADDRESS.toLowerCase());
    expect(backup.chainId).toBe(CHAIN_ID);
    expect(backup.createdAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it('rejects on-chain tuples with unsupported version', () => {
    expect(() =>
      backupFromChainTuple({
        address: ADDRESS,
        chainId: CHAIN_ID,
        version: 1,
        iv: ethers.randomBytes(12),
        ciphertext: ethers.randomBytes(48),
        updatedAt: 1,
      }),
    ).toThrow(OUTDATED_AES_BACKUP_ERROR);
  });
});
