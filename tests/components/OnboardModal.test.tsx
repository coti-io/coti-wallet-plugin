import { beforeEach, describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<OnboardModal {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders modal with correct intro screen content', () => {
    render(<OnboardModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Onboard User')).toBeInTheDocument();
    expect(screen.getByText('Begin Onboarding')).toBeInTheDocument();
    expect(screen.getByText('Save encrypted backup')).toBeInTheDocument();
    const backupDetails = screen.getByLabelText('Backup details');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.mouseEnter(backupDetails);
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Only the encrypted blob is stored. Restoring it requires a wallet signature.'
    );
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('shows progress screen title when in progress', () => {
    render(<OnboardModal {...defaultProps} isLoading={true} />);
    expect(screen.getByText('Onboarding in Progress')).toBeInTheDocument();
  });

  it('shows a visible grant service indicator while requesting funds', () => {
    render(
      <OnboardModal
        {...defaultProps}
        isLoading={true}
        currentStep="granting-funds"
      />
    );

    expect(screen.getByText('Requesting COTI Grant')).toBeInTheDocument();
    expect(
      screen.getByText(/Waiting for the grant service to fund your wallet/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Requesting native COTI from the grant service/)
    ).toBeInTheDocument();
  });

  it('shows a visible balance wait indicator after the grant request is submitted', () => {
    render(
      <OnboardModal
        {...defaultProps}
        isLoading={true}
        currentStep="waiting-for-funds"
      />
    );

    expect(screen.getByText('Waiting for Grant Funds')).toBeInTheDocument();
    expect(screen.getByText(/grant request was submitted/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Waiting for the funded balance to appear on COTI/)
    ).toBeInTheDocument();
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

  it('shows manual AES key input only when a submit callback is provided', () => {
    const { rerender } = render(<OnboardModal {...defaultProps} />);
    expect(screen.queryByLabelText('Input AES key')).not.toBeInTheDocument();

    rerender(<OnboardModal {...defaultProps} onManualAesKeySubmit={vi.fn()} />);
    expect(screen.getByLabelText('Input AES key')).toBeInTheDocument();
  });

  it('submits a normalized manual AES key', async () => {
    const onManualAesKeySubmit = vi.fn().mockResolvedValue(undefined);
    render(<OnboardModal {...defaultProps} onManualAesKeySubmit={onManualAesKeySubmit} />);

    fireEvent.click(screen.getByLabelText('Input AES key'));
    expect(screen.queryByText('Begin Onboarding')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Manual AES key'), {
      target: { value: 'ABCDEF0123456789ABCDEF0123456789' },
    });
    fireEvent.click(screen.getByLabelText('Use AES key'));

    await waitFor(() => {
      expect(onManualAesKeySubmit).toHaveBeenCalledWith(
        'abcdef0123456789abcdef0123456789',
        { saveBackup: true },
      );
    });
  });

  it('validates manual AES key format before submit', () => {
    const onManualAesKeySubmit = vi.fn();
    render(<OnboardModal {...defaultProps} onManualAesKeySubmit={onManualAesKeySubmit} />);

    fireEvent.click(screen.getByLabelText('Input AES key'));
    fireEvent.change(screen.getByLabelText('Manual AES key'), {
      target: { value: '0xabc' },
    });
    fireEvent.click(screen.getByLabelText('Use AES key'));

    expect(screen.getByText('Paste a 32-character AES key.')).toBeInTheDocument();
    expect(onManualAesKeySubmit).not.toHaveBeenCalled();
  });

  it('accepts a 0x-prefixed manual AES key', async () => {
    const onManualAesKeySubmit = vi.fn().mockResolvedValue(undefined);
    render(<OnboardModal {...defaultProps} onManualAesKeySubmit={onManualAesKeySubmit} />);

    fireEvent.click(screen.getByLabelText('Input AES key'));
    fireEvent.change(screen.getByLabelText('Manual AES key'), {
      target: { value: `0x${'a'.repeat(32)}` },
    });
    fireEvent.click(screen.getByLabelText('Use AES key'));

    await waitFor(() => {
      expect(onManualAesKeySubmit).toHaveBeenCalledWith('a'.repeat(32), { saveBackup: true });
    });
  });

  it('passes disabled backup preference to manual AES submit', async () => {
    const onManualAesKeySubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <OnboardModal
        {...defaultProps}
        saveBackup={false}
        onManualAesKeySubmit={onManualAesKeySubmit}
      />
    );

    fireEvent.click(screen.getByLabelText('Input AES key'));
    fireEvent.change(screen.getByLabelText('Manual AES key'), {
      target: { value: 'ABCDEF0123456789ABCDEF0123456789' },
    });
    fireEvent.click(screen.getByLabelText('Use AES key'));

    await waitFor(() => {
      expect(onManualAesKeySubmit).toHaveBeenCalledWith(
        'abcdef0123456789abcdef0123456789',
        { saveBackup: false },
      );
    });
  });

  it('returns to begin onboarding when manual input toggle is clicked again', () => {
    render(<OnboardModal {...defaultProps} onManualAesKeySubmit={vi.fn()} />);

    const inputToggle = screen.getByLabelText('Input AES key');
    expect(inputToggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(inputToggle);
    expect(screen.getByLabelText('Manual AES key')).toBeInTheDocument();
    expect(screen.getByLabelText('Hide AES key input')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByLabelText('Hide AES key input'));
    expect(screen.getByText('Begin Onboarding')).toBeInTheDocument();
    expect(screen.queryByLabelText('Manual AES key')).not.toBeInTheDocument();
  });

  it('shows retrieved AES key in an input with inline eye and copy controls', async () => {
    const aesKey = 'abcdef0123456789abcdef0123456789';
    render(<OnboardModal {...defaultProps} currentStep="complete" aesKey={aesKey} />);

    const keyInput = screen.getByLabelText('Retrieved AES key');
    expect(keyInput).toHaveAttribute('type', 'password');
    expect(keyInput).toHaveValue(aesKey);
    expect(screen.queryByText('Copy AES Key')).not.toBeInTheDocument();
    expect(screen.queryByText('Show AES Key')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Show AES key'));
    expect(keyInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByLabelText('Copy AES key'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(aesKey);
    });
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

  describe('MetaMask Snap install action', () => {
    it('renders normally and does not auto-call onConfirm for metamask + hasSnap', () => {
      const onConfirm = vi.fn();
      render(
        <OnboardModal {...defaultProps} walletType="metamask" hasSnap={true} onConfirm={onConfirm} />
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Begin Onboarding')).toBeInTheDocument();
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.queryByText('Install COTI Snap')).not.toBeInTheDocument();
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

    it('does not show a Snap install button in the modal', () => {
      const onConfirm = vi.fn();
      const onInstallSnap = vi.fn();

      render(
        <OnboardModal
          {...defaultProps}
          walletType="metamask"
          hasSnap={false}
          onConfirm={onConfirm}
          onInstallSnap={onInstallSnap}
        />
      );

      expect(screen.queryByText('Install COTI Snap')).not.toBeInTheDocument();
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByText('Begin Onboarding')).toBeInTheDocument();
    });
  });
});
