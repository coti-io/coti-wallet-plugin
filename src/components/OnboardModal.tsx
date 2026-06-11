import React, { useEffect } from 'react';
import type { WalletType } from '../hooks/useWalletType';

/**
 * Props for the OnboardModal component.
 */
export interface OnboardModalProps {
  /** Whether the modal is currently visible */
  isOpen: boolean;
  /** Callback to close the modal without completing onboarding */
  onClose: () => void;
  /** Callback to initiate or retry the onboarding signature flow */
  onConfirm: () => void;
  /** Whether the generateOrRecoverAes() call is in progress */
  isLoading: boolean;
  /** Error message from a failed onboarding attempt, or null */
  error: string | null;
  /** The type of wallet connected (for display purposes) */
  walletType: WalletType;
  /** Optional: sessionAesKey from context — when set, modal auto-closes */
  sessionAesKey?: string | null;
}

/** Inline styles for the modal — keeps the component self-contained without external UI deps */
const styles = {
  backdrop: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(4px)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
  },
  modal: {
    backgroundColor: '#04133D',
    borderRadius: '24px',
    padding: '48px',
    width: '510px',
    maxWidth: '100%',
    position: 'relative' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    textAlign: 'center' as const,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  closeButton: {
    position: 'absolute' as const,
    top: '20px',
    right: '20px',
    padding: '8px',
    background: 'none',
    border: 'none',
    color: 'rgba(255, 255, 255, 0.3)',
    cursor: 'pointer',
    borderRadius: '50%',
    fontSize: '18px',
    lineHeight: 1,
    transition: 'color 0.2s',
  },
  iconContainer: {
    width: '80px',
    height: '80px',
    borderRadius: '16px',
    backgroundColor: 'rgba(30, 41, 246, 0.1)',
    border: '1px solid rgba(30, 41, 246, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '32px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    lineHeight: 1.2,
    marginBottom: '16px',
    color: '#ffffff',
  },
  description: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '15px',
    lineHeight: 1.6,
    marginBottom: '32px',
    maxWidth: '90%',
  },
  infoBox: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '32px',
  },
  infoText: {
    fontSize: '12px',
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 1.6,
    margin: 0,
  },
  errorBox: {
    width: '100%',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '32px',
  },
  errorText: {
    fontSize: '13px',
    color: '#f87171',
    lineHeight: 1.5,
    margin: 0,
  },
  primaryButton: {
    width: '100%',
    padding: '14px 24px',
    backgroundColor: '#1E29F6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '18px',
    fontWeight: 500,
    cursor: 'pointer',
    marginBottom: '16px',
    transition: 'background-color 0.2s',
  },
  primaryButtonDisabled: {
    width: '100%',
    padding: '14px 24px',
    backgroundColor: 'rgba(30, 41, 246, 0.5)',
    color: 'rgba(255, 255, 255, 0.6)',
    border: 'none',
    borderRadius: '12px',
    fontSize: '18px',
    fontWeight: 500,
    cursor: 'not-allowed',
    marginBottom: '16px',
  },
  cancelButton: {
    background: 'none',
    border: 'none',
    fontSize: '14px',
    color: 'rgba(255, 255, 255, 0.4)',
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'color 0.2s',
  },
  spinner: {
    display: 'inline-block',
    width: '20px',
    height: '20px',
    border: '2px solid rgba(255, 255, 255, 0.3)',
    borderTopColor: '#ffffff',
    borderRadius: '50%',
    animation: 'onboard-spin 0.8s linear infinite',
  },
  spinnerContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '16px',
    marginBottom: '32px',
  },
  spinnerText: {
    fontSize: '14px',
    color: 'rgba(255, 255, 255, 0.6)',
  },
} as const;

/** CSS keyframes for the spinner animation, injected once */
const SPINNER_KEYFRAMES = `
@keyframes onboard-spin {
  to { transform: rotate(360deg); }
}
`;

/**
 * Returns a human-readable wallet name for display.
 */
