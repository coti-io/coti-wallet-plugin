import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
import { CotiPluginError, CotiErrorCode } from '../../src/errors';

const ROUND_TRIP_TEST_VALUE = 0x0123456789abcdefn;

describe('aesKeyValidation', () => {
  let validateAesKeyRoundTrip: (aesKey: string) => boolean;
  let aesKeysEquivalent: (a: string, b: string) => boolean;
  let assertMetaMaskActiveAccount: (
    provider: { request: (args: { method: string }) => Promise<unknown> },
    expectedAddress: string,
  ) => Promise<void>;

  beforeAll(async () => {
    const mod = await import('../../src/crypto/aesKeyValidation');
    validateAesKeyRoundTrip = mod.validateAesKeyRoundTrip;
    aesKeysEquivalent = mod.aesKeysEquivalent;
    assertMetaMaskActiveAccount = mod.assertMetaMaskActiveAccount;
  });

  beforeEach(() => {
    vi.mocked(CotiSDK.encodeKey).mockImplementation((key: string) => new Uint8Array(16));
    vi.mocked(CotiSDK.encodeUint).mockImplementation(() => new Uint8Array(16));
    vi.mocked(CotiSDK.encrypt).mockReturnValue({
      ciphertext: new Uint8Array(16),
      r: new Uint8Array(16),
    });
    vi.mocked(CotiSDK.decodeUint).mockReturnValue(999n);
    vi.mocked(CotiSDK.decryptUint).mockReturnValue(ROUND_TRIP_TEST_VALUE);
  });

  describe('validateAesKeyRoundTrip', () => {
    it('returns true when SDK round-trip matches the test plaintext', () => {
      const key = '0123456789abcdef0123456789abcdef';
      expect(validateAesKeyRoundTrip(key)).toBe(true);
    });

    it('returns true for a 64-char key using 128-bit SDK material', () => {
      const key32 = '0123456789abcdef0123456789abcdef';
      expect(validateAesKeyRoundTrip(key32 + key32)).toBe(true);
    });

    it('returns false when decrypt output does not match', () => {
      vi.mocked(CotiSDK.decryptUint).mockReturnValue(0n);
      expect(validateAesKeyRoundTrip('0123456789abcdef0123456789abcdef')).toBe(false);
    });

    it('returns false for invalid hex', () => {
      expect(validateAesKeyRoundTrip('not-a-valid-key')).toBe(false);
    });
  });

  describe('aesKeysEquivalent', () => {
    it('matches identical keys', () => {
      const key = 'a'.repeat(32);
      expect(aesKeysEquivalent(key, key)).toBe(true);
    });

    it('matches 64-char key with its 32-char prefix', () => {
      const short = 'a'.repeat(32);
      const long = short + 'b'.repeat(32);
      expect(aesKeysEquivalent(long, short)).toBe(true);
      expect(aesKeysEquivalent(short, long)).toBe(true);
    });

    it('returns false for different keys', () => {
      expect(aesKeysEquivalent('a'.repeat(32), 'b'.repeat(32))).toBe(false);
    });
  });

  describe('assertMetaMaskActiveAccount', () => {
    it('passes when active account matches', async () => {
      const provider = {
        request: vi.fn().mockResolvedValue(['0xAbC']),
      };
      await expect(
        assertMetaMaskActiveAccount(provider, '0xabc'),
      ).resolves.toBeUndefined();
    });

    it('throws AES_KEY_MISMATCH when accounts differ', async () => {
      const provider = {
        request: vi.fn().mockResolvedValue(['0xother']),
      };
      await expect(
        assertMetaMaskActiveAccount(provider, '0xabc'),
      ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
    });
  });

  describe('unlock validation registry', () => {
    let markAesKeyValidatedForUnlock: (address: string, aesKey: string) => void;
    let clearAesKeyValidatedForUnlock: (address?: string) => void;
    let isAesKeyValidatedForUnlock: (address: string, aesKey: string) => boolean;
    let getValidatedAesKeyForUnlock: (address: string) => string | null;

    beforeAll(async () => {
      const mod = await import('../../src/crypto/aesKeyValidation');
      markAesKeyValidatedForUnlock = mod.markAesKeyValidatedForUnlock;
      clearAesKeyValidatedForUnlock = mod.clearAesKeyValidatedForUnlock;
      isAesKeyValidatedForUnlock = mod.isAesKeyValidatedForUnlock;
      getValidatedAesKeyForUnlock = mod.getValidatedAesKeyForUnlock;
    });

    beforeEach(() => {
      clearAesKeyValidatedForUnlock();
    });

    it('tracks validated keys per wallet', () => {
      const key = 'a'.repeat(64);
      expect(isAesKeyValidatedForUnlock('0xAbC', key)).toBe(false);
      markAesKeyValidatedForUnlock('0xabc', key);
      expect(isAesKeyValidatedForUnlock('0xABC', key)).toBe(true);
      expect(getValidatedAesKeyForUnlock('0xABC')).toBe(key.toLowerCase().slice(0, 64));
      clearAesKeyValidatedForUnlock('0xabc');
      expect(isAesKeyValidatedForUnlock('0xabc', key)).toBe(false);
    });
  });
});
