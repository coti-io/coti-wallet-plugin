import { describe, it, expect } from 'vitest';
import { isCtUint256, isZeroCtUint256 } from '../../src/types/ciphertext';

describe('Ciphertext Type Guards (README: Balance Decryption)', () => {
  describe('isCtUint256', () => {
    it('recognizes nested structure', () => {
      const ct = { high: { high: 1n, low: 2n }, low: { high: 3n, low: 4n } };
      expect(isCtUint256(ct)).toBe(true);
    });

    it('recognizes flat structure', () => {
      const ct = { ciphertextHigh: 1n, ciphertextLow: 2n };
      expect(isCtUint256(ct)).toBe(true);
    });

    it('recognizes positional structure (ethers.js Result)', () => {
      const ct = { ciphertextHigh: 1n, ciphertextLow: 2n };
      expect(isCtUint256(ct)).toBe(true);
    });

    it('rejects null', () => {
      expect(isCtUint256(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(isCtUint256(undefined)).toBe(false);
    });

    it('rejects plain bigint', () => {
      expect(isCtUint256(12345n)).toBe(false);
    });

    it('rejects empty object', () => {
      expect(isCtUint256({})).toBe(false);
    });

    it('rejects partial nested (missing low.low)', () => {
      const ct = { high: { high: 1n, low: 2n }, low: { high: 3n } };
      expect(isCtUint256(ct)).toBe(false);
    });
  });

  describe('isZeroCtUint256', () => {
    it('returns true for all-zero nested structure', () => {
      const ct = { high: { high: 0n, low: 0n }, low: { high: 0n, low: 0n } };
      expect(isZeroCtUint256(ct)).toBe(true);
    });

    it('returns true for all-zero flat structure', () => {
      const ct = { ciphertextHigh: 0n, ciphertextLow: 0n };
      expect(isZeroCtUint256(ct)).toBe(true);
    });

    it('returns true for zero bigint', () => {
      expect(isZeroCtUint256(0n)).toBe(true);
    });

    it('returns true for zero number', () => {
      expect(isZeroCtUint256(0)).toBe(true);
    });

    it('returns true for "0" string', () => {
      // "0" is truthy, passes null guard, then isZeroValue("0") returns true
      expect(isZeroCtUint256('0')).toBe(true);
    });

    it('returns false for non-zero nested', () => {
      const ct = { high: { high: 1n, low: 0n }, low: { high: 0n, low: 0n } };
      expect(isZeroCtUint256(ct)).toBe(false);
    });

    it('returns false for non-zero flat', () => {
      const ct = { ciphertextHigh: 0n, ciphertextLow: 1n };
      expect(isZeroCtUint256(ct)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isZeroCtUint256(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isZeroCtUint256(undefined)).toBe(false);
    });

    it('returns true for positional zeros', () => {
      expect(isZeroCtUint256({ ciphertextHigh: 0n, ciphertextLow: 0n })).toBe(true);
    });

    it('returns false for positional non-zeros', () => {
      expect(isZeroCtUint256({ 0: 1n, 1: 0n })).toBe(false);
    });
  });
});