function getWalletDisplayName(walletType: WalletType): string {
  switch (walletType) {
    case 'coinbase':
      return 'Coinbase Wallet';
    case 'walletconnect':
      return 'WalletConnect';
    case 'rainbow':
      return 'Rainbow';
    case 'metamask':
      return 'MetaMask';
    default:
      return 'your wallet';
  }
}

/**
 * OnboardModal — explains the onboarding signature request to non-MetaMask wallet users.
 *
 * States:
 * - Idle: explains that a signature is needed for AES key retrieval via COTI onboarding contract
 * - Loading: shows spinner while `generateOrRecoverAes()` is in progress
 * - Error: shows error message with retry button
 * - Success: auto-closes when context has `sessionAesKey` set
 *
 * If the user closes without completing onboarding, `sessionAesKey` remains null.
 */
export const OnboardModal: React.FC<OnboardModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  error,
  walletType,
  sessionAesKey,
}) => {
  // Auto-close on success: when sessionAesKey becomes set while modal is open
  useEffect(() => {
    if (isOpen && sessionAesKey) {
      onClose();
    }
  }, [isOpen, sessionAesKey, onClose]);

  if (!isOpen) {
    return null;
  }

  const walletName = getWalletDisplayName(walletType);

  return (
    <>
      {/* Inject spinner keyframes */}
      <style>{SPINNER_KEYFRAMES}</style>

      {/* Backdrop */}
      <div
        style={styles.backdrop}
        onClick={onClose}
        role="presentation"
      >
        {/* Modal */}
        <div
          style={styles.modal}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboard-modal-title"
          aria-describedby="onboard-modal-description"
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            style={styles.closeButton}
            aria-label="Close"
            disabled={isLoading}
          >
            ✕
          </button>

          {/* Icon */}
          <div style={styles.iconContainer}>
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke={error ? '#f87171' : '#00E5FF'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {error ? (
                <>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </>
              ) : (
                <>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 12 15 16 10" />
                </>
              )}
            </svg>
          </div>

          {/* Title */}
          <h2 id="onboard-modal-title" style={styles.title}>
            {error
              ? 'Onboarding Failed'
              : isLoading
                ? 'Signing in Progress'
                : 'Onboarding Required'}
          </h2>

          {/* Description */}
          <p id="onboard-modal-description" style={styles.description}>
            {error
              ? 'The onboarding process encountered an error. You can retry the signature request.'
              : isLoading
                ? `Please confirm the signature request in ${walletName} to complete onboarding.`
                : `To view and manage your private balances, ${walletName} needs to sign a message to retrieve your AES encryption key via the COTI onboarding contract.`}
          </p>

          {/* Loading State */}
          {isLoading && (
            <div style={styles.spinnerContainer}>
              <div style={styles.spinner} />
              <span style={styles.spinnerText}>
                Waiting for wallet signature...
              </span>
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div style={styles.errorBox}>
              <p style={styles.errorText}>{error}</p>
            </div>
          )}

          {/* Info Box (idle state only) */}
          {!error && !isLoading && (
            <div style={styles.infoBox}>
              <p style={styles.infoText}>
                This is a one-time signature that generates or recovers your AES key from the COTI
                onboarding contract. Your key is stored only in memory and never persisted to browser
                storage.
              </p>
            </div>
          )}

          {/* Primary Action Button */}
          {!isLoading && (
            <button
              onClick={onConfirm}
              /* v8 ignore next -- unreachable: primary button hidden while isLoading */
              style={isLoading ? styles.primaryButtonDisabled : styles.primaryButton}
              disabled={isLoading}
            >
              {error ? 'Retry' : 'Sign & Onboard'}
            </button>
          )}

          {/* Cancel Button */}
          <button
            onClick={onClose}
            style={styles.cancelButton}
            disabled={isLoading}
          >
            {isLoading ? 'Please wait...' : 'Cancel'}
          </button>
        </div>
      </div>
    </>
  );
};

export default OnboardModal;
