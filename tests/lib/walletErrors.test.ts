import { describe, expect, it } from 'vitest';
import {
  getErrorMessage,
  isInsufficientFundsError,
  isRpcRequestAlreadyPending,
  isUserRejection,
  retryWhilePending,
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

  it('detects MetaMask already-pending RPC requests', () => {
    expect(isRpcRequestAlreadyPending({ code: -32002 })).toBe(true);
    expect(isRpcRequestAlreadyPending({ code: '-32002' })).toBe(true);
    expect(isRpcRequestAlreadyPending({
      message: "Request of type 'wallet_requestPermissions' already pending for origin http://127.0.0.1:5173. Please wait.",
    })).toBe(true);
    expect(isRpcRequestAlreadyPending(new Error('network failed'))).toBe(false);
    expect(isRpcRequestAlreadyPending(null)).toBe(false);
  });

  it('retries a probe until it becomes ready', async () => {
    let calls = 0;
    const value = await retryWhilePending(
      async () => {
        calls += 1;
        return calls;
      },
      (next) => next >= 3,
      { attempts: 5, delayMs: 1 },
    );
    expect(value).toBe(3);
    expect(calls).toBe(3);
  });
});
