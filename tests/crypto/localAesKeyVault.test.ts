import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ethers } from 'ethers';
import {
  hasCachedAesKey,
  saveAesKeyLocally,
  unlockCachedAesKey,
  clearCachedAesKey,
} from '../../src/crypto/localAesKeyVault';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const VALID_KEY = 'a'.repeat(32);
const reqMock = window.ethereum!.request as unknown as ReturnType<typeof import('vitest').vi.fn>;
const vaultKey = (address: string) => `pod:aes-key:${address.toLowerCase()}`;

const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

// Replicates the vault's internal key derivation so a test can craft a record
// whose decrypted payload contains no "-" separator.
const deriveKeyForTest = async (signature: string): Promise<CryptoKey> => {
  const signatureHash = ethers.keccak256(ethers.toUtf8Bytes(signature));
  const keyBytes = ethers.getBytes(signatureHash);
  const rawKey = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength,
  ) as ArrayBuffer;
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
};

describe('localAesKeyVault', () => {
  beforeEach(() => {
    localStorage.clear();
    reqMock.mockReset();
    // personal_sign returns a deterministic signature so the derived key is stable.
    reqMock.mockResolvedValue('0x' + 'ab'.repeat(65));
  });

  describe('saveAesKeyLocally validation', () => {
    it('rejects an empty key', async () => {
      await expect(saveAesKeyLocally(ADDRESS, '   ')).rejects.toThrow('AES key is required');
    });

    it('rejects a 0x-prefixed key', async () => {
      await expect(saveAesKeyLocally(ADDRESS, '0x' + 'a'.repeat(32))).rejects.toThrow(
        'without a 0x prefix'
      );
    });

    it('rejects a key that is not 32 hex characters', async () => {
      await expect(saveAesKeyLocally(ADDRESS, 'zz')).rejects.toThrow('32 hexadecimal');
    });
  });

  describe('hasCachedAesKey / clearCachedAesKey', () => {
    it('is false before anything is saved', () => {
      expect(hasCachedAesKey(ADDRESS)).toBe(false);
    });

    it('is true after saving and false after clearing', async () => {
      await saveAesKeyLocally(ADDRESS, VALID_KEY);
      expect(hasCachedAesKey(ADDRESS)).toBe(true);
      clearCachedAesKey(ADDRESS);
      expect(hasCachedAesKey(ADDRESS)).toBe(false);
    });

    it('treats addresses case-insensitively', async () => {
      await saveAesKeyLocally(ADDRESS.toLowerCase(), VALID_KEY);
      expect(hasCachedAesKey(ADDRESS.toUpperCase())).toBe(true);
    });
  });

  describe('save -> unlock round-trip', () => {
    it('recovers the original normalized key', async () => {
      await saveAesKeyLocally(ADDRESS, VALID_KEY);
      expect(await unlockCachedAesKey(ADDRESS)).toBe(VALID_KEY);
    });

    it('normalizes uppercase hex to lowercase', async () => {
      await saveAesKeyLocally(ADDRESS, 'A'.repeat(32));
      expect(await unlockCachedAesKey(ADDRESS)).toBe('a'.repeat(32));
    });

    it('returns null when no record is cached', async () => {
      expect(await unlockCachedAesKey(ADDRESS)).toBeNull();
    });
  });

  describe('readCachedRecord robustness', () => {
    it('ignores malformed JSON', () => {
      localStorage.setItem(vaultKey(ADDRESS), '{bad');
      expect(hasCachedAesKey(ADDRESS)).toBe(false);
    });

    it('ignores a record whose address does not match', () => {
      localStorage.setItem(
        vaultKey(ADDRESS),
        JSON.stringify({
          version: 1,
          address: '0x2222222222222222222222222222222222222222',
          iv: 'aa',
          ciphertext: 'bb',
        })
      );
      expect(hasCachedAesKey(ADDRESS)).toBe(false);
    });

    it('ignores a record with an unexpected version', () => {
      localStorage.setItem(
        vaultKey(ADDRESS),
        JSON.stringify({ version: 2, address: ADDRESS.toLowerCase(), iv: 'aa', ciphertext: 'bb' })
      );
      expect(hasCachedAesKey(ADDRESS)).toBe(false);
    });

    it('ignores parsed JSON that is not an object (null)', () => {
      // JSON.parse('null') -> null, exercising the `!value` guard in isStoredAesKeyRecord.
      localStorage.setItem(vaultKey(ADDRESS), 'null');
      expect(hasCachedAesKey(ADDRESS)).toBe(false);
    });

    it('ignores parsed JSON that is a primitive (number)', () => {
      // typeof value !== "object" branch of isStoredAesKeyRecord.
      localStorage.setItem(vaultKey(ADDRESS), '123');
      expect(hasCachedAesKey(ADDRESS)).toBe(false);
    });

    it('returns null when window is undefined (SSR guard)', () => {
      vi.stubGlobal('window', undefined);
      try {
        expect(hasCachedAesKey(ADDRESS)).toBe(false);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('signature requirements', () => {
    it('throws when window.ethereum is unavailable', async () => {
      const original = window.ethereum;
      (window as unknown as { ethereum?: unknown }).ethereum = undefined;
      try {
        await expect(saveAesKeyLocally(ADDRESS, VALID_KEY)).rejects.toThrow(
          'MetaMask is required',
        );
      } finally {
        (window as unknown as { ethereum?: unknown }).ethereum = original;
      }
    });
  });

  describe('unlock payload without a separator', () => {
    it('returns the full decoded payload when no "-" is present', async () => {
      const signature = '0x' + 'cd'.repeat(65);
      reqMock.mockResolvedValue(signature);

      const key = await deriveKeyForTest(signature);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const payload = new TextEncoder().encode('payloadwithoutdash');
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload),
      );

      localStorage.setItem(
        vaultKey(ADDRESS),
        JSON.stringify({
          version: 1,
          address: ADDRESS.toLowerCase(),
          iv: bytesToBase64(iv),
          ciphertext: bytesToBase64(ciphertext),
        }),
      );

      expect(await unlockCachedAesKey(ADDRESS)).toBe('payloadwithoutdash');
    });
  });
});
