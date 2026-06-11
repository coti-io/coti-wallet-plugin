import { describe, it, expect } from 'vitest';
import {
  CotiErrorCode,
  CotiPluginError,
  isCotiPluginError,
  hasCotiErrorCode,
} from '../src/errors';

describe('errors (typed plugin errors)', () => {
  describe('CotiPluginError construction', () => {
    it('defaults the message to the code when none is provided', () => {
      const err = new CotiPluginError(CotiErrorCode.AES_KEY_MISSING);
      expect(err.message).toBe(CotiErrorCode.AES_KEY_MISSING);
      expect(err.code).toBe(CotiErrorCode.AES_KEY_MISSING);
      expect(err.name).toBe('CotiPluginError');
      expect(err.detail).toBeUndefined();
    });

    it('uses the provided message and detail', () => {
      const err = new CotiPluginError(
        CotiErrorCode.AES_KEY_MISMATCH,
        'keys do not match',
        'extra context',
      );
      expect(err.message).toBe('keys do not match');
      expect(err.code).toBe(CotiErrorCode.AES_KEY_MISMATCH);
      expect(err.detail).toBe('extra context');
    });

    it('is an instance of Error and CotiPluginError', () => {
      const err = new CotiPluginError(CotiErrorCode.USER_REJECTED);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(CotiPluginError);
    });
  });

  describe('isCotiPluginError', () => {
    it('returns true for a CotiPluginError', () => {
      expect(isCotiPluginError(new CotiPluginError(CotiErrorCode.NO_PROVIDER))).toBe(true);
    });

    it('returns false for a plain Error', () => {
      expect(isCotiPluginError(new Error('plain'))).toBe(false);
    });

    it('returns false for non-error values', () => {
      expect(isCotiPluginError('not an error')).toBe(false);
      expect(isCotiPluginError(null)).toBe(false);
      expect(isCotiPluginError(undefined)).toBe(false);
      expect(isCotiPluginError({ code: CotiErrorCode.API_ERROR })).toBe(false);
    });
  });

  describe('hasCotiErrorCode', () => {
    it('returns true when the error matches the given code', () => {
      const err = new CotiPluginError(CotiErrorCode.INSUFFICIENT_BALANCE);
      expect(hasCotiErrorCode(err, CotiErrorCode.INSUFFICIENT_BALANCE)).toBe(true);
    });

    it('returns false when the error has a different code', () => {
      const err = new CotiPluginError(CotiErrorCode.INSUFFICIENT_BALANCE);
      expect(hasCotiErrorCode(err, CotiErrorCode.INSUFFICIENT_ALLOWANCE)).toBe(false);
    });

    it('returns false for non-CotiPluginError values', () => {
      expect(hasCotiErrorCode(new Error('x'), CotiErrorCode.API_ERROR)).toBe(false);
      expect(hasCotiErrorCode(null, CotiErrorCode.API_ERROR)).toBe(false);
    });
  });
});
