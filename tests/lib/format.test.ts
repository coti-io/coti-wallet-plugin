import { describe, it, expect } from 'vitest';
import { truncateAddress } from '../../src/lib/format';

describe('Address Formatting (README: Utilities)', () => {
  const fullAddress = '0x1234567890abcdef1234567890abcdef12345678';

  describe('truncateAddress', () => {
    it('truncates with default length (10)', () => {
      const result = truncateAddress(fullAddress);
      expect(result).toBe('0x123...45678');
    });

    it('truncates with custom length', () => {
      const result = truncateAddress(fullAddress, 8);
      expect(result).toBe('0x12...5678');
    });

    it('returns full address if shorter than length', () => {
      expect(truncateAddress('0x1234', 10)).toBe('0x1234');
    });

    it('returns empty string for empty input', () => {
      expect(truncateAddress('')).toBe('');
    });

    it('handles null/undefined gracefully', () => {
      expect(truncateAddress(undefined as any)).toBe(undefined);
    });
  });
});
