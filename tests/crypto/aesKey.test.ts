import { describe, it, expect } from 'vitest';
import { normalizeAesKey, validateAesKey } from '../../src/crypto/aesKey';

describe('AES Key Management (README: AES Key Management)', () => {
  describe('normalizeAesKey', () => {
    it('strips 0x prefix', () => {
      const key = '0x' + 'a'.repeat(32);
      expect(normalizeAesKey(key)).toBe('a'.repeat(32));
    });

    it('converts to lowercase', () => {
      const key = 'A'.repeat(32);
      expect(normalizeAesKey(key)).toBe('a'.repeat(32));
    });

    it('accepts 32-char (128-bit) keys', () => {
      const key = 'abcdef1234567890abcdef1234567890';
      expect(normalizeAesKey(key)).toBe(key);
    });

    it('accepts 64-char (256-bit) keys', () => {
      const key = 'a'.repeat(64);
      expect(normalizeAesKey(key)).toBe(key);
    });

    it('throws for non-hex characters', () => {
      expect(() => normalizeAesKey('g'.repeat(32))).toThrow('non-hexadecimal');
    });

    it('throws for wrong length (16 chars)', () => {
      expect(() => normalizeAesKey('a'.repeat(16))).toThrow('expected 32 or 64');
    });

    it('throws for wrong length (48 chars)', () => {
      expect(() => normalizeAesKey('a'.repeat(48))).toThrow('expected 32 or 64');
    });

    it('handles 0x prefix with 64-char key', () => {
      const key = '0x' + 'b'.repeat(64);
      expect(normalizeAesKey(key)).toBe('b'.repeat(64));
    });

    it('throws for empty string', () => {
      expect(() => normalizeAesKey('')).toThrow();
    });

    it('throws for special characters', () => {
      expect(() => normalizeAesKey('!@#$%^&*()_+'.padEnd(32, '0'))).toThrow('non-hexadecimal');
    });
  });

  describe('validateAesKey', () => {
    it('returns normalized key for valid input', () => {
      const key = '0x' + 'A'.repeat(32);
      expect(validateAesKey(key)).toBe('a'.repeat(32));
    });

    it('throws for null', () => {
      expect(() => validateAesKey(null)).toThrow('AES key is required');
    });

    it('throws for undefined', () => {
      expect(() => validateAesKey(undefined)).toThrow('AES key is required');
    });

    it('throws for empty string', () => {
      expect(() => validateAesKey('')).toThrow('AES key is required');
    });

    it('validates and normalizes a 64-char key', () => {
      const key = 'F'.repeat(64);
      expect(validateAesKey(key)).toBe('f'.repeat(64));
    });
  });
});
