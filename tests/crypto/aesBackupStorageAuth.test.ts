import { describe, expect, it, vi } from 'vitest';
import {
  AES_BACKUP_STORAGE_AUTH_DOMAIN_NAME,
  AES_BACKUP_STORAGE_AUTH_DOMAIN_VERSION,
  assertAesBackupStorageAuthChallengeFresh,
  buildAesBackupStorageAuthTypedData,
  signAesBackupStorageAuthChallenge,
  type AesBackupStorageAuthChallenge,
} from '../../src/crypto/aesBackupStorageAuth';
import { CotiErrorCode, isCotiPluginError } from '../../src/errors';

const BASE_CHALLENGE: AesBackupStorageAuthChallenge = {
  nonce: '0x' + '11'.repeat(16),
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_000_120,
  audience: 'https://backups.example.com',
  address: '0x1234567890abcdef1234567890abcdef12345678',
  chainId: 7082400,
  method: 'GET',
  resource: '/v1/aes-backups/7082400/0x1234567890abcdef1234567890abcdef12345678',
  operation: 'fetch',
};

describe('aesBackupStorageAuth', () => {
  it('builds typed data with a domain distinct from AES backup wrap', () => {
    const { domain, types, message } = buildAesBackupStorageAuthTypedData(BASE_CHALLENGE);

    expect(domain.name).toBe(AES_BACKUP_STORAGE_AUTH_DOMAIN_NAME);
    expect(domain.version).toBe(AES_BACKUP_STORAGE_AUTH_DOMAIN_VERSION);
    expect(domain.name).not.toBe('COTI AES Backup');
    expect(types.AesBackupStorageAuth).toEqual(expect.any(Array));
    expect(message.operation).toBe('fetch');
    expect(message.method).toBe('GET');
    expect(String(message.purpose)).toContain('NOT the COTI privacy key backup unlock');
  });

  it('signs a fresh challenge', async () => {
    const signer = {
      signTypedData: vi.fn().mockResolvedValue('0x' + 'ab'.repeat(65)),
    };

    await expect(
      signAesBackupStorageAuthChallenge(signer, BASE_CHALLENGE, BASE_CHALLENGE.issuedAt + 1),
    ).resolves.toMatch(/^0x/);
    expect(signer.signTypedData).toHaveBeenCalledTimes(1);
  });

  it('rejects expired challenges', () => {
    try {
      assertAesBackupStorageAuthChallengeFresh(BASE_CHALLENGE, BASE_CHALLENGE.expiresAt + 60);
      expect.unreachable('expected expired challenge to throw');
    } catch (error) {
      expect(isCotiPluginError(error)).toBe(true);
      if (isCotiPluginError(error)) {
        expect(error.code).toBe(CotiErrorCode.VALIDATION_ERROR);
        expect(error.message).toContain('expired');
      }
    }
  });

  it('requires authorization fields for every storage operation shape', () => {
    for (const operation of ['fetch', 'save', 'replace', 'delete'] as const) {
      const { message } = buildAesBackupStorageAuthTypedData({
        ...BASE_CHALLENGE,
        operation,
        method: operation === 'delete' ? 'DELETE' : operation === 'fetch' ? 'GET' : 'PUT',
      });
      expect(message.operation).toBe(operation);
    }
  });
});
