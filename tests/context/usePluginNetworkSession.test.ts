import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAccount } from 'wagmi';

const h = vi.hoisted(() => ({
  metamaskCallbacks: null as {
    onNetworkChanged?: () => Promise<void>;
    onAccountChanged?: (account: string) => Promise<void>;
    onSnapCheck?: (account: string) => Promise<void>;
  } | null,
  switchNetwork: vi.fn(async () => true),
}));

vi.mock('../../src/hooks/useMetamask', () => ({
  useMetamask: (options: typeof h.metamaskCallbacks) => {
    h.metamaskCallbacks = options;
    return {
      connectWallet: vi.fn(),
      checkNetwork: vi.fn(),
      switchNetwork: h.switchNetwork,
      networkName: 'Sepolia',
      COTI_MAINNET_ID: '0x282b34',
      COTI_TESTNET_ID: '0x6c11a0',
      SEPOLIA_ID: '0xaa36a7',
      chainId: '11155111',
      registerEthereumInitializedListener: vi.fn(),
    };
  },
}));

vi.mock('../../src/hooks/useNetworkEnforcer', () => ({
  useNetworkEnforcer: () => ({
    isUnsupportedNetwork: false,
    isOffTargetNetwork: false,
    isWrongNetwork: false,
    networkMismatchWarning: null,
    enforceNetwork: vi.fn(),
  }),
}));

import { usePluginNetworkSession } from '../../src/context/plugin/usePluginNetworkSession';

const WALLET = '0x' + 'a'.repeat(40);
const COTI_HEX = '0x6c11a0';

const makeCore = (overrides: Record<string, unknown> = {}) => ({
  isConnected: true,
  walletAddress: WALLET,
  wagmiSyncRef: { current: true },
  disconnectingRef: { current: false },
  metamaskExplicitConnect: { current: true },
  setSessionAesKey: vi.fn(),
  setArePrivateBalancesHidden: vi.fn(),
  setPrivateTokens: vi.fn(),
  sessionAesKey: null,
  executeSnapCheck: vi.fn(async (fn: () => Promise<boolean>) => fn()),
  ...overrides,
});

