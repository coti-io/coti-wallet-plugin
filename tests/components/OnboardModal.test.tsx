import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardModal } from '../../src/components/OnboardModal';

describe('OnboardModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    isLoading: false,
    error: null,
    walletType: 'coinbase' as const,
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<OnboardModal {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders modal with correct intro screen content', () => {
    render(<OnboardModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Onboard User')).toBeInTheDocument();
    expect(screen.getByText('Begin Onboarding')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('shows progress screen title when in progress', () => {
    render(<OnboardModal {...defaultProps} isLoading={true} />);
    expect(screen.getByText('Onboarding in Progress')).toBeInTheDocument();
  });

  it('shows error screen with message and retry button', () => {
    render(<OnboardModal {...defaultProps} error="Network timeout" />);
    expect(screen.getByText('Onboarding Failed')).toBeInTheDocument();
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows debug trace on error screen when provided', () => {
    render(
      <OnboardModal
        {...defaultProps}
        error="Provider error"
        debugTrace={['+0ms start — wallet=metamask', '+120ms rpc — personal_sign']}
      />,
    );
    expect(screen.getByText('Debug trace')).toBeInTheDocument();
    expect(screen.getByText('+120ms rpc — personal_sign')).toBeInTheDocument();
  });

  it('calls onConfirm when "Begin Onboarding" is clicked', () => {
    const onConfirm = vi.fn();
    render(<OnboardModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Begin Onboarding'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when "Cancel" or backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<OnboardModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['coinbase', /Coinbase Wallet/],
    ['walletconnect', /WalletConnect/],
    ['rainbow', /Rainbow/],
    ['metamask', /MetaMask/],
  ])('shows correct wallet name for %s', (walletType, pattern) => {
    render(<OnboardModal {...defaultProps} walletType={walletType as any} isLoading={true} currentStep="signing-transaction" />);
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });

  it('shows "your wallet" for unknown wallet types', () => {
    render(<OnboardModal {...defaultProps} walletType={'phantom' as any} isLoading={true} currentStep="signing-transaction" />);
    expect(screen.getAllByText(/your wallet/).length).toBeGreaterThan(0);
  });

  it('has proper aria attributes', () => {
    render(<OnboardModal {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'onboard-modal-title');
  });

  describe('MetaMask Snap bypass', () => {
    it('renders nothing and auto-calls onConfirm for metamask + hasSnap', () => {
      const onConfirm = vi.fn();
      const { container } = render(
        <OnboardModal {...defaultProps} walletType="metamask" hasSnap={true} onConfirm={onConfirm} />
      );
      expect(container.innerHTML).toBe('');
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['metamask with hasSnap=false', 'metamask', false],
      ['metamask with hasSnap=undefined', 'metamask', undefined],
      ['coinbase with hasSnap=true', 'coinbase', true],
    ])('renders modal normally for %s', (_label, walletType, hasSnap) => {
      const onConfirm = vi.fn();
      render(
        <OnboardModal {...defaultProps} walletType={walletType as any} hasSnap={hasSnap} onConfirm={onConfirm} />
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('does not call onConfirm when isOpen is false', () => {
      const onConfirm = vi.fn();
      render(
        <OnboardModal {...defaultProps} isOpen={false} walletType="metamask" hasSnap={true} onConfirm={onConfirm} />
      );
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });
});
