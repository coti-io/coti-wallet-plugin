import React, { useEffect, useState } from 'react';
import type { WalletType } from '../hooks/useWalletType';
import type { OnboardingStep } from '../hooks/useAesKeyProvider';
import { ONBOARDING_STEPS } from '../hooks/useAesKeyProvider';
import { normalizeAesKey } from '../crypto/aesKey';

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
  /** Timestamped onboarding trace (shown on error when debug is enabled or trace is non-empty) */
  debugTrace?: string[];
  /** Installs/connects the COTI Snap for MetaMask users */
  onInstallSnap?: () => boolean | Promise<boolean>;
  /** Whether the Snap install/connect request is in progress */
  isInstallingSnap?: boolean;
  /** Error message from Snap install/connect, or null */
  snapError?: string | null;
  /** Whether encrypted AES backup should be saved after contract onboarding */
  saveBackup?: boolean;
  /** When false, hides the encrypted-backup checkbox (e.g. MetaMask Snap stores the key). */
  showSaveBackupOption?: boolean;
  /** Called when the encrypted-backup checkbox changes */
  onSaveBackupChange?: (saveBackup: boolean) => void;
  /** Called when the user manually submits an AES key instead of onboarding */
  onManualAesKeySubmit?: (
    aesKey: string,
    options: { saveBackup: boolean },
  ) => void | Promise<void>;
  /** Non-blocking warning from restore/backup flows */
  warning?: string | null;
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
    boxSizing: 'border-box' as const,
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
    boxSizing: 'border-box' as const,
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
    boxSizing: 'border-box' as const,
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
  checkboxRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '14px',
    textAlign: 'center' as const,
  },
  checkbox: {
    margin: 0,
    accentColor: '#1E29F6',
  },
  checkboxText: {
    fontSize: '11px',
    lineHeight: 1.5,
  },
  tooltipWrap: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tooltipButton: {
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    border: '1px solid rgba(255, 255, 255, 0.25)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '9px',
    lineHeight: 1,
    padding: 0,
    cursor: 'help',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
  },
  tooltipBubble: {
    position: 'absolute' as const,
    bottom: 'calc(100% + 8px)',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '220px',
    boxSizing: 'border-box' as const,
    padding: '8px 10px',
    borderRadius: '8px',
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: '11px',
    lineHeight: 1.4,
    textAlign: 'left' as const,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
    zIndex: 1,
  },
  actionRow: {
    width: '100%',
    display: 'flex',
    gap: '8px',
    alignItems: 'stretch',
    marginBottom: '10px',
  },
  actionPrimary: {
    flex: 1,
    minWidth: 0,
  },
  iconButton: {
    width: '42px',
    minWidth: '42px',
    boxSizing: 'border-box' as const,
    padding: '9px',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  iconButtonPressed: {
    width: '42px',
    minWidth: '42px',
    boxSizing: 'border-box' as const,
    padding: '9px',
    backgroundColor: 'rgba(30, 41, 246, 0.22)',
    color: '#00E5FF',
    border: '1px solid rgba(0, 229, 255, 0.45)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: 'inset 0 2px 6px rgba(0, 0, 0, 0.35)',
  },
  iconButtonDisabled: {
    width: '42px',
    minWidth: '42px',
    boxSizing: 'border-box' as const,
    padding: '9px',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    color: 'rgba(255, 255, 255, 0.35)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'not-allowed',
  },
  manualKeyInput: {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box' as const,
    padding: '10px 12px',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.16)',
    borderRadius: '8px',
    fontSize: '12px',
    fontFamily: 'monospace',
    outline: 'none',
  },
  manualKeyErrorText: {
    fontSize: '11px',
    color: '#b91c1c',
    lineHeight: 1.5,
    margin: '-4px 0 10px',
    textAlign: 'left' as const,
    width: '100%',
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
    boxSizing: 'border-box' as const,
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
  keyInputWrap: {
    width: '100%',
    boxSizing: 'border-box' as const,
    position: 'relative' as const,
    marginBottom: '16px',
  },
  keyInput: {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '12px 82px 12px 12px',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    color: '#00E5FF',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    fontFamily: 'monospace',
    fontSize: '11px',
    outline: 'none',
  },
  keyInputActions: {
    position: 'absolute' as const,
    top: '50%',
    right: '8px',
    transform: 'translateY(-50%)',
    display: 'flex',
    gap: '4px',
  },
  inlineIconButton: {
    width: '30px',
    height: '30px',
    borderRadius: '6px',
    border: '1px solid rgba(0, 229, 255, 0.25)',
    backgroundColor: 'rgba(0, 229, 255, 0.08)',
    color: '#00E5FF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  warningBox: {
    width: '100%',
    boxSizing: 'border-box' as const,
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    border: '1px solid rgba(251, 191, 36, 0.3)',
    borderRadius: '8px',
    padding: '8px',
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
    boxSizing: 'border-box' as const,
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
  debugBox: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    padding: '10px',
    marginBottom: '16px',
    maxHeight: '140px',
    overflowY: 'auto' as const,
    textAlign: 'left' as const,
  },
  debugLine: {
    fontSize: '10px',
    fontFamily: 'monospace',
    color: 'rgba(255, 255, 255, 0.55)',
    lineHeight: 1.5,
    margin: '0 0 2px 0',
    wordBreak: 'break-all' as const,
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

function parseColorToRgb(
  color: string,
): { r: number; g: number; b: number; alpha: number } | null {
  const normalized = color.trim();

  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
        alpha: 1,
      };
    }
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      alpha: 1,
    };
  }

  const rgbMatch = normalized.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9]*\.?[0-9]+))?\s*\)$/i,
  );
  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
      alpha: rgbMatch[4] ? Number(rgbMatch[4]) : 1,
    };
  }

  return null;
}