describe('usePluginNetworkSession', () => {
  const originalUa = window.navigator.userAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    h.metamaskCallbacks = null;
    vi.mocked(useAccount).mockReturnValue({
      address: WALLET,
      isConnected: true,
      chainId: 11155111,
      connector: undefined,
    } as never);
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: originalUa,
      configurable: true,
    });
  });

  it('adds a missing WalletConnect chain then switches', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    vi.mocked(useAccount).mockReturnValue({
      address: WALLET,
      isConnected: true,
      chainId: 11155111,
      connector: {
        id: 'walletConnect',
        getProvider: async () => ({
          isWalletConnect: true,
          request,
          session: {
            namespaces: {
              eip155: {
                chains: ['eip155:11155111'],
                methods: ['wallet_addEthereumChain', 'wallet_switchEthereumChain'],
              },
            },
          },
        }),
      },
    } as never);

    const { result } = renderHook(() => usePluginNetworkSession({
      core: makeCore() as never,
      updateAccountStateRef: { current: null },
    }));

    await expect(result.current.switchNetwork(COTI_HEX)).resolves.toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: 'wallet_addEthereumChain',
    }));
    expect(request).toHaveBeenNthCalledWith(2, {
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: COTI_HEX }],
    });
  });

  it('derives approved chains from session accounts and skips add when already approved', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAccount).mockReturnValue({
      address: WALLET,
      isConnected: true,
      chainId: 11155111,
      connector: {
        id: 'walletConnect',
        getProvider: async () => ({
          request,
          session: {
            namespaces: {
              eip155: {
                accounts: ['eip155:7082400:0xabc'],
              },
            },
          },
        }),
      },
    } as never);

    const { result } = renderHook(() => usePluginNetworkSession({
      core: makeCore() as never,
      updateAccountStateRef: { current: null },
    }));

    await expect(result.current.switchNetwork(COTI_HEX)).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: COTI_HEX }],
    });
  });

  it('returns false when the WalletConnect session cannot add an unknown chain', async () => {
    const request = vi.fn();
    vi.mocked(useAccount).mockReturnValue({
      address: WALLET,
      isConnected: true,
      chainId: 11155111,
      connector: {
        id: 'walletConnect',
        getProvider: async () => ({
          isWalletConnect: true,
          request,
          session: { namespaces: { eip155: { chains: [] } } },
        }),
      },
    } as never);

    const { result } = renderHook(() => usePluginNetworkSession({
      core: makeCore() as never,
      updateAccountStateRef: { current: null },
    }));

    await expect(result.current.switchNetwork('0xdeadbeef')).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('returns false when wallet_addEthereumChain is not in the session methods', async () => {
    vi.mocked(useAccount).mockReturnValue({
      address: WALLET,
      isConnected: true,
      chainId: 11155111,
      connector: {
        id: 'walletConnect',
        getProvider: async () => ({
          isWalletConnect: true,
          request: vi.fn(),
          session: {
            namespaces: {
              eip155: {
                chains: ['eip155:1'],
                methods: ['wallet_switchEthereumChain'],
              },
            },
          },
        }),
      },
    } as never);

    const { result } = renderHook(() => usePluginNetworkSession({
      core: makeCore() as never,
      updateAccountStateRef: { current: null },
    }));

    await expect(result.current.switchNetwork(COTI_HEX)).resolves.toBe(false);
  });

  it('returns false when WalletConnect rejects add or the follow-up switch', async () => {
    const addRejected = vi.fn().mockRejectedValue(new Error('user rejected add'));
    vi.mocked(useAccount).mockReturnValue({
      address: WALLET,
      isConnected: true,
      chainId: 11155111,
      connector: {
        id: 'walletConnect',
        getProvider: async () => ({
          isWalletConnect: true,
          request: addRejected,
          session: { namespaces: { eip155: { chains: [] } } },
        }),
      },
    } as never);

    const { result, rerender } = renderHook(() => usePluginNetworkSession({
      core: makeCore() as never,
      updateAccountStateRef: { current: null },
    }));
    await expect(result.current.switchNetwork(COTI_HEX)).resolves.toBe(false);

    const request = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('switch failed'));
    vi.mocked(useAccount).mockReturnValue({
      address: WALLET,
      isConnected: true,
      chainId: 11155111,
      connector: {
        id: 'walletConnect',
        getProvider: async () => ({
          isWalletConnect: true,
          request,
          session: { namespaces: { eip155: { chains: [] } } },
        }),
      },
    } as never);
    rerender();
    await expect(result.current.switchNetwork(COTI_HEX)).resolves.toBe(false);
  });

  it('deep-links a mobile wallet app while adding a WalletConnect chain', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    const location = { href: 'https://dapp.example/' };
    vi.stubGlobal('location', location);

    const request = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAccount).mockReturnValue({
      address: WALLET,
      isConnected: true,
      chainId: 11155111,
      connector: {
        id: 'zerion',
        rkDetails: { id: 'zerion' },
        getProvider: async () => ({
          isWalletConnect: true,
          request,
          session: { namespaces: { eip155: { chains: [] } } },
        }),
      },
    } as never);

    const { result } = renderHook(() => usePluginNetworkSession({
      core: makeCore() as never,
      updateAccountStateRef: { current: null },
    }));

    const pending = result.current.switchNetwork(COTI_HEX);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await expect(pending).resolves.toBe(true);
    expect(location.href).toBe('zerion://');
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('soft-resyncs injected MetaMask network and account changes when wagmi is idle', async () => {
    const bindAccount = vi.fn().mockResolvedValue({ ok: true });
    const refreshPublicBalances = vi.fn().mockResolvedValue({ ok: true });
    const refreshPrivateBalances = vi.fn().mockResolvedValue({ ok: true });
    const core = makeCore({
      wagmiSyncRef: { current: false },
      disconnectingRef: { current: false },
    });
    vi.mocked(useAccount).mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: undefined,
      connector: undefined,
    } as never);

    renderHook(() => usePluginNetworkSession({
      core: core as never,
      updateAccountStateRef: {
        current: { bindAccount, refreshPublicBalances, refreshPrivateBalances },
      } as never,
    }));

    await h.metamaskCallbacks?.onNetworkChanged?.();
    expect(bindAccount).toHaveBeenCalledWith(WALLET);
    expect(refreshPublicBalances).toHaveBeenCalledWith({
      account: WALLET,
      chainId: undefined,
    });
    expect(refreshPrivateBalances).not.toHaveBeenCalled();
    expect(core.setPrivateTokens).toHaveBeenCalled();

    await h.metamaskCallbacks?.onAccountChanged?.('0x' + 'b'.repeat(40));
    expect(core.setSessionAesKey).toHaveBeenCalledWith(null);
    expect(core.setArePrivateBalancesHidden).toHaveBeenCalledWith(true);
    expect(core.setPrivateTokens).toHaveBeenCalled();

    await h.metamaskCallbacks?.onSnapCheck?.('0x' + 'c'.repeat(40));
    expect(core.executeSnapCheck).toHaveBeenCalled();
  });

  it('refetches private catalogs on injected chain change when a session AES key exists', async () => {
    const bindAccount = vi.fn().mockResolvedValue({ ok: true });
    const refreshPublicBalances = vi.fn().mockResolvedValue({ ok: true });
    const refreshPrivateBalances = vi.fn().mockResolvedValue({ ok: true });
    const core = makeCore({
      wagmiSyncRef: { current: false },
      disconnectingRef: { current: false },
      sessionAesKey: 'a'.repeat(64),
    });
    vi.mocked(useAccount).mockReturnValue({
      address: undefined,
      isConnected: false,
      chainId: undefined,
      connector: undefined,
    } as never);

    renderHook(() => usePluginNetworkSession({
      core: core as never,
      updateAccountStateRef: {
        current: { bindAccount, refreshPublicBalances, refreshPrivateBalances },
      } as never,
    }));

    await h.metamaskCallbacks?.onNetworkChanged?.();
    expect(refreshPrivateBalances).toHaveBeenCalledWith({
      account: WALLET,
      chainId: undefined,
      aesKey: 'a'.repeat(64),
    });
    expect(core.setPrivateTokens).not.toHaveBeenCalled();
  });

  it('ignores injected MetaMask events while wagmi owns the session', async () => {
    const bindAccount = vi.fn();
    renderHook(() => usePluginNetworkSession({
      core: makeCore({ wagmiSyncRef: { current: true } }) as never,
      updateAccountStateRef: { current: { bindAccount } } as never,
    }));

    await h.metamaskCallbacks?.onNetworkChanged?.();
    await h.metamaskCallbacks?.onAccountChanged?.(WALLET);
    await h.metamaskCallbacks?.onSnapCheck?.(WALLET);
    expect(bindAccount).not.toHaveBeenCalled();
  });
});
