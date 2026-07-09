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
});
