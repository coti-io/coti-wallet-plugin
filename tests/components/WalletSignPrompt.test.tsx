import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WalletSignPrompt } from '../../src/components/WalletSignPrompt';

describe('WalletSignPrompt', () => {
  it('renders when open and hides when closed', () => {
    const { rerender } = render(
      <WalletSignPrompt isOpen walletType="metamask" />,
    );

    expect(screen.getByTestId('wallet-sign-prompt')).toBeInTheDocument();
    expect(screen.getByText('Sign in your wallet')).toBeInTheDocument();
    expect(screen.getByText(/Approve the signature in MetaMask/i)).toBeInTheDocument();

    rerender(<WalletSignPrompt isOpen={false} walletType="metamask" />);
    expect(screen.queryByTestId('wallet-sign-prompt')).not.toBeInTheDocument();
  });

  it('renders save-backup copy mentioning up to two signatures', () => {
    render(
      <WalletSignPrompt isOpen walletType="metamask" purpose="save-backup" />,
    );

    expect(screen.getByText(/encrypt your COTI privacy key backup/i)).toBeInTheDocument();
    expect(screen.getByText(/may prompt up to twice/i)).toBeInTheDocument();
    expect(screen.getByText(/once to encrypt, once to verify restore/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Only sign from an official or trusted COTI app/i),
    ).toBeInTheDocument();
  });

  it('uses the shared light-theme surface fills', () => {
    render(
      <WalletSignPrompt
        isOpen
        walletType="metamask"
        theme={{
          modal: { backgroundColor: '#ffffff', color: '#0f172a' },
          title: { color: '#0f172a' },
          description: { color: '#64748b' },
          primaryButton: { backgroundColor: '#991b1b' },
        }}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const calloutText = screen.getByText(/Waiting for signature/i);

    expect(dialog).toHaveStyle({ backgroundColor: 'rgb(255, 255, 255)' });
    expect(calloutText).toHaveStyle({ color: 'rgb(153, 27, 27)' });
  });
});
