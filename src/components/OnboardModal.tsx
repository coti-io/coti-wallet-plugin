import React, { useEffect, useRef, useState } from 'react';
import type { WalletType } from '../hooks/useWalletType';
import type { OnboardingStep } from '../hooks/useAesKeyProvider';
import { ONBOARDING_STEPS } from '../hooks/useAesKeyProvider';

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
  /** Current onboarding step (for progress display) */
  currentStep?: OnboardingStep;
  /** Retrieved AES key (shown on success screen) */
  aesKey?: string | null;
  /** Whether MetaMask Snap is available for direct AES key retrieval */
  hasSnap?: boolean;
  /** Optional theme overrides for customizing the modal appearance */
  theme?: OnboardModalTheme;
}

/**
 * Theme override for the OnboardModal.
 * Each key corresponds to a style target. Provide a partial CSSProperties object
 * to override specific CSS properties while keeping the rest as defaults.
 */
export type OnboardModalTheme = {
  [K in keyof typeof defaultStyles]?: React.CSSProperties;
};

/** Inline styles for the modal — keeps the component self-contained without external UI deps */
const defaultStyles = {
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
    borderRadius: '16px',
    padding: '28px',
    width: '360px',
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
    top: '12px',
    right: '12px',
    padding: '8px',
    background: 'none',
    border: 'none',
    color: 'rgba(255, 255, 255, 0.3)',
    cursor: 'pointer',
    borderRadius: '50%',
    fontSize: '14px',
    lineHeight: 1,
    transition: 'color 0.2s',
  },
  iconContainer: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    backgroundColor: 'rgba(30, 41, 246, 0.1)',
    border: '1px solid rgba(30, 41, 246, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    lineHeight: 1.2,
    marginBottom: '10px',
    color: '#ffffff',
  },
  description: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '13px',
    lineHeight: 1.6,
    marginBottom: '16px',
    maxWidth: '90%',
  },
  infoBox: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '16px',
  },
  infoText: {
    fontSize: '11px',
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 1.6,
    margin: 0,
  },
  errorBox: {
    width: '100%',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '16px',
  },
  errorText: {
    fontSize: '12px',
    color: '#f87171',
    lineHeight: 1.5,
    margin: 0,
  },
  primaryButton: {
    width: '100%',
    padding: '10px 16px',
    backgroundColor: '#1E29F6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    marginBottom: '10px',
    transition: 'background-color 0.2s',
  },
  primaryButtonDisabled: {
    width: '100%',
    padding: '10px 16px',
    backgroundColor: 'rgba(30, 41, 246, 0.5)',
    color: 'rgba(255, 255, 255, 0.6)',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'not-allowed',
    marginBottom: '10px',
  },
  cancelButton: {
    background: 'none',
    border: 'none',
    fontSize: '12px',
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
  stepperContainer: {
    width: '100%',
    marginBottom: '16px',
  },
  stepItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '12px',
    textAlign: 'left' as const,
  },
  stepIconContainer: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepIconPending: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    border: '2px solid rgba(255, 255, 255, 0.2)',
  },
  stepIconActive: {
    backgroundColor: 'rgba(0, 229, 255, 0.1)',
    border: '2px solid #00E5FF',
  },
  stepIconComplete: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    border: '2px solid #22c55e',
  },
  stepIconError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '2px solid #ef4444',
  },
  stepContent: {
    flex: 1,
  },
  stepLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#ffffff',
    marginBottom: '4px',
  },
  stepDescription: {
    fontSize: '11px',
    color: 'rgba(255, 255, 255, 0.5)',
    lineHeight: 1.4,
  },
  aesKeyBox: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '16px',
    fontFamily: 'monospace',
    fontSize: '11px',
    color: '#00E5FF',
    wordBreak: 'break-all' as const,
    textAlign: 'left' as const,
  },
  copyButton: {
    width: '100%',
    padding: '8px 16px',
    backgroundColor: 'rgba(0, 229, 255, 0.1)',
    color: '#00E5FF',
    border: '1px solid rgba(0, 229, 255, 0.3)',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    marginBottom: '10px',
    transition: 'all 0.2s',
  },
  warningBox: {
    width: '100%',
    padding: '0',
    marginBottom: '12px',
  },
  warningText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '12px',
    lineHeight: 1.6,
    margin: 0,
    fontFamily: 'inherit',
  },
  calloutBox: {
    width: '100%',
    backgroundColor: 'rgba(0, 229, 255, 0.1)',
    border: '1px solid rgba(0, 229, 255, 0.3)',
    borderRadius: '8px',
    padding: '8px 12px',
    marginTop: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  calloutText: {
    fontSize: '11px',
    color: '#00E5FF',
    lineHeight: 1.4,
    margin: 0,
    textAlign: 'left' as const,
  },
} as const;

