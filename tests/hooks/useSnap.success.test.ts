import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ connector: undefined })),
}));

import {
  useSnap,
  signIT256ViaSnap,
  onboardUser,
} from '../../src/hooks/useSnap';
import { CotiErrorCode } from '../../src/errors';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
import { configureCotiPlugin } from '../../src/config/plugin';

const SNAP_ID = 'npm:@coti-io/coti-snap';
const ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678';
const AES_KEY = '0123456789abcdef0123456789abcdef';

function snapInstalledMocks() {
  return (args: { method: string; params?: unknown }) => {
    switch (args.method) {
      case 'web3_clientVersion':
        return Promise.resolve('MetaMask/v11.0.0');
      case 'wallet_getSnaps':
        return Promise.resolve({ [SNAP_ID]: { version: '1.0.0' } });
      case 'wallet_requestSnaps':
        return Promise.resolve(undefined);
      case 'eth_chainId':
        return Promise.resolve('0x6c11a0'); // COTI testnet
      case 'eth_accounts':
        return Promise.resolve([ACCOUNT]);
      case 'wallet_invokeSnap': {
        const snapMethod = (args.params as { request?: { method?: string } })?.request?.method;
        if (snapMethod === 'set-environment') return Promise.resolve(undefined);
        if (snapMethod === 'has-aes-key') return Promise.resolve(true);
        if (snapMethod === 'get-aes-key') return Promise.resolve(AES_KEY);
        if (snapMethod === 'set-aes-key') return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      }
      default:
        return Promise.resolve(undefined);
    }
  };
}

