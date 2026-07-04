import { beforeEach, describe, expect, it } from 'vitest';
import { configureCotiPlugin, type EncryptedAesBackup } from '../../src/config/plugin';
import {
  fetchEncryptedAesBackupFromContract,
  saveEncryptedAesBackupToContract,
} from '../../src/crypto/aesKeyBackupContract';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const CHAIN_ID = 7082400;

const backup: EncryptedAesBackup = {
  version: 1,
  address: ADDRESS.toLowerCase(),
  chainId: CHAIN_ID,
  signatureKind: 'eip712',
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('aesKeyBackupContract local fallback', () => {
  beforeEach(() => {
    localStorage.clear();
    configureCotiPlugin({ aesKeyBackupVaultAddress: undefined });
  });

  it('stores and reads encrypted backups from localStorage when no vault address is configured', async () => {
    await saveEncryptedAesBackupToContract({
      address: ADDRESS,
      chainId: CHAIN_ID,
      backup,
      provider: { request: async () => '0xunused' },
    });

    await expect(fetchEncryptedAesBackupFromContract(ADDRESS, CHAIN_ID)).resolves.toEqual(backup);
  });

  it('stores a local backup before sending the vault transaction when a vault address is configured', async () => {
    configureCotiPlugin({
      aesKeyBackupVaultAddress: '0x9d56c9Beca9D9a61fFf100104864445ad78579f1',
    });

    await expect(
      saveEncryptedAesBackupToContract({
        address: ADDRESS,
        chainId: CHAIN_ID,
        backup,
        provider: { request: async () => { throw new Error('tx failed'); } },
      }),
    ).rejects.toThrow('tx failed');

    configureCotiPlugin({ aesKeyBackupVaultAddress: undefined });
    await expect(fetchEncryptedAesBackupFromContract(ADDRESS, CHAIN_ID)).resolves.toEqual(backup);
  });

  it('uses local backup first even when a vault address is configured', async () => {
    localStorage.setItem(
      `coti-wallet-plugin:aes-backup:${CHAIN_ID}:${ADDRESS.toLowerCase()}`,
      JSON.stringify(backup),
    );
    configureCotiPlugin({
      aesKeyBackupVaultAddress: '0x9d56c9Beca9D9a61fFf100104864445ad78579f1',
    });

    await expect(fetchEncryptedAesBackupFromContract(ADDRESS, CHAIN_ID)).resolves.toEqual(backup);
  });

  it('reads the previous example localStorage key for compatibility', async () => {
    localStorage.setItem(
      `coti-example:aes-backup:${CHAIN_ID}:${ADDRESS.toLowerCase()}`,
      JSON.stringify(backup),
    );

    await expect(fetchEncryptedAesBackupFromContract(ADDRESS, CHAIN_ID)).resolves.toEqual(backup);
  });

  it('rejects malformed configured vault addresses instead of silently falling back', async () => {
    configureCotiPlugin({ aesKeyBackupVaultAddress: 'not-an-address' });

    await expect(fetchEncryptedAesBackupFromContract(ADDRESS, CHAIN_ID)).rejects.toThrow(
      'Invalid AES backup vault address',
    );
  });
});
