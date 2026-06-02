import { describe, it, expect } from 'vitest';
import {
  formatTokenBalanceDisplay,
  truncateDecimalValue,
  addThousandsSeparators,
  formatBalanceWithNotation,
  expandExponentialNumber,
} from '../../src/lib/utils';

describe('Formatting Utilities (README: formatTokenBalanceDisplay)', () => {
  describe('formatTokenBalanceDisplay', () => {
    it('formats COTI with 4 decimals', () => {
      expect(formatTokenBalanceDisplay('COTI', '123.456789')).toBe('123.4567');
    });

    it('formats WETH with 6 decimals', () => {
      expect(formatTokenBalanceDisplay('WETH', '1.123456789')).toBe('1.123456');
    });

    it('formats WBTC with 6 decimals', () => {
      expect(formatTokenBalanceDisplay('p.WBTC', '0.12345678')).toBe('0.123456');
    });

    it('formats USDT with 4 decimals', () => {
      expect(formatTokenBalanceDisplay('USDT', '100.12345')).toBe('100.1234');
    });

    it('defaults to 4 decimals for unknown tokens', () => {
      expect(formatTokenBalanceDisplay('UNKNOWN', '1.123456')).toBe('1.1234');
    });

    it('handles zero balance', () => {
      expect(formatTokenBalanceDisplay('COTI', '0')).toBe('0');
    });

    it('handles integer balance (no decimals)', () => {
      expect(formatTokenBalanceDisplay('COTI', '100')).toBe('100');
    });

    it('removes trailing zeros', () => {
      expect(formatTokenBalanceDisplay('COTI', '1.1000')).toBe('1.1');
    });

    it('handles numeric input', () => {
      expect(formatTokenBalanceDisplay('COTI', 123.456789)).toBe('123.4567');
    });
  });

  describe('truncateDecimalValue', () => {
    it('truncates to specified decimals', () => {
      expect(truncateDecimalValue('1.123456789', 4)).toBe('1.1234');
    });

    it('returns integer part when decimals is 0', () => {
      expect(truncateDecimalValue('1.999', 0)).toBe('1');
    });

    it('handles values without decimal part', () => {
      expect(truncateDecimalValue('100', 4)).toBe('100');
    });

    it('removes trailing zeros after truncation', () => {
      expect(truncateDecimalValue('1.10000', 4)).toBe('1.1');
    });

    it('handles empty string', () => {
      expect(truncateDecimalValue('', 4)).toBe('0');
    });

    it('handles NaN', () => {
      expect(truncateDecimalValue('NaN', 4)).toBe('0');
    });

    it('handles exponential notation', () => {
      expect(truncateDecimalValue('1e-7', 8)).toBe('0.0000001');
    });
  });

  describe('expandExponentialNumber', () => {
    it('expands positive exponent', () => {
      expect(expandExponentialNumber('1.5e3')).toBe('1500.');
    });

    it('expands negative exponent', () => {
      expect(expandExponentialNumber('1.5e-3')).toBe('0.0015');
    });

    it('returns unchanged for non-exponential', () => {
      expect(expandExponentialNumber('123.456')).toBe('123.456');
    });

    it('handles zero exponent', () => {
      expect(expandExponentialNumber('1.5e0')).toBe('1.5');
    });
  });

  describe('addThousandsSeparators', () => {
    it('adds commas to large integers', () => {
      expect(addThousandsSeparators('1000000')).toBe('1,000,000');
    });

    it('preserves decimal part', () => {
      expect(addThousandsSeparators('1000000.123')).toBe('1,000,000.123');
    });

    it('does not add separator for small numbers', () => {
      expect(addThousandsSeparators('999')).toBe('999');
    });

    it('handles zero', () => {
      expect(addThousandsSeparators('0')).toBe('0');
    });
  });

  describe('formatBalanceWithNotation', () => {
    it('formats trillions with T suffix', () => {
      expect(formatBalanceWithNotation('1500000000000')).toBe('1.5T');
    });

    it('formats billions with B suffix', () => {
      expect(formatBalanceWithNotation('2500000000')).toBe('2.5B');
    });

    it('formats millions with M suffix', () => {
      expect(formatBalanceWithNotation('3500000')).toBe('3.5M');
    });

    it('adds thousand separators for values below 1M', () => {
      expect(formatBalanceWithNotation('500000')).toBe('500,000');
    });

    it('handles zero', () => {
      expect(formatBalanceWithNotation('0')).toBe('0');
    });

    it('handles decimal values with thousand separators', () => {
      expect(formatBalanceWithNotation('1234.56')).toBe('1,234.56');
    });

    it('handles negative values', () => {
      expect(formatBalanceWithNotation('-1500000000')).toBe('-1.5B');
    });
  });
});