function isLightBackgroundColor(color: string | undefined): boolean {
  if (!color) return false;
  const rgb = parseColorToRgb(color);
  if (!rgb) return false;

  const { r, g, b, alpha } = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) * alpha;
  return luminance >= 150;
}

function getWarningStyles(styles: typeof defaultStyles) {
  const lightTheme = isLightBackgroundColor(
    typeof styles.modal.backgroundColor === 'string'
      ? styles.modal.backgroundColor
      : undefined,
  );

  if (lightTheme) {
    return {
      box: {
        ...styles.warningBox,
        backgroundColor: 'rgba(245, 158, 11, 0.14)',
        border: '1px solid rgba(180, 83, 9, 0.35)',
      },
      text: {
        ...styles.warningText,
        color: '#78350f',
      },
    };
  }

  return {
    box: styles.warningBox,
    text: {
      ...styles.warningText,
      color: '#fef3c7',
    },
  };
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
    case 'rainbow':
      return 'Rainbow Wallet';
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
    case 'restoring-backup':
    case 'granting-funds':
    case 'waiting-for-funds':
    case 'switching-network':
    case 'creating-provider':
      return 'signing-transaction';
    // Hidden steps that happen AFTER retrieving-key
    case 'validating-key':
    case 'restoring-network':
    case 'persisting-key':
    case 'saving-backup':
      return 'persisting-key';
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

function getProgressTitle(currentStep: OnboardingStep): string {
  if (currentStep === 'granting-funds') return 'Requesting COTI Grant';
  if (currentStep === 'waiting-for-funds') return 'Waiting for Grant Funds';
  return 'Onboarding in Progress';
}

function getProgressDescription(currentStep: OnboardingStep): string {
  if (currentStep === 'granting-funds') {
    return 'Waiting for the grant service to fund your wallet before onboarding continues...';
  }
  if (currentStep === 'waiting-for-funds') {
    return 'The grant request was submitted. Waiting for the native COTI balance to update...';
  }
  return 'Please wait while we retrieve your AES encryption key...';
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
  debugTrace,
  saveBackup = true,
  showSaveBackupOption = true,
  onSaveBackupChange,
  onManualAesKeySubmit,
  warning,
  theme,
}) => {
  const [copied, setCopied] = useState(false);
  const [isAesVisible, setIsAesVisible] = useState(false);
  const [showManualKeyInput, setShowManualKeyInput] = useState(false);
  const [manualAesKey, setManualAesKey] = useState('');
  const [manualAesKeyError, setManualAesKeyError] = useState<string | null>(null);
  const [isSubmittingManualKey, setIsSubmittingManualKey] = useState(false);
  const [showBackupTooltip, setShowBackupTooltip] = useState(false);
  const styles = mergeTheme(theme);
  const warningStyles = getWarningStyles(styles);

  // Reset local UI state when the modal closes
  useEffect(() => {
    if (!isOpen) {
      setCopied(false);
      setIsAesVisible(false);
      setShowManualKeyInput(false);
      setManualAesKey('');
      setManualAesKeyError(null);
      setIsSubmittingManualKey(false);
      setShowBackupTooltip(false);
    }
  }, [isOpen]);

  // Determine which screen to show
  const showIntro = currentStep === 'idle' && !error && !aesKey;
  const showProgress = isLoading || (currentStep !== 'idle' && currentStep !== 'complete' && currentStep !== 'error' && !aesKey);
  const showSuccess = currentStep === 'complete' && aesKey && !error;
  const showError = !!error || currentStep === 'error';

  const walletName = getWalletDisplayName(walletType);
  const showDebugTrace = (debugTrace?.length ?? 0) > 0;

  const renderDebugTrace = () => {
    if (!showDebugTrace || !debugTrace) return null;
    return (
      <div style={styles.debugBox} aria-label="Onboarding debug trace">
        <p style={{ ...styles.stepLabel, marginBottom: 6 }}>Debug trace</p>
        {debugTrace.map((line) => (
          <p key={line} style={styles.debugLine}>{line}</p>
        ))}
      </div>
    );
  };
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

  const handleManualAesKeySubmit = async () => {
    if (!onManualAesKeySubmit) return;

    const key = manualAesKey.trim();
    setManualAesKeyError(null);

    if (!key) {
      setManualAesKeyError('AES key is required.');
      return;
    }

    let normalizedKey: string;
    try {
      normalizedKey = normalizeAesKey(key);
    } catch {
      setManualAesKeyError('Paste a 32-character AES key.');
      return;
    }

    setIsSubmittingManualKey(true);
    try {
      await onManualAesKeySubmit(normalizedKey, { saveBackup });
      setManualAesKey('');
      setShowManualKeyInput(false);
    } catch (err: any) {
      setManualAesKeyError(err?.message || 'Could not save AES key.');
    } finally {
      setIsSubmittingManualKey(false);
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

              <div style={styles.checkboxRow}>
                {showSaveBackupOption && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={saveBackup}
                    onChange={(event) => onSaveBackupChange?.(event.target.checked)}
                    style={styles.checkbox}
                  />
                  <span style={styles.checkboxText}>
                    Save encrypted backup
                  </span>
                </label>
                )}
                {showSaveBackupOption && (
                <span style={styles.tooltipWrap}>
                  <button
                    type="button"
                    aria-label="Backup details"
                    aria-describedby={showBackupTooltip ? 'backup-details-tooltip' : undefined}
                    onMouseEnter={() => setShowBackupTooltip(true)}
                    onMouseLeave={() => setShowBackupTooltip(false)}
                    onFocus={() => setShowBackupTooltip(true)}
                    onBlur={() => setShowBackupTooltip(false)}
                    style={styles.tooltipButton}
                  >
                    ?
                  </button>
                  {showBackupTooltip && (
                    <span id="backup-details-tooltip" role="tooltip" style={styles.tooltipBubble}>
                      Only the encrypted blob is stored. Restoring it requires a wallet signature.
                    </span>
                  )}
                </span>
                )}
              </div>

              {warning && (
                <div style={warningStyles.box}>
                  <p style={warningStyles.text}>{warning}</p>
                </div>
              )}

              <div style={styles.actionRow}>
                {showManualKeyInput ? (
                  <>
                    <input
                      type="text"
                      value={manualAesKey}
                      onChange={(event) => setManualAesKey(event.target.value)}
                      placeholder="Paste AES key"
                      aria-label="Manual AES key"
                      disabled={isSubmittingManualKey}
                      style={{ ...styles.manualKeyInput, ...styles.actionPrimary }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={handleManualAesKeySubmit}
                      disabled={isSubmittingManualKey || !manualAesKey.trim()}
                      aria-label="Use AES key"
                      style={isSubmittingManualKey || !manualAesKey.trim() ? styles.iconButtonDisabled : styles.iconButton}
                    >
                      {isSubmittingManualKey ? (
                        <div style={{ ...styles.spinner, width: '14px', height: '14px' }} />
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={onConfirm}
                    style={{ ...styles.primaryButton, ...styles.actionPrimary, marginBottom: 0 }}
                  >
                    Begin Onboarding
                  </button>
                )}

                {onManualAesKeySubmit && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowManualKeyInput((visible) => !visible);
                      setManualAesKey('');
                      setManualAesKeyError(null);
                    }}
                    disabled={isSubmittingManualKey}
                    aria-label={showManualKeyInput ? 'Hide AES key input' : 'Input AES key'}
                    aria-pressed={showManualKeyInput}
                    title={showManualKeyInput ? 'Hide AES key input' : 'Input AES key'}
                    style={showManualKeyInput ? styles.iconButtonPressed : styles.iconButton}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
                    </svg>
                  </button>
                )}
              </div>

              {manualAesKeyError && (
                <p style={styles.manualKeyErrorText}>{manualAesKeyError}</p>
              )}

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
                {getProgressTitle(currentStep)}
              </h2>

              <p id="onboard-modal-description" style={styles.description}>
                {getProgressDescription(currentStep)}
              </p>

              {warning && (
                <div style={warningStyles.box}>
                  <p style={warningStyles.text}>{warning}</p>
                </div>
              )}

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
              {currentStep === 'granting-funds' && (
                <div style={styles.calloutBox}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  <p style={styles.calloutText}>
                    <strong>Funding in progress:</strong> Requesting native COTI from the grant service.
                  </p>
                </div>
              )}

              {currentStep === 'waiting-for-funds' && (
                <div style={styles.calloutBox}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M4 12h4l2-4 4 8 2-4h4" />
                  </svg>
                  <p style={styles.calloutText}>
                    <strong>Grant submitted:</strong> Waiting for the funded balance to appear on COTI.
                  </p>
                </div>
              )}

              {currentStep === 'signing-transaction' && (
                <div style={styles.calloutBox}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <p style={styles.calloutText}>
                    <strong>Action Required:</strong> Please approve the transaction in {walletName}
                    {walletType === 'metamask' && (
                      <> — you may see two prompts (message signature, then on-chain transaction)</>
                    )}
                  </p>
                </div>
              )}

              {renderDebugTrace()}
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
                Your AES encryption key has been successfully retrieved.
              </p>

              <div style={styles.keyInputWrap}>
                <input
                  type={isAesVisible ? 'text' : 'password'}
                  value={aesKey}
                  readOnly
                  aria-label="Retrieved AES key"
                  style={styles.keyInput}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div style={styles.keyInputActions}>
                  <button
                    type="button"
                    onClick={() => setIsAesVisible((visible) => !visible)}
                    aria-label={isAesVisible ? 'Hide AES key' : 'Show AES key'}
                    title={isAesVisible ? 'Hide AES key' : 'Show AES key'}
                    style={styles.inlineIconButton}
                  >
                    {isAesVisible ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.06" />
                        <path d="M9.9 4.24A10.45 10.45 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
                        <path d="M1 1l22 22" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label="Copy AES key"
                    title={copied ? 'Copied' : 'Copy AES key'}
                    style={styles.inlineIconButton}
                  >
                    {copied ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div style={warningStyles.box}>
                <p style={warningStyles.text}>
                  <strong>Important:</strong> {saveBackup ? 'An encrypted backup can help restore this key later, but you should still store it safely.' : 'This key will be lost when you refresh the page. Store it in a secure location.'}
                </p>
              </div>

              {warning && (
                <div style={warningStyles.box}>
                  <p style={warningStyles.text}>{warning}</p>
                </div>
              )}

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

              {renderDebugTrace()}

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
