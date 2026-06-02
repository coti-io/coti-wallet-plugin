import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock all external dependencies before importing the component
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

vi.mock('@tanstack/react-query', () => {
  return {
    QueryClient: class MockQueryClient {},
    QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@rainbow-me/rainbowkit', () => ({
  RainbowKitProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('viem', () => ({
  defineChain: (chain: any) => chain,
}));

import { WagmiRainbowKitProvider } from '../../src/providers/WagmiRainbowKitProvider';

describe('WagmiRainbowKitProvider', () => {
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

  it('accepts and renders multiple children', () => {
    render(
      <WagmiRainbowKitProvider>
        <span>First</span>
        <span>Second</span>
      </WagmiRainbowKitProvider>
    );

    expect(screen.getByText('First')).toBeDefined();
    expect(screen.getByText('Second')).toBeDefined();
  });
});
