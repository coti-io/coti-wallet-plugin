import { describe, it, expect, vi } from 'vitest';
import { ethers } from 'ethers';
import { buildItUint64, buildItUint256 } from '../../src/crypto/encryption';

describe('Encryption Utilities (README: AES Key Management)', () => {
  const validKey = 'a'.repeat(32);
  const privateKey = '0x' + 'ab'.repeat(32);
  const wallet = new ethers.Wallet(privateKey);
  const contractAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const functionSelector = '0x12345678';

  describe('buildItUint64', () => {
    it('encrypts a small value and returns ciphertext + signature', () => {
      const result = buildItUint64(100n, validKey, wallet, contractAddress, functionSelector);
      expect(result.ciphertext).toBeDefined();
      expect(result.signature).toBeDefined();
      expect(typeof result.ciphertext).toBe('string');
      expect(result.signature).toMatch(/^0x/);
    });

    it('encrypts zero value', () => {
      const result = buildItUint64(0n, validKey, wallet, contractAddress, functionSelector);
      expect(result.ciphertext).toBeDefined();
      expect(result.signature).toBeDefined();
    });

    it('throws RangeError for values >= 2^64', () => {
      expect(() =>
        buildItUint64(2n ** 64n, validKey, wallet, contractAddress, functionSelector)
      ).toThrow(RangeError);
    });

    it('throws RangeError for very large values', () => {
      expect(() =>
        buildItUint64(2n ** 65n, validKey, wallet, contractAddress, functionSelector)
      ).toThrow('Plaintext size must be 64 bits or smaller');
    });

    it('accepts max valid value (2^64 - 1)', () => {
      const maxVal = 2n ** 64n - 1n;
      const result = buildItUint64(maxVal, validKey, wallet, contractAddress, functionSelector);
      expect(result.ciphertext).toBeDefined();
    });

    it('throws for invalid AES key', () => {
      expect(() =>
        buildItUint64(100n, 'invalid', wallet, contractAddress, functionSelector)
      ).toThrow();
    });
  });

  describe('buildItUint256', () => {
    it('encrypts a 256-bit value into 4 segments', () => {
      const result = buildItUint256(12345n, validKey, wallet, contractAddress, functionSelector);
      expect(result.ciphertext).toBeDefined();
      expect(result.ciphertext.high).toBeDefined();
      expect(result.ciphertext.low).toBeDefined();
      expect(result.ciphertext.high.high).toBeDefined();
      expect(result.ciphertext.high.low).toBeDefined();
      expect(result.ciphertext.low.high).toBeDefined();
      expect(result.ciphertext.low.low).toBeDefined();
    });

    it('returns 4 signatures (2x2 matrix)', () => {
      const result = buildItUint256(12345n, validKey, wallet, contractAddress, functionSelector);
      expect(result.signature).toHaveLength(2);
      expect(result.signature[0]).toHaveLength(2);
      expect(result.signature[1]).toHaveLength(2);
    });

    it('encrypts zero value', () => {
      const result = buildItUint256(0n, validKey, wallet, contractAddress, functionSelector);
      expect(result.ciphertext).toBeDefined();
    });

    it('encrypts max uint256', () => {
      const maxUint256 = 2n ** 256n - 1n;
      const result = buildItUint256(maxUint256, validKey, wallet, contractAddress, functionSelector);
      expect(result.ciphertext).toBeDefined();
    });
  });
});
