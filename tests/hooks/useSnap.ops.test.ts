import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAccount } from 'wagmi';

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ connector: undefined, address: undefined })),
}));

import { useSnap } from '../../src/hooks/useSnap';
import { CotiErrorCode } from '../../src/errors';
import { configureCotiPlugin } from '../../src/config/plugin';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';

const SNAP_ID = 'npm:@coti-io/coti-snap';
const ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678';
const AES_KEY = '0123456789abcdef0123456789abcdef';

type ReqArgs = { method: string; params?: unknown };

function snapRpc(overrides: Record<string, (args: ReqArgs) => Promise<unknown>> = {}) {
  return (args: ReqArgs) => {
    if (overrides[args.method]) return overrides[args.method](args);
    switch (args.method) {
      case 'web3_clientVersion':
        return Promise.resolve('MetaMask/v11.0.0');
      case 'wallet_getSnaps':
        return Promise.resolve({ [SNAP_ID]: { version: '1.0.0' } });
      case 'eth_chainId':
        return Promise.resolve('0x6c11a0');
      case 'eth_accounts':
        return Promise.resolve([ACCOUNT]);
      case 'wallet_invokeSnap': {
        const method = (args.params as { request?: { method?: string } })?.request?.method;
        if (method === 'set-environment' || method === 'connect-to-wallet') return Promise.resolve(undefined);
        if (method === 'has-aes-key') return Promise.resolve(true);
        if (method === 'get-aes-key') return Promise.resolve(AES_KEY);
        if (method === 'decrypt') return Promise.resolve('42');
        if (method === 'encrypt') {
          return Promise.resolve({ ciphertextHigh: '1', ciphertextLow: '2' });
        }
        if (method === 'build-it-uint256') {
          return Promise.resolve({
            value: {
              ciphertext: { ciphertextHigh: '3', ciphertextLow: '4' },
              signature: '0xsig',
            },
          });
        }
        return Promise.resolve(undefined);
      }
      default:
        return Promise.resolve(undefined);
    }
  };
}

