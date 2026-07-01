import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock wagmi (not covered by vitest alias)
vi.mock('wagmi', () => ({
  createConfig: vi.fn(() => ({})),
  http: vi.fn((url: string) => url),
  WagmiProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('wagmi/connectors', () => ({
  injected: vi.fn(() => ({})),
  coinbaseWallet: vi.fn(() => ({})),
  walletConnect: vi.fn(() => ({})),
}));

vi.mock('@tanstack/react-query', () => ({
  QueryClient: class MockQueryClient {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('viem', () => ({
  defineChain: (chain: any) => chain,
}));

// rainbowkit and rainbowkit/wallets are mocked via vitest.config.ts aliases

import { WagmiRainbowKitProvider, getWagmiConfig, wagmiConfig } from '../../src/providers/WagmiRainbowKitProvider';
import { configureCotiPlugin } from '../../src/config/plugin';
import { resolveWalletConnectProjectId } from '../../src/config/walletConnect';
import { CotiErrorCode, CotiPluginError, hasCotiErrorCode } from '../../src/errors';
import { SEPOLIA_RPC } from '../../src/chains';
import { createConfig, http } from 'wagmi';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  rabbyWallet,
  oneKeyWallet,
  walletConnectWallet,
  trustWallet,
  coinbaseWallet,
  ledgerWallet,
} from '@rainbow-me/rainbowkit/wallets';

describe('WagmiRainbowKitProvider', () => {
  it('exports wagmiConfig for backward compatibility', () => {
    expect(wagmiConfig).toBeDefined();
  });

  it('renders children', () => {
    render(
      <WagmiRainbowKitProvider>
        <div data-testid="child">Hello</div>
      </WagmiRainbowKitProvider>
    );

    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.getByText('Hello')).toBeDefined();
  });

  it('renders with custom walletConnectProjectId', () => {
    render(
      <WagmiRainbowKitProvider walletConnectProjectId="test-project-id">
        <div data-testid="child-custom">Custom</div>
      </WagmiRainbowKitProvider>
    );

    expect(screen.getByTestId('child-custom')).toBeDefined();
  });

  it('renders multiple children', () => {
    render(
      <WagmiRainbowKitProvider>
        <span>First</span>
        <span>Second</span>
      </WagmiRainbowKitProvider>
    );

    expect(screen.getByText('First')).toBeDefined();
    expect(screen.getByText('Second')).toBeDefined();
  });

  it('getWagmiConfig uses configureCotiPlugin sepoliaRpcUrl at call time', () => {
    configureCotiPlugin({ sepoliaRpcUrl: 'https://custom-sepolia.example/rpc' });
    getWagmiConfig('test-project-id');
    const createConfigMock = vi.mocked(createConfig);
    const lastCall = createConfigMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.transports).toBeDefined();
    expect(http).toHaveBeenCalledWith('https://custom-sepolia.example/rpc');
    configureCotiPlugin({ sepoliaRpcUrl: undefined });
  });

  it('getWagmiConfig() without project id reflects later configureCotiPlugin updates', () => {
    configureCotiPlugin({ sepoliaRpcUrl: 'https://first-sepolia.example/rpc' });
    getWagmiConfig();
    vi.mocked(http).mockClear();
    configureCotiPlugin({ sepoliaRpcUrl: 'https://second-sepolia.example/rpc' });
    getWagmiConfig();
    expect(http).toHaveBeenCalledWith('https://second-sepolia.example/rpc');
    configureCotiPlugin({ sepoliaRpcUrl: undefined });
  });

  it('getWagmiConfig returns the same instance until plugin config changes', () => {
    configureCotiPlugin({ sepoliaRpcUrl: 'https://stable-sepolia.example/rpc' });
    const first = getWagmiConfig();
    const second = getWagmiConfig();
    expect(first).toBe(second);

    configureCotiPlugin({ sepoliaRpcUrl: 'https://updated-sepolia.example/rpc' });
    const third = getWagmiConfig();
    expect(third).not.toBe(first);
    configureCotiPlugin({ sepoliaRpcUrl: undefined });
  });

  it('getWagmiConfig uses SEPOLIA_RPC when plugin sepoliaRpcUrl is unset (WAG-02)', () => {
    configureCotiPlugin({ sepoliaRpcUrl: undefined });
    vi.mocked(http).mockClear();
    getWagmiConfig('wag2-explicit-project-id');
    expect(http).toHaveBeenCalledWith(SEPOLIA_RPC);
  });

  it('wagmiConfig proxy binds function properties to the cached config (WAG-03)', () => {
    configureCotiPlugin({ sepoliaRpcUrl: 'https://wag3-bind.example/rpc' });
    const reconnect = vi.fn(function (this: { tag: string }) {
      return this.tag;
    });
    vi.mocked(createConfig).mockReturnValueOnce({ tag: 'cached-config', reconnect } as never);

    const bound = (wagmiConfig as { reconnect: () => string }).reconnect;
    expect(bound()).toBe('cached-config');
    expect(reconnect).toHaveBeenCalled();

    configureCotiPlugin({ sepoliaRpcUrl: undefined });
  });

  it('wagmiConfig proxy reuses one config instance across property accesses', () => {
    configureCotiPlugin({ sepoliaRpcUrl: 'https://proxy-stable.example/rpc' });
    vi.mocked(createConfig).mockClear();
    void wagmiConfig.chains;
    void wagmiConfig.connectors;
    expect(createConfig).toHaveBeenCalledTimes(1);
    configureCotiPlugin({ sepoliaRpcUrl: undefined });
  });

  it('throws CotiPluginError when WalletConnect project ID is missing', () => {
    configureCotiPlugin({ walletConnectProjectId: undefined });
    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', '');

    expect(() => resolveWalletConnectProjectId()).toThrow(CotiPluginError);
    try {
      resolveWalletConnectProjectId();
    } catch (error) {
      expect(hasCotiErrorCode(error, CotiErrorCode.WALLETCONNECT_PROJECT_ID_MISSING)).toBe(true);
    }

    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'vitest-walletconnect-project-id');
  });

  it('resolveWalletConnectProjectId prefers prop over plugin config', () => {
    configureCotiPlugin({ walletConnectProjectId: 'from-plugin' });
    expect(resolveWalletConnectProjectId('from-prop')).toBe('from-prop');
    configureCotiPlugin({ walletConnectProjectId: undefined });
  });

  it('uses a reduced mobile wallet list (WalletConnect, MetaMask, Rabby, OneKey)', () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });

    vi.mocked(connectorsForWallets).mockClear();
    configureCotiPlugin({ sepoliaRpcUrl: 'https://mobile-wallets.example/rpc' });
    getWagmiConfig('mobile-wallet-test');

    expect(connectorsForWallets).toHaveBeenCalledWith(
      [
        {
          groupName: 'Recommended',
          wallets: [walletConnectWallet, metaMaskWallet, rabbyWallet, oneKeyWallet],
        },
      ],
      expect.objectContaining({ projectId: 'mobile-wallet-test' }),
    );

    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    });
    configureCotiPlugin({ sepoliaRpcUrl: undefined });
  });

  it('uses the full desktop wallet list on non-mobile browsers', () => {
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });

    vi.mocked(connectorsForWallets).mockClear();
    configureCotiPlugin({ sepoliaRpcUrl: 'https://desktop-wallets.example/rpc' });
    getWagmiConfig('desktop-wallet-test');

    expect(connectorsForWallets).toHaveBeenCalledWith(
      [
        {
          groupName: 'Recommended',
          wallets: [metaMaskWallet, rabbyWallet, trustWallet, oneKeyWallet, walletConnectWallet],
        },
        {
          groupName: 'Other',
          wallets: [coinbaseWallet, ledgerWallet],
        },
      ],
      expect.objectContaining({ projectId: 'desktop-wallet-test' }),
    );

    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent,
    });
    configureCotiPlugin({ sepoliaRpcUrl: undefined });
  });
});
