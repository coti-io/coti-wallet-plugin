import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardModal } from '../../src/components/OnboardModal';

describe('OnboardModal Component (README: OnboardModal)', () => {
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

  it('renders the modal when isOpen is true', () => {
    render(<OnboardModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('displays "Onboarding Required" title in idle state', () => {
    render(<OnboardModal {...defaultProps} />);
    expect(screen.getByText('Onboarding Required')).toBeInTheDocument();
  });

  it('displays "Signing in Progress" title when loading', () => {
    render(<OnboardModal {...defaultProps} isLoading={true} />);
    expect(screen.getByText('Signing in Progress')).toBeInTheDocument();
  });

  it('displays "Onboarding Failed" title when error', () => {
    render(<OnboardModal {...defaultProps} error="Something went wrong" />);
    expect(screen.getByText('Onboarding Failed')).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(<OnboardModal {...defaultProps} error="Network timeout" />);
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
  });

  it('calls onConfirm when "Sign & Onboard" is clicked', () => {
    const onConfirm = vi.fn();
    render(<OnboardModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Sign & Onboard'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when "Cancel" is clicked', () => {
    const onClose = vi.fn();
    render(<OnboardModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<OnboardModal {...defaultProps} onClose={onClose} />);
    // Click the backdrop (presentation role)
    const backdrop = screen.getByRole('presentation');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows "Retry" button when there is an error', () => {
    render(<OnboardModal {...defaultProps} error="Failed" />);
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('disables close button when loading', () => {
    render(<OnboardModal {...defaultProps} isLoading={true} />);
    const closeBtn = screen.getByLabelText('Close');
    expect(closeBtn).toBeDisabled();
  });

  it('shows wallet name for coinbase', () => {
    render(<OnboardModal {...defaultProps} walletType="coinbase" />);
    expect(screen.getByText(/Coinbase Wallet/)).toBeInTheDocument();
  });

  it('shows wallet name for walletconnect', () => {
    render(<OnboardModal {...defaultProps} walletType="walletconnect" />);
    expect(screen.getByText(/WalletConnect/)).toBeInTheDocument();
  });

  it('shows wallet name for rainbow', () => {
    render(<OnboardModal {...defaultProps} walletType="rainbow" />);
    expect(screen.getByText(/Rainbow/)).toBeInTheDocument();
  });

  it('shows wallet name for metamask', () => {
    render(<OnboardModal {...defaultProps} walletType="metamask" />);
    expect(screen.getByText(/MetaMask/)).toBeInTheDocument();
  });

  it('falls back to "your wallet" for unknown wallet types', () => {
    render(<OnboardModal {...defaultProps} walletType="phantom" />);
    expect(screen.getByText(/your wallet/)).toBeInTheDocument();
  });

  it('auto-closes when sessionAesKey is set', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <OnboardModal {...defaultProps} onClose={onClose} sessionAesKey={null} />
    );
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <OnboardModal {...defaultProps} onClose={onClose} sessionAesKey="abc123" />
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('has proper aria attributes for accessibility', () => {
    render(<OnboardModal {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'onboard-modal-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'onboard-modal-description');
  });
});