/** Merges default styles with optional theme overrides */
function mergeTheme(theme?: OnboardModalTheme) {
  if (!theme) return defaultStyles;
  const merged = { ...defaultStyles } as Record<string, React.CSSProperties>;
  for (const key of Object.keys(theme) as Array<keyof typeof defaultStyles>) {
    if (theme[key]) {
      merged[key] = { ...defaultStyles[key], ...theme[key] } as any;
    }
  }
  return merged as typeof defaultStyles;
}

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
    case 'metamask':
      return 'MetaMask';
    default:
      return 'your wallet';
  }
}

/**
 * Maps internal step IDs (including hidden ones) to the nearest visible step
 * for UI progress display purposes.
 */
function mapToVisibleStep(stepId: OnboardingStep): OnboardingStep {
  switch (stepId) {
    // Hidden steps that happen BEFORE signing-transaction
    case 'switching-network':
    case 'creating-provider':
      return 'signing-transaction';
    // Hidden steps that happen AFTER validating-key
    case 'restoring-network':
    case 'persisting-key':
      return 'validating-key';
    default:
      return stepId;
  }
}

/**
 * Determines the status of a step based on current progress.
 */
function getStepStatus(
  stepId: OnboardingStep,
  currentStep: OnboardingStep,
  hasError: boolean
): 'pending' | 'active' | 'complete' | 'error' {
  // Map the current step to its visible equivalent
  const visibleCurrentStep = mapToVisibleStep(currentStep);

  if (hasError && (currentStep === 'error' || visibleCurrentStep === 'error')) {
    return 'error';
  }

  const stepIndex = ONBOARDING_STEPS.findIndex(s => s.id === stepId);
  const currentIndex = ONBOARDING_STEPS.findIndex(s => s.id === visibleCurrentStep);

  // If current step maps to something not in the visible list, treat all as pending
  if (currentIndex === -1) return 'pending';

  if (visibleCurrentStep === 'complete') return 'complete';
  if (stepIndex < currentIndex) return 'complete';
  if (stepIndex === currentIndex) return 'active';
  return 'pending';
}

/**
 * OnboardModal — Multi-step modal for AES key retrieval onboarding.
 *
 * Screens:
 * 1. Intro: Explains the process before starting
 * 2. Progress: Shows step-by-step progress (steps 3-9)
 * 3. Success: Displays retrieved AES key with copy button
 * 4. Error: Shows error message with retry button
 */
