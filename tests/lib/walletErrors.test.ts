import { describe, expect, it } from 'vitest';
import {
  getErrorMessage,
  isInsufficientFundsError,
  isUserRejection,
} from '../../src/lib/walletErrors';

describe('walletErrors', () => {
  it('detects common user rejection shapes', () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection({ info: { error: { code: 4001 } } })).toBe(true);
    expect(isUserRejection({ code: 'ACTION_REJECTED' })).toBe(true);
    expect(isUserRejection({ reason: 'rejected' })).toBe(true);
    expect(isUserRejection({ message: 'User denied transaction signature' })).toBe(true);
    expect(isUserRejection({ info: { error: { message: 'request rejected' } } })).toBe(true);
  });

  it('does not treat unrelated errors as user rejection', () => {
    expect(isUserRejection(new Error('network failed'))).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });

  it('extracts error messages from unknown values', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage({ message: 'object boom' })).toBe('object boom');
    expect(getErrorMessage('plain')).toBe('plain');
  });

  it('detects insufficient funds messages', () => {
    expect(isInsufficientFundsError(new Error('insufficient funds for transfer'))).toBe(true);
    expect(isInsufficientFundsError({ message: 'Not enough COTI' })).toBe(true);
    expect(isInsufficientFundsError(new Error('user rejected'))).toBe(false);
  });
});
