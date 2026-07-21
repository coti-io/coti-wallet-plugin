import { describe, it, expect } from 'vitest';
import {
  isMultipleWalletsError,
  isUnsupportedRpcMethodError,
  MULTIPLE_WALLETS_ERROR_SUBSTRING,
} from '../../src/utils/walletErrors';

describe('Wallet Error Detection (README: Security)', () => {
  describe('MULTIPLE_WALLETS_ERROR_SUBSTRING', () => {
    it('is a non-empty string', () => {
      expect(MULTIPLE_WALLETS_ERROR_SUBSTRING.length).toBeGreaterThan(0);
    });

    it('contains chrome.runtime reference', () => {
      expect(MULTIPLE_WALLETS_ERROR_SUBSTRING).toContain('chrome.runtime.sendMessage');
    });
  });

  describe('isMultipleWalletsError', () => {
    it('returns true for matching error message', () => {
      const msg = `Error: ${MULTIPLE_WALLETS_ERROR_SUBSTRING} (extension "abc123")`;
      expect(isMultipleWalletsError(msg)).toBe(true);
    });

    it('returns false for unrelated error', () => {
      expect(isMultipleWalletsError('User rejected the request')).toBe(false);
    });

    it('returns false for null', () => {
      expect(isMultipleWalletsError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isMultipleWalletsError(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isMultipleWalletsError('')).toBe(false);
    });

    it('returns true when substring is embedded in longer message', () => {
      const msg = `Unhandled rejection: ${MULTIPLE_WALLETS_ERROR_SUBSTRING} blah blah`;
      expect(isMultipleWalletsError(msg)).toBe(true);
    });
  });

  describe('isUnsupportedRpcMethodError', () => {
    it('detects Zerion wallet_revokePermissions rejection object', () => {
      expect(
        isUnsupportedRpcMethodError({
          code: -32601,
          message: 'the method wallet_revokePermissions does not exist/is not available',
        }),
      ).toBe(true);
    });

    it('detects -32601 method-not-found without naming revokePermissions', () => {
      expect(
        isUnsupportedRpcMethodError({
          code: -32601,
          message: 'the method foo does not exist/is not available',
        }),
      ).toBe(true);
    });

    it('detects Error instances mentioning wallet_revokePermissions', () => {
      expect(
        isUnsupportedRpcMethodError(
          new Error('the method wallet_revokePermissions does not exist/is not available'),
        ),
      ).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isUnsupportedRpcMethodError(new Error('network failed'))).toBe(false);
      expect(isUnsupportedRpcMethodError({ code: 4001, message: 'user rejected' })).toBe(false);
    });
  });
});
