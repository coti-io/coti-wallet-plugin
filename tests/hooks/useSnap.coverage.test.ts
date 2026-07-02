import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ connector: undefined })),
}));

import { useSnap } from '../../src/hooks/useSnap';
import { CotiErrorCode } from '../../src/errors';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';

const SNAP_ID = 'npm:@coti-io/coti-snap';
const ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678';
const AES_KEY = '0123456789abcdef0123456789abcdef';

type ReqArgs = { method: string; params?: unknown };

/** Builds a fully-successful snap mock with a configurable chainId and overrides. */
function fullSuccess(opts: {
  chainId?: string;
  hasKey?: boolean;
  getKey?: () => Promise<unknown>;
  setEnv?: () => Promise<unknown>;
} = {}) {
  const chainId = opts.chainId ?? '0x6c11a0';
  return (args: ReqArgs) => {
    switch (args.method) {
      case 'web3_clientVersion':
        return Promise.resolve('MetaMask/v11.0.0');
      case 'wallet_getSnaps':
        return Promise.resolve({ [SNAP_ID]: { version: '1.0.0' } });
      case 'wallet_requestSnaps':
        return Promise.resolve(undefined);
      case 'eth_chainId':
        return Promise.resolve(chainId);
      case 'eth_accounts':
        return Promise.resolve([ACCOUNT]);
      case 'wallet_invokeSnap': {
        const method = (args.params as { request?: { method?: string } })?.request?.method;
        if (method === 'set-environment') return opts.setEnv ? opts.setEnv() : Promise.resolve(undefined);
        if (method === 'has-aes-key') {
          return Promise.resolve(opts.hasKey !== false);
        }
        if (method === 'get-aes-key') {
          return opts.getKey ? opts.getKey() : Promise.resolve(AES_KEY);
        }
        return Promise.resolve(undefined);
      }
      default:
        return Promise.resolve(undefined);
    }
  };
}

