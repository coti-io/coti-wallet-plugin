import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NetworkGuard } from '../../src/components/NetworkGuard';

const mockEnforceNetwork = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/context/PrivacyBridgeContext', () => ({
  usePrivacyBridgeContext: vi.fn(),
}));

import { usePrivacyBridgeContext } from '../../src/context/PrivacyBridgeContext';

const mockUsePrivacyBridgeContext = vi.mocked(usePrivacyBridgeContext);

function mockContext(overrides: Partial<ReturnType<typeof usePrivacyBridgeContext>> = {}) {
  mockUsePrivacyBridgeContext.mockReturnValue({
    isConnected: true,
    isUnsupportedNetwork: false,
    isOffTargetNetwork: false,
    isWrongNetwork: false,
    networkMismatchWarning: null,
    enforceNetwork: mockEnforceNetwork,
    networkName: 'COTI Testnet',
    ...overrides,
  } as ReturnType<typeof usePrivacyBridgeContext>);
}

describe('NetworkGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceNetwork.mockResolvedValue(undefined);
    mockContext();
  });

  it('renders children only when network is supported and on target', () => {
    render(
      <NetworkGuard>
        <div>App content</div>
      </NetworkGuard>,
    );

    expect(screen.getByText('App content')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('renders children only when wallet is disconnected', () => {
    mockContext({
      isConnected: false,
      isUnsupportedNetwork: true,
      networkName: 'Wrong Network',
    });

    render(
      <NetworkGuard>
        <div>App content</div>
      </NetworkGuard>,
    );

    expect(screen.getByText('App content')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows unsupported-network guard overlay', () => {
    mockContext({
      isUnsupportedNetwork: true,
      isWrongNetwork: true,
      networkName: 'Ethereum Mainnet',
    });

    render(
      <NetworkGuard>
        <div>App content</div>
      </NetworkGuard>,
    );

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Unsupported Network')).toBeInTheDocument();
    expect(screen.getByText(/supported COTI network/)).toBeInTheDocument();
  });

  it('shows off-target guard overlay', () => {
    mockContext({
      isOffTargetNetwork: true,
      networkName: 'Sepolia',
    });

    render(<NetworkGuard />);

    expect(screen.getByRole('heading', { name: 'Switch Network' })).toBeInTheDocument();
    expect(screen.getByText(/required network/)).toBeInTheDocument();
  });

  it('shows networkMismatchWarning when present', () => {
    mockContext({
      isUnsupportedNetwork: true,
      isWrongNetwork: true,
      networkMismatchWarning: 'Network switch was rejected.',
      networkName: 'Ethereum Mainnet',
    });

    render(<NetworkGuard />);

    expect(screen.getByText('Network switch was rejected.')).toBeInTheDocument();
  });

  it('calls enforceNetwork when Switch Network is clicked', async () => {
    mockContext({ isOffTargetNetwork: true, networkName: 'Sepolia' });

    render(<NetworkGuard />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch Network' }));

    await waitFor(() => {
      expect(mockEnforceNetwork).toHaveBeenCalledTimes(1);
    });
  });
});
