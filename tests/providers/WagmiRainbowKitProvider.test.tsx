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
import { createConfig, http } from 'wagmi';

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
});
