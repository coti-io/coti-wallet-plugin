import { beforeEach, describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OnboardModal } from '../../src/components/OnboardModal';
import { configureCotiPlugin } from '../../src/config/plugin';

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
    configureCotiPlugin({ debug: false });
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
    expect(screen.getByText('Onboard')).toBeInTheDocument();
    expect(screen.getByText('Save Locally')).toBeInTheDocument();
    const description = document.getElementById('onboard-modal-description');
    expect(description?.textContent).toContain(
      'Handling private data requires an encryption key -\u00A0a\u00A0COTI Network transaction retrieves it.',
    );
    const docsLink = screen.getByRole('link', { name: 'Learn more about onboarding' });
    expect(description).toContainElement(docsLink);
    expect(docsLink).toHaveAttribute(
      'href',
      'https://docs.coti.io/coti-documentation/build-on-coti/core-concepts/what-is-onboarding',
    );
    expect(docsLink).toHaveAttribute('target', '_blank');
    expect(docsLink).toHaveStyle({
      color: 'rgba(255, 255, 255, 0.55)',
      borderColor: 'rgba(255, 255, 255, 0.35)',
    });
    const backupDetails = screen.getByLabelText('How local save works');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.mouseEnter(backupDetails);
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Only an encrypted blob is stored locally. Restoring it requires a wallet signature.'
    );
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('shows progress screen title when in progress', () => {
    render(<OnboardModal {...defaultProps} isLoading={true} currentStep="preparing-onboard" />);
    expect(screen.getByText('Onboarding in Progress')).toBeInTheDocument();
  });

  it('does not render a main modal screen during backup signing', () => {
    render(<OnboardModal {...defaultProps} currentStep="signing-backup" />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Onboard User')).not.toBeInTheDocument();
    expect(screen.queryByText('Onboarding in Progress')).not.toBeInTheDocument();
    expect(screen.queryByText('Onboarding Complete!')).not.toBeInTheDocument();
    expect(screen.queryByText('Onboarding Failed')).not.toBeInTheDocument();
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
      screen.queryByText(/Waiting for the grant service to fund your wallet/)
    ).not.toBeInTheDocument();
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
    expect(screen.queryByText(/grant request was submitted/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Waiting for the funded balance to appear on COTI/)
    ).toBeInTheDocument();
  });

  it('shows callout text for the final progress steps', () => {
    const { rerender } = render(
      <OnboardModal
        {...defaultProps}
        isLoading={true}
        currentStep="retrieving-key"
      />
    );

    expect(screen.getByText(/Transaction submitted/i)).toBeInTheDocument();

    rerender(
      <OnboardModal
        {...defaultProps}
        isLoading={true}
        currentStep="validating-key"
      />
    );

    expect(screen.getByText(/Finalizing/i)).toBeInTheDocument();
  });

  it('shows error screen with message and retry button', () => {
    render(<OnboardModal {...defaultProps} error="Network timeout" />);
    expect(screen.getByText('Onboarding Failed')).toBeInTheDocument();
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('calls onConfirm when "Onboard" is clicked', () => {
    const onConfirm = vi.fn();
    render(<OnboardModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Onboard'));
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
    expect(screen.queryByText('Onboard')).not.toBeInTheDocument();
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

    expect(screen.getByText('Wrong AES key')).toBeInTheDocument();
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
    expect(screen.getByText('Onboard')).toBeInTheDocument();
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

  it('keeps the save option visible when local save is disabled', () => {
    render(<OnboardModal {...defaultProps} saveBackup={false} />);

    expect(screen.getByText('Save Locally')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles local save from the switch control', () => {
    const onSaveBackupChange = vi.fn();
    render(
      <OnboardModal
        {...defaultProps}
        onSaveBackupChange={onSaveBackupChange}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Disable local save' }));
    expect(onSaveBackupChange).toHaveBeenCalledWith(false);
  });

  it('hides the persisting step when local save is disabled', () => {
    render(
      <OnboardModal
        {...defaultProps}
        isLoading={true}
        currentStep="signing-transaction"
        saveBackup={false}
      />
    );

    expect(screen.queryByText('Persisting Key')).not.toBeInTheDocument();
    expect(screen.getByText('Preparing')).toBeInTheDocument();
    expect(screen.getByText('Sign Transaction')).toBeInTheDocument();
    expect(screen.getByText('Execute Transaction')).toBeInTheDocument();
  });

  it('keeps the persisting step for snap onboarding when local save is hidden', () => {
    render(
      <OnboardModal
        {...defaultProps}
        isLoading={true}
        currentStep="signing-transaction"
        saveBackup={false}
        showSaveBackupOption={false}
      />
    );

    expect(screen.getByText('Persisting Key')).toBeInTheDocument();
    expect(screen.queryByText('Save Locally')).not.toBeInTheDocument();
  });

  it('keeps checkbox and tooltip readable when app supplies a light theme', () => {
    const lightTheme = {
      modal: { backgroundColor: '#ffffff', color: '#0f172a' },
      title: { color: '#0f172a' },
      description: { color: '#64748b' },
    };

    render(<OnboardModal {...defaultProps} theme={lightTheme} onManualAesKeySubmit={vi.fn()} />);

    expect(screen.getByText('Onboard User')).toHaveStyle({ color: 'rgb(15, 23, 42)' });

    const saveTitle = screen.getByText('Save Locally');
    expect(saveTitle).toHaveStyle({ color: 'rgb(15, 23, 42)' });

    const tooltipButton = screen.getByLabelText('How local save works');
    expect(tooltipButton).toHaveStyle({
      color: 'rgb(100, 116, 139)',
      backgroundColor: 'rgba(15, 23, 42, 0.08)',
      borderColor: 'rgba(15, 23, 42, 0.2)',
    });

    expect(screen.getByText('Cancel')).toHaveStyle({ color: 'rgb(15, 23, 42)' });

    const docsLink = screen.getByRole('link', { name: 'Learn more about onboarding' });
    expect(docsLink).toHaveStyle({
      color: 'rgb(100, 116, 139)',
      borderColor: 'rgba(15, 23, 42, 0.16)',
    });

    fireEvent.click(screen.getByLabelText('Input AES key'));
    expect(screen.getByLabelText('Manual AES key')).toHaveStyle({
      backgroundColor: 'rgb(241, 245, 249)',
      color: 'rgb(15, 23, 42)',
    });
  });

  it('keeps the save switch off state visible on light themes', () => {
    const lightTheme = {
      modal: { backgroundColor: '#ffffff', color: '#0f172a' },
      title: { color: '#0f172a' },
      primaryButton: { backgroundColor: '#1E29F6' },
    };

    render(<OnboardModal {...defaultProps} theme={lightTheme} saveBackup={false} />);

    const saveSwitch = screen.getByRole('switch', { name: 'Enable local save' });
    expect(saveSwitch).toHaveStyle({
      backgroundColor: 'rgba(15, 23, 42, 0.2)',
      borderColor: 'rgba(15, 23, 42, 0.34)',
    });
  });

  it('shows only the intro warning on the first screen', () => {
    render(
      <OnboardModal
        {...defaultProps}
        warnings={{
          intro: 'Portal disclaimer',
          progress: 'Should not show yet',
        }}
      />
    );

    expect(screen.getByText('Portal disclaimer')).toBeInTheDocument();
    expect(screen.queryByText('Should not show yet')).not.toBeInTheDocument();
  });

  it('prefers runtime warnings over app warnings on the same page', () => {
    render(
      <OnboardModal
        {...defaultProps}
        isLoading
        currentStep="signing-transaction"
        warnings={{ progress: 'App progress warning' }}
        runtimeWarnings={{ progress: 'Runtime progress warning' }}
      />
    );

    expect(screen.getByText('Runtime progress warning')).toBeInTheDocument();
    expect(screen.queryByText('App progress warning')).not.toBeInTheDocument();
  });

  it('keeps warning note padding when host theme zeroes it out', () => {
    const lightTheme = {
      modal: { backgroundColor: '#ffffff', color: '#0f172a' },
      title: { color: '#0f172a' },
      warningBox: { padding: '0' },
    };

    render(
      <OnboardModal
        {...defaultProps}
        theme={lightTheme}
        currentStep="complete"
        aesKey="abcdef0123456789abcdef0123456789"
      />
    );

    const note = screen.getByText(/Important:/).closest('div');
    expect(note).toHaveStyle({ padding: '12px' });
  });
});