describe('useSnap (branch coverage)', () => {
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(CotiSDK.decryptUint).mockReturnValue(0x0123456789abcdefn);
    mockRequest = vi.fn(fullSuccess());
     
    (window as any).ethereum = {
      request: mockRequest,
      on: vi.fn(),
      removeListener: vi.fn(),
      isMetaMask: true,
    };
  });

  afterEach(() => {
    const { result, unmount } = renderHook(() => useSnap());
    result.current.clearSnapCache();
    unmount();
    vi.useRealTimers();
  });

  // ─── getProvider catch ──────────────────────────────────────────────────

  it('logs a warning when window.ethereum access throws', async () => {
     
    const restore = (window as any).ethereum;
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      get() {
        throw new Error('property broken');
      },
    });
    try {
      const { result } = renderHook(() => useSnap());
      expect(await result.current.isSnapInstalled()).toBe(false);
    } finally {
      Object.defineProperty(window, 'ethereum', { value: restore, writable: true, configurable: true });
    }
  });

  // ─── connectToSnap (requestSnapConnection) ──────────────────────────────

  it('returns false from requestSnapConnection when no provider is available', async () => {
     
    delete (window as any).ethereum;
    const { result } = renderHook(() => useSnap());
    expect(await result.current.requestSnapConnection()).toBe(false);
  });

  it('clears the error on a successful requestSnapConnection', async () => {
    mockRequest.mockResolvedValue(undefined);
    const setSnapError = vi.fn();
    const { result } = renderHook(() => useSnap(setSnapError));
    expect(await result.current.requestSnapConnection()).toBe(true);
    expect(setSnapError).toHaveBeenCalledWith(null);
  });

  it('reports the generic Flask-installed failure message when already on Flask', async () => {
    mockRequest.mockImplementation((args: ReqArgs) => {
      if (args.method === 'web3_clientVersion') return Promise.resolve('MetaMask/v11.0.0-flask');
      if (args.method === 'wallet_getSnaps') return Promise.resolve({ [SNAP_ID]: {} });
      if (args.method === 'wallet_requestSnaps') return Promise.reject(new Error('boom'));
      return Promise.resolve(undefined);
    });
    const setSnapError = vi.fn();
    const { result } = renderHook(() => useSnap(setSnapError));
    await result.current.isSnapInstalled(); // sets isFlask.current = true

    await expect(result.current.requestSnapConnection()).rejects.toMatchObject({
      code: CotiErrorCode.SNAP_CONNECT_FAILED,
    });
    expect(setSnapError).toHaveBeenCalledWith('Failed to connect to Snap');
  });

  it('throws on a connection failure even without a setSnapError callback', async () => {
    mockRequest.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSnap());
    await expect(result.current.requestSnapConnection()).rejects.toMatchObject({
      code: CotiErrorCode.SNAP_CONNECT_FAILED,
    });
  });

  it('throws SNAP_CONNECT_FAILED without requesting permissions when snap is not connected', async () => {
    mockRequest.mockImplementation((args: ReqArgs) => {
      if (args.method === 'web3_clientVersion') return Promise.resolve('MetaMask/v11.0.0');
      if (args.method === 'wallet_getSnaps') return Promise.resolve({});
      if (args.method === 'wallet_requestSnaps') {
        throw new Error('wallet_requestSnaps must not be called');
      }
      return Promise.resolve(undefined);
    });
    const setSnapError = vi.fn();
    const { result } = renderHook(() => useSnap(setSnapError));
    await expect(result.current.getAESKeyFromSnap(ACCOUNT)).rejects.toMatchObject({
      code: CotiErrorCode.SNAP_CONNECT_FAILED,
    });
    expect(mockRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'wallet_requestSnaps' }),
    );
    expect(setSnapError).toHaveBeenCalledWith(null);
  });

  it('throws SNAP_CONNECT_FAILED without a setSnapError callback when snap is not connected', async () => {
    mockRequest.mockImplementation((args: ReqArgs) => {
      if (args.method === 'web3_clientVersion') return Promise.resolve('MetaMask/v11.0.0');
      if (args.method === 'wallet_getSnaps') return Promise.resolve({});
      if (args.method === 'wallet_requestSnaps') {
        throw new Error('wallet_requestSnaps must not be called');
      }
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useSnap());
    await expect(result.current.getAESKeyFromSnap(ACCOUNT)).rejects.toMatchObject({
      code: CotiErrorCode.SNAP_CONNECT_FAILED,
    });
    expect(mockRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'wallet_requestSnaps' }),
    );
  });

  // ─── executeSnapCheck ───────────────────────────────────────────────────

  it('does not log a failure when the installed-snap callback succeeds', async () => {
    const onSnapFound = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useSnap());
    await result.current.executeSnapCheck(onSnapFound);
    expect(onSnapFound).toHaveBeenCalled();
  });

  it('handles a missing snap with no setSnapError callback', async () => {
    mockRequest.mockImplementation((args: ReqArgs) => {
      if (args.method === 'web3_clientVersion') return Promise.resolve('MetaMask/v11.0.0');
      if (args.method === 'wallet_getSnaps') return Promise.resolve({});
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useSnap());
    await expect(result.current.executeSnapCheck(vi.fn())).resolves.toBeUndefined();
  });

  it('throws AES_KEY_MISSING when has-aes-key is false', async () => {
    mockRequest.mockImplementation(fullSuccess({ hasKey: false }));
    const { result } = renderHook(() => useSnap());

    const promise = result.current.getAESKeyFromSnap(ACCOUNT);
    const assertion = expect(promise).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISSING });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  // ─── getAESKeyFromSnap ──────────────────────────────────────────────────

  it('does not request snap permissions from getAESKeyFromSnap', async () => {
    mockRequest.mockImplementation((args: ReqArgs) => {
      if (args.method === 'web3_clientVersion') return Promise.resolve('MetaMask/v11.0.0');
      if (args.method === 'wallet_getSnaps') return Promise.resolve({});
      if (args.method === 'wallet_requestSnaps') throw new Error('wallet_requestSnaps must not be called');
      return Promise.resolve(undefined);
    });
    const setSnapError = vi.fn();
    const { result } = renderHook(() => useSnap(setSnapError));
    await expect(result.current.getAESKeyFromSnap(ACCOUNT)).rejects.toMatchObject({
      code: CotiErrorCode.SNAP_CONNECT_FAILED,
    });
    expect(mockRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'wallet_requestSnaps' }),
    );
  });

  it('resolves the COTI mainnet chain id and syncs the mainnet environment', async () => {
    mockRequest.mockImplementation(fullSuccess({ chainId: '0x282b34' }));
    const { result } = renderHook(() => useSnap());

    const promise = result.current.getAESKeyFromSnap(ACCOUNT);
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toBe(AES_KEY);
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'wallet_invokeSnap',
        params: expect.objectContaining({
          request: expect.objectContaining({ method: 'set-environment', params: { environment: 'mainnet' } }),
        }),
      }),
    );
  });

  it('continues when syncEnvironment fails (set-environment rejects)', async () => {
    mockRequest.mockImplementation(
      fullSuccess({ setEnv: () => Promise.reject(new Error('sync down')) }),
    );
    const { result } = renderHook(() => useSnap());

    const promise = result.current.getAESKeyFromSnap(ACCOUNT);
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toBe(AES_KEY);
  });

  it('sets the error and returns null on a generic (non-Coti) failure', async () => {
    mockRequest.mockImplementation(
      fullSuccess({ getKey: () => Promise.reject(new Error('rpc exploded')) }),
    );
    const setSnapError = vi.fn();
    const { result } = renderHook(() => useSnap(setSnapError));

    const promise = result.current.getAESKeyFromSnap(ACCOUNT);
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toBeNull();
    expect(setSnapError).toHaveBeenCalledWith('rpc exploded');
  });

  it('falls back to the default error message when the failure has no message', async () => {
    // A messageless rejection exercises the `error.message || 'Failed to connect to Snap'` fallback.
    mockRequest.mockImplementation(fullSuccess({ getKey: () => Promise.reject({}) }));
    const setSnapError = vi.fn();
    const { result } = renderHook(() => useSnap(setSnapError));

    const promise = result.current.getAESKeyFromSnap(ACCOUNT);
    await vi.advanceTimersByTimeAsync(500);
    expect(await promise).toBeNull();
    expect(setSnapError).toHaveBeenCalledWith('Failed to connect to Snap');
  });

  it('returns early from syncEnvironment when the provider disappears mid-connect', async () => {
    // connectToSnap succeeds, but the provider is removed during the request so the
    // subsequent syncEnvironment() sees no provider and returns early.
    mockRequest.mockImplementation((args: ReqArgs) => {
      if (args.method === 'wallet_requestSnaps') {
         
        delete (window as any).ethereum;
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useSnap());
    // result.current.connectToSnap is the connectAndSync wrapper (connect → sync).
    expect(await result.current.connectToSnap()).toBe(true);
  });

  // ─── saveAESKeyToSnap ───────────────────────────────────────────────────

  it('returns false from saveAESKeyToSnap when no provider is available', async () => {
     
    delete (window as any).ethereum;
    const { result } = renderHook(() => useSnap());
    expect(await result.current.saveAESKeyToSnap(AES_KEY, ACCOUNT)).toBe(false);
  });

  it('saves the key successfully without a setSnapError callback', async () => {
    mockRequest.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSnap());
    expect(await result.current.saveAESKeyToSnap(AES_KEY, ACCOUNT)).toBe(true);
  });

  // ─── resetError ─────────────────────────────────────────────────────────

  it('resetError is a no-op without a setSnapError callback', () => {
    const { result } = renderHook(() => useSnap());
    expect(() => result.current.resetError()).not.toThrow();
  });

  // ─── handleManualOnboarding / handleKeyVerification ─────────────────────

  it('handleManualOnboarding returns null without a setSnapError callback', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { result } = renderHook(() => useSnap());
    expect(await result.current.handleManualOnboarding()).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('handleKeyVerification fetches the snap key before onboardUser throws', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const setSnapError = vi.fn();
    const { result } = renderHook(() => useSnap(setSnapError));

    const promise = result.current.handleKeyVerification();
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(setSnapError).toHaveBeenCalledWith(expect.stringContaining('Verification failed'));
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
