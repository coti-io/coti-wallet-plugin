import { describe, it, expect, vi } from 'vitest';

// Mock wagmi before importing
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ connector: undefined })),
  useConnectorClient: vi.fn(() => ({ data: undefined })),
}));

import { isValidAesKey } from '../../src/hooks/useAesKeyProvider';

describe('AES Key Provider (README: useAesKeyProvider)', () => {
  describe('isValidAesKey', () => {
    it('accepts 32-char hex key (128-bit)', () => {
      expect(isValidAesKey('a'.repeat(32))).toBe(true);
    });

    it('accepts 64-char hex key (256-bit)', () => {
      expect(isValidAesKey('b'.repeat(64))).toBe(true);
    });

    it('accepts uppercase hex', () => {
      expect(isValidAesKey('ABCDEF0123456789'.repeat(2))).toBe(true);
    });

    it('rejects keys with 0x prefix', () => {
      expect(isValidAesKey('0x' + 'a'.repeat(32))).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidAesKey('')).toBe(false);
    });

    it('rejects 16-char key (too short)', () => {
      expect(isValidAesKey('a'.repeat(16))).toBe(false);
    });

    it('rejects 48-char key (wrong length)', () => {
      expect(isValidAesKey('a'.repeat(48))).toBe(false);
    });

    it('rejects non-hex characters', () => {
      expect(isValidAesKey('g'.repeat(32))).toBe(false);
    });

    it('rejects keys with special characters', () => {
      expect(isValidAesKey('!@#$%^&*()_+abcdef1234567890ab')).toBe(false);
    });
  });
});