export const OnboardModal: React.FC<OnboardModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoading,
  error,
  walletType,
  currentStep = 'idle',
  aesKey,
  hasSnap,
  theme,
}) => {
  // MetaMask + Snap bypass: skip modal entirely and trigger snap flow
  const snapBypassTriggered = useRef(false);
  const [copied, setCopied] = useState(false);
  const styles = mergeTheme(theme);

  useEffect(() => {
    if (isOpen && walletType === 'metamask' && hasSnap && !snapBypassTriggered.current) {
      snapBypassTriggered.current = true;
      onConfirm();
    }
  }, [isOpen, walletType, hasSnap, onConfirm]);

  // Reset the bypass flag and copied state when the modal closes
  useEffect(() => {
    if (!isOpen) {
      snapBypassTriggered.current = false;
      setCopied(false);
    }
  }, [isOpen]);

  if (isOpen && walletType === 'metamask' && hasSnap) {
    return null;
  }

  // Determine which screen to show
  const showIntro = currentStep === 'idle' && !error && !aesKey;
  const showProgress = isLoading || (currentStep !== 'idle' && currentStep !== 'complete' && currentStep !== 'error' && !aesKey);
  const showSuccess = currentStep === 'complete' && aesKey && !error;
  const showError = !!error || currentStep === 'error';

  const walletName = getWalletDisplayName(walletType);

  // Handle copy to clipboard
  const handleCopy = async () => {
    if (!aesKey) return;
    try {
      await navigator.clipboard.writeText(aesKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (!isOpen) {
    return null;
  }

  // Disable close button during signing-transaction step
  const canClose = currentStep !== 'signing-transaction';

  return (
    <>
      {/* Inject spinner keyframes */}
      <style>{SPINNER_KEYFRAMES}</style>

      {/* Backdrop */}
      <div
        style={styles.backdrop}
        onClick={canClose ? onClose : undefined}
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
          {canClose && (
            <button
              onClick={onClose}
              style={styles.closeButton}
              aria-label="Close"
            >
              ✕
            </button>
          )}

          {/* INTRO SCREEN */}
          {showIntro && (
            <>
              {/* Icon */}
              <div style={styles.iconContainer}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00E5FF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>

              <h2 id="onboard-modal-title" style={styles.title}>
                Onboard User
              </h2>

              <p id="onboard-modal-description" style={styles.description}>
                This will execute a transaction on the COTI Network to retrieve your AES encryption key.
              </p>

              <button
                onClick={onConfirm}
                style={styles.primaryButton}
              >
                Begin Onboarding
              </button>

              <button
                onClick={onClose}
                style={styles.cancelButton}
              >
                Cancel
              </button>
            </>
          )}

          {/* PROGRESS SCREEN */}
          {showProgress && (
            <>
              {/* Icon */}
              <div style={styles.iconContainer}>
                <div style={styles.spinner} />
              </div>

              <h2 id="onboard-modal-title" style={styles.title}>
                Onboarding in Progress
              </h2>

              <p id="onboard-modal-description" style={styles.description}>
                Please wait while we retrieve your AES encryption key...
              </p>

              {/* Step Progress */}
              <div style={styles.stepperContainer}>
                {ONBOARDING_STEPS.map((step) => {
                  const status = getStepStatus(step.id, currentStep, !!error);
                  const isActive = status === 'active';
                  const isComplete = status === 'complete';
                  const isError = status === 'error';

                  let iconStyle: React.CSSProperties = { ...styles.stepIconContainer, ...styles.stepIconPending };
                  if (isActive) iconStyle = { ...styles.stepIconContainer, ...styles.stepIconActive };
                  if (isComplete) iconStyle = { ...styles.stepIconContainer, ...styles.stepIconComplete };
                  if (isError) iconStyle = { ...styles.stepIconContainer, ...styles.stepIconError };

                  return (
                    <div key={step.id} style={styles.stepItem}>
                      <div style={iconStyle}>
                        {isComplete && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                        {isActive && <div style={{ ...styles.spinner, width: '12px', height: '12px' }} />}
                        {isError && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        )}
                      </div>
                      <div style={styles.stepContent}>
                        <div style={styles.stepLabel}>{step.label}</div>
                        <div style={styles.stepDescription}>{step.description}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Callout for signing step */}
              {currentStep === 'signing-transaction' && (
                <div style={styles.calloutBox}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <p style={styles.calloutText}>
                    <strong>Action Required:</strong> Please approve the transaction in {walletName}
                  </p>
                </div>
              )}
            </>
          )}

          {/* SUCCESS SCREEN */}
          {showSuccess && (
            <>
              {/* Icon */}
              <div style={styles.iconContainer}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>

              <h2 id="onboard-modal-title" style={styles.title}>
                Onboarding Complete
              </h2>

              <p id="onboard-modal-description" style={styles.description}>
                Your AES encryption key has been successfully retrieved. Copy and store it safely.
              </p>

              <div style={styles.aesKeyBox}>
                {aesKey}
              </div>

              <button
                onClick={handleCopy}
                style={styles.copyButton}
              >
                {copied ? '✓ Copied!' : 'Copy AES Key'}
              </button>

              <div style={styles.warningBox}>
                <p style={styles.warningText}>
                  ⚠️ <strong>Important:</strong> This key will be lost when you refresh the page. Store it in a secure location.
                </p>
              </div>

              <button
                onClick={onClose}
                style={styles.primaryButton}
              >
                Done
              </button>
            </>
          )}

          {/* ERROR SCREEN */}
          {showError && (
            <>
              {/* Icon */}
              <div style={styles.iconContainer}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#f87171"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>

              <h2 id="onboard-modal-title" style={styles.title}>
                Onboarding Failed
              </h2>

              <p id="onboard-modal-description" style={styles.description}>
                The onboarding process encountered an error. You can retry the signature request.
              </p>

              <div style={styles.errorBox}>
                <p style={styles.errorText}>{error || 'An unknown error occurred'}</p>
              </div>

              <button
                onClick={onConfirm}
                style={styles.primaryButton}
              >
                Retry
              </button>

              <button
                onClick={onClose}
                style={styles.cancelButton}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
};

/** Default styles exported for reference when building custom themes */
export { defaultStyles as onboardModalDefaultStyles };

export default OnboardModal;