describe('useSnap (success & lifecycle paths)', () => {
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(CotiSDK.decryptUint).mockReturnValue(0x0123456789abcdefn);
    mockRequest = vi.fn(snapInstalledMocks());
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

  describe('detectFlask', () => {
    it('detects Flask from client version string', async () => {
      mockRequest.mockImplementation((args: { method: string }) => {
        if (args.method === 'web3_clientVersion') return Promise.resolve('MetaMask/v11.0.0-flask');
        if (args.method === 'wallet_getSnaps') return Promise.resolve({ [SNAP_ID]: {} });
        return Promise.resolve(undefined);
      });
      const { result } = renderHook(() => useSnap());
      expect(await result.current.isSnapInstalled()).toBe(true);
    });

    it('treats web3_clientVersion failure as non-Flask', async () => {
      mockRequest.mockImplementation((args: { method: string }) => {
        if (args.method === 'web3_clientVersion') return Promise.reject(new Error('fail'));
        if (args.method === 'wallet_getSnaps') return Promise.resolve({});
        return Promise.resolve(undefined);
      });
      const { result } = renderHook(() => useSnap());
      expect(await result.current.isSnapInstalled()).toBe(false);
    });
  });

  describe('connectToSnap / connectAndSync', () => {
    it('connectToSnap (connectAndSync) connects and syncs environment', async () => {
      const { result } = renderHook(() => useSnap());
      const ok = await result.current.connectToSnap();
      expect(ok).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'wallet_requestSnaps',
          params: { [SNAP_ID]: {} },
        }),
      );
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'wallet_invokeSnap',
          params: expect.objectContaining({
            request: expect.objectContaining({ method: 'set-environment' }),
          }),
        }),
      );
    });

    it('requestSnapConnection passes a pinned snap version when configured', async () => {
      configureCotiPlugin({ snapVersion: '1.0.52' });
      const { result } = renderHook(() => useSnap());

      await result.current.requestSnapConnection();

      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'wallet_requestSnaps',
          params: { [SNAP_ID]: { version: '1.0.52' } },
        }),
      );
      configureCotiPlugin({ snapVersion: undefined });
    });

    it('requestSnapConnection returns false and sets error on -32601', async () => {
      mockRequest.mockRejectedValue({ code: -32601 });
      const setSnapError = vi.fn();
      const { result } = renderHook(() => useSnap(setSnapError));

      const ok = await result.current.requestSnapConnection();
      expect(ok).toBe(false);
      expect(setSnapError).toHaveBeenCalledWith('Snap requires MetaMask. Disable other wallet extensions and retry.');
    });

    it('requestSnapConnection throws SNAP_CONNECT_FAILED for other errors', async () => {
      mockRequest.mockRejectedValue(new Error('boom'));
      const setSnapError = vi.fn();
      const { result } = renderHook(() => useSnap(setSnapError));

      await expect(result.current.requestSnapConnection()).rejects.toMatchObject({
        code: CotiErrorCode.SNAP_CONNECT_FAILED,
      });
    });
  });

  describe('executeSnapCheck', () => {
    it('runs callback when snap is installed and reports failure', async () => {
      const onSnapFound = vi.fn().mockResolvedValue(false);
      const { result } = renderHook(() => useSnap());

      await act(async () => {
        await result.current.executeSnapCheck(onSnapFound);
      });
      expect(onSnapFound).toHaveBeenCalled();
    });

    it('sets Flask-required error when snap is missing and not Flask', async () => {
      mockRequest.mockImplementation((args: { method: string }) => {
        if (args.method === 'web3_clientVersion') return Promise.resolve('MetaMask/v11.0.0');
        if (args.method === 'wallet_getSnaps') return Promise.resolve({});
        return Promise.resolve(undefined);
      });
      const setSnapError = vi.fn();
      const { result } = renderHook(() => useSnap(setSnapError));

      await act(async () => {
        await result.current.executeSnapCheck(vi.fn());
      });
      expect(setSnapError).toHaveBeenCalledWith(null);
    });

    it('sets connect prompt when snap is missing on Flask', async () => {
      mockRequest.mockImplementation((args: { method: string }) => {
        if (args.method === 'web3_clientVersion') return Promise.resolve('MetaMask/v11.0.0-flask');
        if (args.method === 'wallet_getSnaps') return Promise.resolve({});
        return Promise.resolve(undefined);
      });
      const setSnapError = vi.fn();
      const { result } = renderHook(() => useSnap(setSnapError));

      await act(async () => {
        await result.current.executeSnapCheck(vi.fn());
      });
      expect(setSnapError).toHaveBeenCalledWith(null);
    });
  });

  describe('getAESKeyFromSnap', () => {
    it('retrieves, caches, and returns the AES key', async () => {
      const { result } = renderHook(() => useSnap());

      const promise = result.current.getAESKeyFromSnap(ACCOUNT);
      await vi.advanceTimersByTimeAsync(500);
      const key = await promise;

      expect(key).toBe(AES_KEY);

      // Second call should be served from cache (no new invokeSnap for get-aes-key)
      const invokeBefore = mockRequest.mock.calls.filter(
        (c) => c[0]?.method === 'wallet_invokeSnap' &&
          (c[0]?.params as any)?.request?.method === 'get-aes-key',
      ).length;

      const cached = await result.current.getAESKeyFromSnap(ACCOUNT);
      expect(cached).toBe(AES_KEY);

      const invokeAfter = mockRequest.mock.calls.filter(
        (c) => c[0]?.method === 'wallet_invokeSnap' &&
          (c[0]?.params as any)?.request?.method === 'get-aes-key',
      ).length;
      expect(invokeAfter).toBe(invokeBefore);
    });

    it('throws SNAP_CONNECT_FAILED when snap is not installed', async () => {
      mockRequest.mockImplementation((args: { method: string }) => {
        if (args.method === 'web3_clientVersion') return Promise.resolve('MetaMask/v11.0.0');
        if (args.method === 'wallet_getSnaps') return Promise.resolve({});
        return Promise.resolve(undefined);
      });
      const { result } = renderHook(() => useSnap());

      await expect(result.current.getAESKeyFromSnap(ACCOUNT)).rejects.toMatchObject({
        code: CotiErrorCode.SNAP_CONNECT_FAILED,
      });
    });

    it('throws AES_KEY_MISSING when snap is installed but has no stored key', async () => {
      vi.useRealTimers();
      mockRequest.mockImplementation((args: { method: string; params?: unknown }) => {
        switch (args.method) {
          case 'web3_clientVersion': return Promise.resolve('MetaMask/v11.0.0');
          case 'wallet_getSnaps': return Promise.resolve({ [SNAP_ID]: {} });
          case 'wallet_requestSnaps': return Promise.resolve(undefined);
          case 'eth_chainId': return Promise.resolve('0x6c11a0');
          case 'eth_accounts': return Promise.resolve([ACCOUNT]);
          case 'wallet_invokeSnap': {
            const snapMethod = (args.params as { request?: { method?: string } })?.request?.method;
            if (snapMethod === 'set-environment') return Promise.resolve(undefined);
            if (snapMethod === 'has-aes-key') return Promise.resolve(false);
            return Promise.resolve(null);
          }
          default: return Promise.resolve(undefined);
        }
      });
      const { result } = renderHook(() => useSnap());

      await expect(result.current.getAESKeyFromSnap(ACCOUNT)).rejects.toMatchObject({
        code: CotiErrorCode.AES_KEY_MISSING,
      });
      vi.useFakeTimers();
    });

    it('throws SNAP_DIALOG_REJECTED when snap returns null key', async () => {
      vi.useRealTimers();
      mockRequest.mockImplementation((args: { method: string; params?: unknown }) => {
        switch (args.method) {
          case 'web3_clientVersion': return Promise.resolve('MetaMask/v11.0.0');
          case 'wallet_getSnaps': return Promise.resolve({ [SNAP_ID]: {} });
          case 'wallet_requestSnaps': return Promise.resolve(undefined);
          case 'eth_chainId': return Promise.resolve('0x6c11a0');
          case 'eth_accounts': return Promise.resolve([ACCOUNT]);
          case 'wallet_invokeSnap': {
            const snapMethod = (args.params as { request?: { method?: string } })?.request?.method;
            if (snapMethod === 'set-environment') return Promise.resolve(undefined);
            if (snapMethod === 'has-aes-key') return Promise.resolve(true);
            if (snapMethod === 'get-aes-key') return Promise.resolve(null);
            return Promise.resolve(undefined);
          }
          default: return Promise.resolve(undefined);
        }
      });
      const { result } = renderHook(() => useSnap());

      await expect(result.current.getAESKeyFromSnap(ACCOUNT)).rejects.toMatchObject({
        code: CotiErrorCode.SNAP_DIALOG_REJECTED,
      });
      vi.useFakeTimers();
    });

    it('retries when account is not ready', async () => {
      let getKeyCalls = 0;
      mockRequest.mockImplementation((args: { method: string; params?: unknown }) => {
        switch (args.method) {
          case 'web3_clientVersion': return Promise.resolve('MetaMask/v11.0.0');
          case 'wallet_getSnaps': return Promise.resolve({ [SNAP_ID]: {} });
          case 'wallet_requestSnaps': return Promise.resolve(undefined);
          case 'eth_chainId': return Promise.resolve('0x6c11a0');
          case 'eth_accounts': return Promise.resolve([ACCOUNT]);
          case 'wallet_invokeSnap': {
            const snapMethod = (args.params as { request?: { method?: string } })?.request?.method;
            if (snapMethod === 'set-environment') return Promise.resolve(undefined);
            if (snapMethod === 'has-aes-key') return Promise.resolve(true);
            getKeyCalls++;
            if (getKeyCalls === 1) {
              return Promise.reject(new Error('No account connected'));
            }
            return Promise.resolve(AES_KEY);
          }
          default: return Promise.resolve(undefined);
        }
      });

      const { result } = renderHook(() => useSnap());
      const promise = result.current.getAESKeyFromSnap(ACCOUNT);
      await vi.advanceTimersByTimeAsync(500); // initial delay
      await vi.advanceTimersByTimeAsync(1000); // retry delay
      const key = await promise;
      expect(key).toBe(AES_KEY);
      expect(getKeyCalls).toBe(2);
    });

    it('returns null for concurrent calls while a request is pending', async () => {
      mockRequest.mockImplementation((args: { method: string; params?: unknown }) => {
        switch (args.method) {
          case 'web3_clientVersion': return Promise.resolve('MetaMask/v11.0.0');
          case 'wallet_getSnaps': return Promise.resolve({ [SNAP_ID]: {} });
          case 'wallet_requestSnaps': return Promise.resolve(undefined);
          case 'eth_chainId': return Promise.resolve('0x6c11a0');
          case 'eth_accounts': return Promise.resolve([ACCOUNT]);
          case 'wallet_invokeSnap': {
            const snapMethod = (args.params as { request?: { method?: string } })?.request?.method;
            if (snapMethod === 'set-environment') return Promise.resolve(undefined);
            if (snapMethod === 'has-aes-key') return Promise.resolve(true);
            if (snapMethod === 'get-aes-key') return new Promise(() => {});
            return Promise.resolve(undefined);
          }
          default: return Promise.resolve(undefined);
        }
      });

      const { result } = renderHook(() => useSnap());
      // Start first request (will hang on get-aes-key after the 500ms delay)
      void result.current.getAESKeyFromSnap(ACCOUNT);
      await vi.advanceTimersByTimeAsync(500);
      // Flush microtasks so isSnapRequestPending is set before the second call
      await Promise.resolve();
      await Promise.resolve();

      const second = await result.current.getAESKeyFromSnap(ACCOUNT);
      expect(second).toBeNull();
    });
  });

  describe('saveAESKeyToSnap', () => {
    it('persists the key and updates cache', async () => {
      const setSnapError = vi.fn();
      const { result } = renderHook(() => useSnap(setSnapError));

      const ok = await result.current.saveAESKeyToSnap(AES_KEY, ACCOUNT);
      expect(ok).toBe(true);
      expect(setSnapError).toHaveBeenCalledWith(null);

      // cache hit without another invokeSnap get-aes-key
      const cached = await result.current.getAESKeyFromSnap(ACCOUNT);
      expect(cached).toBe(AES_KEY);
    });

    it('returns false when save fails', async () => {
      mockRequest.mockImplementation((args: { method: string }) => {
        if (args.method === 'wallet_invokeSnap') {
          return Promise.reject(new Error('save failed'));
        }
        return Promise.resolve(undefined);
      });
      const { result } = renderHook(() => useSnap());
      expect(await result.current.saveAESKeyToSnap(AES_KEY, ACCOUNT)).toBe(false);
    });
  });

  describe('handleManualOnboarding & handleKeyVerification', () => {
    it('handleManualOnboarding returns null when onboardUser throws', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      const setSnapError = vi.fn();
      const { result } = renderHook(() => useSnap(setSnapError));

      const key = await result.current.handleManualOnboarding();
      expect(key).toBeNull();
      expect(setSnapError).toHaveBeenCalledWith(expect.stringContaining('Onboarding failed'));
      expect(alertSpy).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('handleKeyVerification surfaces verification failure via setSnapError', async () => {
      mockRequest.mockImplementation((args: { method: string; params?: unknown }) => {
        switch (args.method) {
          case 'web3_clientVersion': return Promise.resolve('MetaMask/v11.0.0');
          case 'wallet_getSnaps': return Promise.resolve({ [SNAP_ID]: {} });
          case 'wallet_requestSnaps': return Promise.resolve(undefined);
          case 'eth_chainId': return Promise.resolve('0x6c11a0');
          case 'eth_accounts': return Promise.resolve([ACCOUNT]);
          case 'wallet_invokeSnap':
            if ((args.params as any)?.request?.method === 'set-environment') {
              return Promise.resolve(undefined);
            }
            return Promise.reject(new Error('verification failed'));
          default: return Promise.resolve(undefined);
        }
      });
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

  describe('signIT256ViaSnap', () => {
    it('returns a Uint8Array signature from the snap', async () => {
      mockRequest.mockResolvedValue([1, 2, 3, 4]);
      const sig = await signIT256ViaSnap('0x' + 'ab'.repeat(32));
      expect(sig).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('returns null when the user rejects signing', async () => {
      mockRequest.mockResolvedValue(null);
      expect(await signIT256ViaSnap('0x' + 'ab'.repeat(32))).toBeNull();
    });

    it('throws NO_PROVIDER when window.ethereum is missing', async () => {
      delete (window as any).ethereum;
      await expect(signIT256ViaSnap('0x' + 'ab'.repeat(32))).rejects.toMatchObject({
        code: CotiErrorCode.NO_PROVIDER,
      });
    });
  });

  describe('onboardUser', () => {
    it('throws with onboarding URL guidance', async () => {
      await expect(onboardUser()).rejects.toThrow('dev.metamask.coti.io/wallet');
    });
  });
});