describe('useSnap crypto and probe operations', () => {
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(CotiSDK.decryptUint).mockReturnValue(0x0123456789abcdefn);
    mockRequest = vi.fn(snapRpc());
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: mockRequest,
      on: vi.fn(),
      removeListener: vi.fn(),
      isMetaMask: true,
    };
    vi.mocked(useAccount).mockReturnValue({
      connector: undefined,
      address: ACCOUNT,
    } as never);
  });

  afterEach(() => {
    const { result, unmount } = renderHook(() => useSnap());
    result.current.clearSnapCache();
    unmount();
    configureCotiPlugin({ snapEnabled: true });
  });

  it('uses the wagmi connector provider when available and warns when getProvider throws', async () => {
    const request = vi.fn(snapRpc());
    vi.mocked(useAccount).mockReturnValue({
      address: ACCOUNT,
      connector: { getProvider: vi.fn(async () => ({ request })) },
    } as never);
    const { result } = renderHook(() => useSnap());
    expect(await result.current.isSnapInstalled()).toBe(true);
    expect(request).toHaveBeenCalled();

    vi.mocked(useAccount).mockReturnValue({
      address: ACCOUNT,
      connector: {
        getProvider: vi.fn(async () => {
          throw new Error('reconnect');
        }),
      },
    } as never);
    const { result: fallback } = renderHook(() => useSnap());
    expect(await fallback.current.isSnapInstalled()).toBe(true);
  });

  it('decrypts, encrypts, and builds IT ciphertext through the Snap', async () => {
    const { result } = renderHook(() => useSnap());
    await expect(result.current.decryptCtUint64ViaSnap(1n, 7082400, ACCOUNT)).resolves.toBe(42n);
    await expect(result.current.decryptCtUint256ViaSnap(
      { ciphertextHigh: 1n, ciphertextLow: 2n },
      7082400,
      ACCOUNT,
    )).resolves.toBe(42n);
    await expect(result.current.encryptUint256ViaSnap(5n, 7082400, ACCOUNT)).resolves.toEqual({
      ciphertextHigh: 1n,
      ciphertextLow: 2n,
    });
    await expect(result.current.buildItUint256ViaSnap({
      value: 9n,
      tokenAddress: '0x' + 'c'.repeat(40),
      functionSelector: '0x12345678',
      chainId: 7082400,
      accountAddress: ACCOUNT,
    })).resolves.toEqual({
      ciphertext: { ciphertextHigh: 3n, ciphertextLow: 4n },
      signature: '0xsig',
    });
  });

  it('returns null from Snap crypto helpers when the operation has no result', async () => {
    mockRequest.mockImplementation(snapRpc({
      wallet_invokeSnap: async (args) => {
        const method = (args.params as { request?: { method?: string } })?.request?.method;
        if (method === 'decrypt' || method === 'encrypt' || method === 'build-it-uint256') {
          return null;
        }
        if (method === 'set-environment' || method === 'connect-to-wallet') return undefined;
        if (method === 'has-aes-key') return true;
        return undefined;
      },
    }));
    const { result } = renderHook(() => useSnap());
    await expect(result.current.decryptCtUint64ViaSnap('1')).resolves.toBeNull();
    await expect(result.current.encryptUint256ViaSnap('1')).resolves.toBeNull();
    await expect(result.current.buildItUint256ViaSnap({
      value: '1',
      tokenAddress: '0x' + 'c'.repeat(40),
      functionSelector: '0x12345678',
    })).resolves.toBeNull();
  });

  it('throws when a Snap operation is requested without an installed snap', async () => {
    mockRequest.mockImplementation(snapRpc({
      wallet_getSnaps: async () => ({}),
    }));
    const { result } = renderHook(() => useSnap());
    await expect(result.current.decryptCtUint64ViaSnap(1n)).rejects.toMatchObject({
      code: CotiErrorCode.SNAP_CONNECT_FAILED,
    });
  });

  it('returns null from Snap operations when no provider is available', async () => {
    delete (window as unknown as { ethereum?: unknown }).ethereum;
    const { result } = renderHook(() => useSnap());
    await expect(result.current.decryptCtUint64ViaSnap(1n)).resolves.toBeNull();
  });

  it('probes hasAesKeyInSnap including disabled, missing, not-ready, and assert failures', async () => {
    configureCotiPlugin({ snapEnabled: false });
    const { result: disabled } = renderHook(() => useSnap());
    await expect(disabled.current.hasAesKeyInSnap(ACCOUNT)).resolves.toBeNull();
    configureCotiPlugin({ snapEnabled: true });

    delete (window as unknown as { ethereum?: unknown }).ethereum;
    const { result: missing } = renderHook(() => useSnap());
    await expect(missing.current.hasAesKeyInSnap(ACCOUNT)).resolves.toBeNull();

    (window as unknown as { ethereum: unknown }).ethereum = {
      request: mockRequest,
      isMetaMask: true,
    };
    mockRequest.mockImplementation(snapRpc({
      wallet_getSnaps: async () => ({}),
    }));
    const { result: notInstalled } = renderHook(() => useSnap());
    await expect(notInstalled.current.hasAesKeyInSnap(ACCOUNT)).resolves.toBeNull();

    mockRequest.mockImplementation(snapRpc({
      eth_accounts: async () => ['0x' + 'b'.repeat(40)],
    }));
    const { result: wrongAccount } = renderHook(() => useSnap());
    await expect(wrongAccount.current.hasAesKeyInSnap(ACCOUNT)).resolves.toBe(false);

    mockRequest.mockImplementation(snapRpc({
      wallet_invokeSnap: async (args) => {
        const method = (args.params as { request?: { method?: string } })?.request?.method;
        if (method === 'has-aes-key') {
          throw { message: 'No account connected' };
        }
        return undefined;
      },
    }));
    const { result: notReady } = renderHook(() => useSnap());
    await expect(notReady.current.hasAesKeyInSnap(ACCOUNT)).resolves.toBe(false);

    mockRequest.mockImplementation(snapRpc({
      wallet_invokeSnap: async (args) => {
        const method = (args.params as { request?: { method?: string } })?.request?.method;
        if (method === 'has-aes-key') throw new Error('rpc down');
        if (method === 'set-environment' || method === 'connect-to-wallet') return undefined;
        return undefined;
      },
    }));
    const { result: failed } = renderHook(() => useSnap());
    await expect(failed.current.hasAesKeyInSnap(ACCOUNT)).resolves.toBeNull();
  });

  it('skips AES cache when skipCache is set and drops a stale cached key', async () => {
    const { result } = renderHook(() => useSnap());
    vi.useFakeTimers();
    try {
      const first = result.current.getAESKeyFromSnap(ACCOUNT);
      await vi.advanceTimersByTimeAsync(500);
      expect(await first).toBe(AES_KEY);

      mockRequest.mockImplementation(snapRpc({
        eth_accounts: async () => ['0x' + 'c'.repeat(40)],
      }));
      const skipped = expect(result.current.getAESKeyFromSnap(ACCOUNT, { skipCache: true })).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(500);
      await skipped;
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps empty eth_accounts to AES_KEY_MISSING', async () => {
    mockRequest.mockImplementation(snapRpc({
      eth_accounts: async () => [],
    }));
    const { result } = renderHook(() => useSnap());
    await expect(result.current.getAESKeyFromSnap(ACCOUNT)).rejects.toMatchObject({
      code: CotiErrorCode.AES_KEY_MISSING,
    });
  });

  it('saves nothing when Snap is disabled and sets an error when connect has no provider', async () => {
    configureCotiPlugin({ snapEnabled: false });
    const { result } = renderHook(() => useSnap());
    await expect(result.current.saveAESKeyToSnap(AES_KEY, ACCOUNT)).resolves.toBe(false);

    configureCotiPlugin({ snapEnabled: true });
    delete (window as unknown as { ethereum?: unknown }).ethereum;
    const setSnapError = vi.fn();
    const { result: noProvider } = renderHook(() => useSnap(setSnapError));
    await expect(noProvider.current.requestSnapConnection()).resolves.toBe(false);
    expect(setSnapError).toHaveBeenCalledWith(expect.stringContaining('No MetaMask provider'));
  });

  it('rethrows CotiPluginError from key verification', async () => {
    mockRequest.mockImplementation(snapRpc({
      wallet_getSnaps: async () => ({}),
    }));
    const setSnapError = vi.fn();
    const { result } = renderHook(() => useSnap(setSnapError));
    await expect(result.current.handleKeyVerification()).rejects.toMatchObject({
      code: CotiErrorCode.SNAP_CONNECT_FAILED,
    });
    expect(setSnapError).toHaveBeenCalledWith(expect.stringContaining('Verification failed'));
  });

  it('falls through when the connector provider is null and detects Flask', async () => {
    vi.mocked(useAccount).mockReturnValue({
      address: ACCOUNT,
      connector: { getProvider: vi.fn(async () => null) },
    } as never);
    mockRequest.mockImplementation(snapRpc({
      web3_clientVersion: async () => 'MetaMask/v11.0.0-flask',
    }));
    const { result } = renderHook(() => useSnap());
    expect(await result.current.isSnapInstalled()).toBe(true);
  });

  it('treats wallets without snap RPC support as not installed', async () => {
    mockRequest.mockImplementation(async () => {
      throw { code: -32601, message: 'Method not found' };
    });
    const { result } = renderHook(() => useSnap());
    expect(await result.current.isSnapInstalled()).toBe(false);
  });

  it('maps connectToSnap failures for Flask vs non-Flask wallets', async () => {
    const setSnapError = vi.fn();
    mockRequest.mockImplementation(snapRpc({
      wallet_requestSnaps: async () => {
        throw { message: 'denied' };
      },
    }));
    const { result } = renderHook(() => useSnap(setSnapError));
    await expect(result.current.connectToSnap()).rejects.toMatchObject({
      code: CotiErrorCode.SNAP_CONNECT_FAILED,
    });
    expect(setSnapError).toHaveBeenCalledWith('MetaMask Flask is required for this Snap.');

    mockRequest.mockImplementation(snapRpc({
      web3_clientVersion: async () => 'MetaMask/v11.0.0-flask',
      wallet_requestSnaps: async () => {
        throw { message: 'denied' };
      },
    }));
    setSnapError.mockClear();
    const { result: flask } = renderHook(() => useSnap(setSnapError));
    await flask.current.isSnapInstalled();
    await expect(flask.current.connectToSnap()).rejects.toMatchObject({
      code: CotiErrorCode.SNAP_CONNECT_FAILED,
    });
    expect(setSnapError).toHaveBeenCalledWith('Failed to connect to Snap');
  });

  it('maps wallet_requestSnaps method-not-found to a MetaMask-required error', async () => {
    const setSnapError = vi.fn();
    mockRequest.mockImplementation(snapRpc({
      wallet_requestSnaps: async () => {
        throw { code: -32601, message: 'Method not found' };
      },
    }));
    const { result } = renderHook(() => useSnap(setSnapError));
    await expect(result.current.connectToSnap()).resolves.toBe(false);
    expect(setSnapError).toHaveBeenCalledWith(expect.stringContaining('Snap requires MetaMask'));
  });

  it('treats connect-to-wallet failures as non-fatal and maps nested originalError', async () => {
    mockRequest.mockImplementation(snapRpc({
      wallet_invokeSnap: async (args) => {
        const method = (args.params as { request?: { method?: string } })?.request?.method;
        if (method === 'connect-to-wallet') throw new Error('busy');
        if (method === 'has-aes-key') {
          throw { data: { originalError: { message: 'No account connected' } } };
        }
        if (method === 'set-environment') return undefined;
        return undefined;
      },
    }));
    const { result } = renderHook(() => useSnap());
    await expect(result.current.hasAesKeyInSnap(ACCOUNT)).resolves.toBe(false);
  });

  it('stringifies nested bigints, returns null for malformed IT ciphertext, and rejects a null Snap key', async () => {
    mockRequest.mockImplementation(snapRpc({
      wallet_invokeSnap: async (args) => {
        const method = (args.params as { request?: { method?: string } })?.request?.method;
        if (method === 'decrypt') return '42';
        if (method === 'encrypt') return { ciphertextHigh: '1', ciphertextLow: '2' };
        if (method === 'build-it-uint256') return { value: { signature: '0x' } };
        if (method === 'get-aes-key') return null;
        if (method === 'has-aes-key') return true;
        if (method === 'set-environment' || method === 'connect-to-wallet') return undefined;
        return undefined;
      },
    }));
    const { result } = renderHook(() => useSnap());
    await expect(result.current.decryptCtUint256ViaSnap(
      { ciphertextHigh: 1n, ciphertextLow: 2n, extra: [3n] } as never,
      7082400,
      ACCOUNT,
    )).resolves.toBe(42n);
    await expect(result.current.buildItUint256ViaSnap({
      value: '1',
      tokenAddress: '0x' + 'c'.repeat(40),
      functionSelector: '0x12345678',
    })).resolves.toBeNull();

    vi.useFakeTimers();
    try {
      const pending = expect(result.current.getAESKeyFromSnap(ACCOUNT)).rejects.toMatchObject({
        code: CotiErrorCode.SNAP_DIALOG_REJECTED,
      });
      await vi.advanceTimersByTimeAsync(500);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null from getAESKeyFromSnap when no provider is available', async () => {
    delete (window as unknown as { ethereum?: unknown }).ethereum;
    const { result } = renderHook(() => useSnap());
    await expect(result.current.getAESKeyFromSnap(ACCOUNT)).resolves.toBeNull();
  });

  it('returns false from saveAESKeyToSnap when Snap is missing or the write fails', async () => {
    mockRequest.mockImplementation(snapRpc({
      wallet_getSnaps: async () => ({}),
    }));
    const { result } = renderHook(() => useSnap());
    await expect(result.current.saveAESKeyToSnap(AES_KEY, ACCOUNT)).resolves.toBe(false);

    mockRequest.mockImplementation(snapRpc({
      wallet_invokeSnap: async (args) => {
        const method = (args.params as { request?: { method?: string } })?.request?.method;
        if (method === 'set-aes-key') throw new Error('write failed');
        if (method === 'set-environment' || method === 'connect-to-wallet') return undefined;
        return undefined;
      },
    }));
    const { result: writeFail } = renderHook(() => useSnap());
    await expect(writeFail.current.saveAESKeyToSnap(AES_KEY, ACCOUNT)).resolves.toBe(false);
  });

  it('maps a generic getAESKeyFromSnap failure to null and records the snap error', async () => {
    const setSnapError = vi.fn();
    mockRequest.mockImplementation(snapRpc({
      wallet_invokeSnap: async (args) => {
        const method = (args.params as { request?: { method?: string } })?.request?.method;
        if (method === 'has-aes-key') throw new Error('rpc exploded');
        if (method === 'set-environment' || method === 'connect-to-wallet') return undefined;
        return undefined;
      },
    }));
    const { result } = renderHook(() => useSnap(setSnapError));
    vi.useFakeTimers();
    try {
      const pending = result.current.getAESKeyFromSnap(ACCOUNT);
      await vi.advanceTimersByTimeAsync(500);
      await expect(pending).resolves.toBeNull();
      expect(setSnapError).toHaveBeenCalledWith('rpc exploded');
    } finally {
      vi.useRealTimers();
    }
  });
});
