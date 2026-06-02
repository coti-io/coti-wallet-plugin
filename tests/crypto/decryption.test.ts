import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  decryptCtUint64,
  decryptCtUint256,
  decryptBalance,
  formatDecryptedBalance,
  isInsaneDecryptedValue,
} from '../../src/crypto/decryption';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';

describe('Balance Decryption (README: Balance Decryption)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: decryptUint returns 100n (a small, sane value)
    vi.mocked(CotiSDK.decryptUint).mockReturnValue(100n);
    vi.mocked(CotiSDK.decryptUint256).mockReturnValue(1000000000000000000n);
  });

  describe('decryptCtUint64', () => {
    const validKey = 'a'.repeat(32);

    it('returns 0n for zero ciphertext', () => {
      expect(decryptCtUint64(0n, validKey)).toBe(0n);
    });

    it('returns 0n for numeric zero ciphertext', () => {
      // Tests the isZeroValue number branch
      expect(decryptCtUint64(0 as any, validKey)).toBe(0n);
    });

    it('returns 0n for string "0" ciphertext', () => {
      // Tests the isZeroValue string branch
      expect(decryptCtUint64('0' as any, validKey)).toBe(0n);
    });

    it('decrypts a valid 64-bit ciphertext', () => {
      const result = decryptCtUint64(12345n, validKey);
      expect(result).toBe(100n);
    });

    it('returns null for insane decrypted values (key mismatch)', () => {
      vi.mocked(CotiSDK.decryptUint).mockReturnValueOnce(10n ** 31n); // Exceeds threshold
      const result = decryptCtUint64(12345n, validKey);
      expect(result).toBeNull();
    });

    it('returns null for invalid AES key', () => {
      const result = decryptCtUint64(12345n, 'invalid');
      expect(result).toBeNull();
    });

    it('returns null when decryptUint throws', () => {
      vi.mocked(CotiSDK.decryptUint).mockImplementationOnce(() => { throw new Error('decrypt failed'); });
      const result = decryptCtUint64(12345n, validKey);
      expect(result).toBeNull();
    });

    it('respects custom decimals for threshold', () => {
      const result = decryptCtUint64(12345n, validKey, { decimals: 6 });
      expect(result).toBe(100n);
    });

    it('respects custom insaneThresholdBase', () => {
      vi.mocked(CotiSDK.decryptUint).mockReturnValueOnce(10n ** 20n);
      const result = decryptCtUint64(12345n, validKey, { insaneThresholdBase: 10n });
      expect(result).toBeNull();
    });

    it('handles non-bigint return from decryptUint (number coercion)', () => {
      vi.mocked(CotiSDK.decryptUint).mockReturnValueOnce(42 as any);
      const result = decryptCtUint64(12345n, validKey);
      expect(result).toBe(42n);
    });
  });

  describe('decryptCtUint256', () => {
    const validKey = 'a'.repeat(32);

    it('returns 0n for all-zero nested ciphertext', () => {
      const ct = { high: { high: 0n, low: 0n }, low: { high: 0n, low: 0n } };
      expect(decryptCtUint256(ct, validKey)).toBe(0n);
    });

    it('returns 0n for all-zero flat ciphertext', () => {
      const ct = { ciphertextHigh: 0n, ciphertextLow: 0n };
      expect(decryptCtUint256(ct, validKey)).toBe(0n);
    });

    it('decrypts nested format (4 segments) with small values', () => {
      // Make decryptUint return 0n for all segments except the last
      vi.mocked(CotiSDK.decryptUint)
        .mockReturnValueOnce(0n)  // high.high
        .mockReturnValueOnce(0n)  // high.low
        .mockReturnValueOnce(0n)  // low.high
        .mockReturnValueOnce(5n); // low.low → total = 5n (sane)
      const ct = { high: { high: 1n, low: 2n }, low: { high: 3n, low: 4n } };
      const result = decryptCtUint256(ct, validKey);
      expect(result).toBe(5n);
    });

    it('decrypts flat format (2 segments)', () => {
      const ct = { ciphertextHigh: 1n, ciphertextLow: 2n };
      const result = decryptCtUint256(ct, validKey);
      // decryptUint256 mock returns 1000000000000000000n (1e18) which is sane
      expect(result).toBe(1000000000000000000n);
    });

    it('returns null for invalid AES key', () => {
      const ct = { ciphertextHigh: 1n, ciphertextLow: 2n };
      const result = decryptCtUint256(ct, 'invalid');
      expect(result).toBeNull();
    });

    it('returns null when decrypted value exceeds insane threshold', () => {
      vi.mocked(CotiSDK.decryptUint256).mockReturnValueOnce(10n ** 31n);
      const ct = { ciphertextHigh: 1n, ciphertextLow: 2n };
      const result = decryptCtUint256(ct, validKey);
      expect(result).toBeNull();
    });
  });

  describe('decryptBalance (unified entry point)', () => {
    const validKey = 'a'.repeat(32);

    it('auto-detects 64-bit variant for bigint input', () => {
      const result = decryptBalance(12345n, validKey);
      expect(result).toBe(100n);
    });

    it('auto-detects 256-bit variant for object input', () => {
      const ct = { ciphertextHigh: 1n, ciphertextLow: 2n };
      const result = decryptBalance(ct, validKey);
      expect(result).not.toBeNull();
    });

    it('respects explicit variant override', () => {
      const result = decryptBalance(12345n, validKey, 64);
      expect(result).toBe(100n);
    });
  });

  describe('isInsaneDecryptedValue (sanity guard)', () => {
    it('returns false for reasonable values', () => {
      expect(isInsaneDecryptedValue(1000000000000000000n, 18)).toBe(false);
    });

    it('returns true for astronomically large values', () => {
      expect(isInsaneDecryptedValue(10n ** 40n, 18)).toBe(true);
    });

    it('uses default decimals (18) when not specified', () => {
      expect(isInsaneDecryptedValue(10n ** 31n)).toBe(true);
    });

    it('adjusts threshold based on decimals', () => {
      // For 6 decimals, threshold = 1e12 * 10^6 = 1e18
      expect(isInsaneDecryptedValue(10n ** 19n, 6)).toBe(true);
      expect(isInsaneDecryptedValue(10n ** 17n, 6)).toBe(false);
    });

    it('returns false for zero', () => {
      expect(isInsaneDecryptedValue(0n, 18)).toBe(false);
    });

    it('handles null/undefined decimals (defaults to 18)', () => {
      expect(isInsaneDecryptedValue(100n, undefined)).toBe(false);
      expect(isInsaneDecryptedValue(100n, null as any)).toBe(false);
    });

    it('handles Infinity decimals (defaults to 18)', () => {
      expect(isInsaneDecryptedValue(100n, Infinity)).toBe(false);
    });

    it('clamps negative decimals to 0', () => {
      // threshold = 1e12 * 10^0 = 1e12
      expect(isInsaneDecryptedValue(10n ** 13n, -5)).toBe(true);
      expect(isInsaneDecryptedValue(10n ** 11n, -5)).toBe(false);
    });

    it('clamps decimals > 36 to 36', () => {
      // threshold = 1e12 * 10^36 = 1e48
      expect(isInsaneDecryptedValue(10n ** 49n, 100)).toBe(true);
    });
  });

  describe('formatDecryptedBalance', () => {
    it('formats zero as "0"', () => {
      expect(formatDecryptedBalance(0n, 18)).toBe('0');
    });

    it('formats 1 ETH (1e18) with 18 decimals', () => {
      expect(formatDecryptedBalance(1000000000000000000n, 18)).toBe('1');
    });

    it('formats 1.5 ETH with 18 decimals', () => {
      expect(formatDecryptedBalance(1500000000000000000n, 18)).toBe('1.5');
    });

    it('formats with 6 decimals (USDT-like)', () => {
      expect(formatDecryptedBalance(1500000n, 6)).toBe('1.5');
    });

    it('removes trailing zeros', () => {
      expect(formatDecryptedBalance(1100000000000000000n, 18)).toBe('1.1');
    });

    it('handles 0 decimals', () => {
      expect(formatDecryptedBalance(42n, 0)).toBe('42');
    });

    it('handles large integer part', () => {
      expect(formatDecryptedBalance(123000000000000000000n, 18)).toBe('123');
    });
  });
});
