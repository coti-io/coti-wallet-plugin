import React, { useEffect, useState } from 'react';
import type { WalletType } from '../hooks/useWalletType';
import type { OnboardingStep } from '../hooks/useAesKeyProvider';
import { normalizeAesKey } from '../crypto/aesKey';
import { getWalletDisplayName } from '../lib/walletDisplayName';
import {
  getDisplayOnboardingSteps,
  getOnboardingStepStatus,
  getProgressTitle,
} from '../lib/onboardingProgressDisplay';
import { deriveOnboardScreen } from './onboard/deriveOnboardScreen';
import { logger } from '../lib/logger';
import {
  type OnboardModalPage,
  type OnboardModalWarnings,
  resolveOnboardPageWarning,
} from '../lib/onboardModalWarnings';

export type { OnboardModalPage, OnboardModalWarnings };

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
  /** App-configured warning copy, one message per onboard screen */
  warnings?: OnboardModalWarnings;
  /** Runtime warnings from unlock/onboarding flows, one message per screen */
  runtimeWarnings?: OnboardModalWarnings;
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
    color: '#ffffff',
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
  titleRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    marginBottom: '16px',
  },
  iconContainer: {
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    backgroundColor: 'rgba(30, 41, 246, 0.1)',
    border: '1px solid rgba(30, 41, 246, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    lineHeight: 1.2,
    margin: 0,
    color: '#ffffff',
    textAlign: 'left' as const,
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
  saveOptionCard: {
    width: '100%',
    boxSizing: 'border-box' as const,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    marginBottom: '12px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    textAlign: 'left' as const,
  },
  saveOptionCardActive: {
    border: '1px solid rgba(0, 229, 255, 0.35)',
    backgroundColor: 'rgba(0, 229, 255, 0.06)',
  },
  saveOptionIconWrap: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    backgroundColor: 'rgba(0, 229, 255, 0.1)',
    border: '1px solid rgba(0, 229, 255, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color: '#00E5FF',
  },
  saveOptionBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    minHeight: '32px',
  },
  saveOptionTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
  },
  saveOptionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: '14px',
    color: '#ffffff',
    display: 'inline-flex',
    alignItems: 'center',
  },
  saveOptionSwitchTrack: {
    position: 'relative' as const,
    width: '42px',
    height: '24px',
    boxSizing: 'border-box' as const,
    borderRadius: '999px',
    border: '1px solid transparent',
    padding: 0,
    flexShrink: 0,
    cursor: 'pointer',
    transition: 'background-color 0.2s, border-color 0.2s',
  },
  saveOptionSwitchTrackOn: {
    backgroundColor: '#00E5FF',
    borderColor: 'rgba(0, 229, 255, 0.45)',
  },
  saveOptionSwitchTrackOff: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  saveOptionSwitchKnob: {
    position: 'absolute' as const,
    top: '50%',
    left: '2px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    transition: 'transform 0.2s',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.25)',
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
    boxSizing: 'border-box' as const,
    borderRadius: '50%',
    border: '1px solid rgba(255, 255, 255, 0.25)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: '9px',
    lineHeight: '12px',
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
    minHeight: '48px',
  },
  actionPrimary: {
    flex: 1,
    minWidth: 0,
    minHeight: '48px',
    boxSizing: 'border-box' as const,
  },
  actionFieldButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 16px',
    marginBottom: 0,
  },
  iconButton: {
    width: '48px',
    minWidth: '48px',
    height: '48px',
    minHeight: '48px',
    boxSizing: 'border-box' as const,
    padding: '0',
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
    width: '48px',
    minWidth: '48px',
    height: '48px',
    minHeight: '48px',
    boxSizing: 'border-box' as const,
    padding: '0',
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
    width: '48px',
    minWidth: '48px',
    height: '48px',
    minHeight: '48px',
    boxSizing: 'border-box' as const,
    padding: '0',
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
    height: '48px',
    minHeight: '48px',
    boxSizing: 'border-box' as const,
    padding: '0 12px',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.16)',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'monospace',
    outline: 'none',
  },
  manualKeyErrorRow: {
    width: '100%',
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    margin: '0 0 10px',
  },
  manualKeyErrorColumn: {
    flex: 1,
    minWidth: 0,
    minHeight: '17px',
  },
  actionSideSpacer: {
    width: '48px',
    minWidth: '48px',
    flexShrink: 0,
  },
  manualKeyErrorText: {
    fontSize: '11px',
    color: '#b91c1c',
    lineHeight: 1.5,
    margin: 0,
    paddingLeft: '12px',
    textAlign: 'left' as const,
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
    padding: '12px',
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
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  progressCalloutSlot: {
    width: '100%',
    minHeight: '58px',
    marginTop: '10px',
    marginBottom: '4px',
    display: 'flex',
    alignItems: 'flex-start',
  },
  calloutText: {
    fontSize: '11px',
    color: '#00E5FF',
    lineHeight: 1.4,
    margin: 0,
    textAlign: 'left' as const,
  },
} as const;

type OnboardStyleKey = keyof typeof defaultStyles;

/** Style targets apps can override via `privateUnlock.theme`. */
export const ONBOARD_MODAL_STYLE_KEYS = Object.keys(defaultStyles) as OnboardStyleKey[];

const FOREGROUND_TEXT_KEYS: OnboardStyleKey[] = [
  'infoText',
  'stepLabel',
  'manualKeyInput',
  'iconButton',
  'title',
  'saveOptionTitle',
];
const MUTED_TEXT_KEYS: OnboardStyleKey[] = [
  'closeButton',
  'tooltipButton',
  'cancelButton',
  'stepDescription',
];
const ACCENT_TEXT_KEYS: OnboardStyleKey[] = [
  'keyInput',
  'aesKeyBox',
  'calloutText',
  'inlineIconButton',
  'iconButtonPressed',
];

function isDefaultDarkThemeTextColor(color?: string): boolean {
  if (!color) return true;
  const normalized = color.trim().toLowerCase();
  return (
    normalized === '#ffffff'
    || normalized === '#00e5ff'
    || normalized.startsWith('rgba(255, 255, 255')
  );
}

/**
 * When the host app passes a theme, fill unthemed text targets that still use
 * the plugin's dark-mode defaults so light palettes stay readable.
 */
function applyThemePaletteGaps(
  merged: Record<OnboardStyleKey, React.CSSProperties>,
  theme: OnboardModalTheme,
) {
  const foreground =
    theme.title?.color
    ?? theme.modal?.color
    ?? theme.infoText?.color;
  const muted = theme.description?.color ?? theme.cancelButton?.color;
  const accent =
    theme.primaryButton?.backgroundColor
    ?? theme.calloutText?.color
    ?? theme.aesKeyBox?.color
    ?? theme.keyInput?.color;

  const fillText = (keys: OnboardStyleKey[], color?: string) => {
    if (!color) return;
    for (const key of keys) {
      if (theme[key]) continue;
      const currentColor = merged[key]?.color;
      if (!isDefaultDarkThemeTextColor(
        typeof currentColor === 'string' ? currentColor : undefined,
      )) {
        continue;
      }
      merged[key] = { ...merged[key], color };
    }
  };

  fillText(FOREGROUND_TEXT_KEYS, foreground);
  fillText(MUTED_TEXT_KEYS, muted);
  fillText(ACCENT_TEXT_KEYS, accent);
}

const LIGHT_INTERACTIVE_SURFACE_KEYS: OnboardStyleKey[] = [
  'closeButton',
  'cancelButton',
  'iconButton',
  'iconButtonPressed',
  'iconButtonDisabled',
  'inlineIconButton',
  'manualKeyInput',
  'keyInput',
  'aesKeyBox',
  'calloutBox',
  'iconContainer',
  'saveOptionCard',
  'saveOptionIconWrap',
  'saveOptionSwitchTrackOff',
  'saveOptionSwitchTrackOn',
  'tooltipButton',
];

function isDefaultDarkSurfaceBackground(backgroundColor?: string): boolean {
  if (!backgroundColor) return true;
  const normalized = backgroundColor.trim().toLowerCase();
  return (
    normalized.includes('rgba(0, 0, 0')
    || normalized.includes('rgba(255, 255, 255, 0.0')
    || normalized.includes('rgba(255, 255, 255, 0.04')
    || normalized.includes('rgba(255, 255, 255, 0.06)')
    || normalized.includes('rgba(255, 255, 255, 0.18)')
    || normalized === 'rgba(0, 0, 0, 0.25)'
    || normalized === 'rgba(0, 0, 0, 0.3)'
    || normalized === '#00e5ff'
  );
}

function colorWithAlpha(color: string, alpha: number): string {
  const rgb = parseColorToRgb(color);
  if (!rgb) return color;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * On light modal backgrounds, fill interactive surfaces that still use the
 * plugin's dark defaults so icon/cancel/close controls stay visible.
 */
function applyLightInteractiveSurfaceGaps(
  merged: Record<OnboardStyleKey, React.CSSProperties>,
  theme: OnboardModalTheme,
) {
  const modalBackground =
    typeof merged.modal.backgroundColor === 'string'
      ? merged.modal.backgroundColor
      : undefined;
  if (!isLightBackgroundColor(modalBackground)) return;

  const foreground =
    theme.title?.color
    ?? theme.modal?.color
    ?? '#0f172a';
  const muted =
    theme.description?.color
    ?? theme.cancelButton?.color
    ?? '#64748b';
  const primary =
    typeof theme.primaryButton?.backgroundColor === 'string'
      ? theme.primaryButton.backgroundColor
      : '#1E29F6';
  const inset =
    (typeof theme.manualKeyInput?.backgroundColor === 'string'
      ? theme.manualKeyInput.backgroundColor
      : undefined)
    ?? (typeof theme.keyInput?.backgroundColor === 'string'
      ? theme.keyInput.backgroundColor
      : undefined)
    ?? '#f1f5f9';
  const softBorder = `1px solid ${colorWithAlpha(foreground, 0.16)}`;
  const primaryBorder = `1px solid ${colorWithAlpha(primary, 0.3)}`;

  const surfaceDefaults: Partial<Record<OnboardStyleKey, React.CSSProperties>> = {
    closeButton: { color: muted },
    cancelButton: { color: foreground, fontWeight: 600 },
    iconButton: {
      backgroundColor: inset,
      color: foreground,
      border: softBorder,
    },
    iconButtonPressed: {
      backgroundColor: colorWithAlpha(primary, 0.12),
      color: primary,
      border: primaryBorder,
      boxShadow: 'none',
    },
    iconButtonDisabled: {
      backgroundColor: colorWithAlpha(foreground, 0.04),
      color: colorWithAlpha(foreground, 0.4),
      border: `1px solid ${colorWithAlpha(foreground, 0.1)}`,
    },
    inlineIconButton: {
      backgroundColor: colorWithAlpha(primary, 0.08),
      color: primary,
      border: `1px solid ${colorWithAlpha(primary, 0.28)}`,
    },
    manualKeyInput: {
      backgroundColor: inset,
      color: foreground,
      border: softBorder,
    },
    keyInput: {
      backgroundColor: inset,
      color: primary,
      border: softBorder,
    },
    aesKeyBox: {
      backgroundColor: inset,
      color: primary,
      border: softBorder,
    },
    calloutBox: {
      backgroundColor: colorWithAlpha(primary, 0.08),
      border: primaryBorder,
    },
    iconContainer: {
      backgroundColor: colorWithAlpha(primary, 0.08),
      border: `1px solid ${colorWithAlpha(primary, 0.2)}`,
    },
    saveOptionCard: {
      backgroundColor: colorWithAlpha(foreground, 0.04),
      border: softBorder,
    },
    saveOptionIconWrap: {
      backgroundColor: colorWithAlpha(primary, 0.1),
      border: `1px solid ${colorWithAlpha(primary, 0.22)}`,
      color: primary,
    },
    saveOptionSwitchTrackOff: {
      backgroundColor: colorWithAlpha(foreground, 0.2),
      borderColor: colorWithAlpha(foreground, 0.34),
    },
    saveOptionSwitchTrackOn: {
      backgroundColor: primary,
      borderColor: colorWithAlpha(primary, 0.45),
    },
    tooltipButton: {
      color: muted,
      backgroundColor: colorWithAlpha(foreground, 0.08),
      border: `1px solid ${colorWithAlpha(foreground, 0.2)}`,
    },
  };

  for (const key of LIGHT_INTERACTIVE_SURFACE_KEYS) {
    if (theme[key]) continue;
    const defaults = surfaceDefaults[key];
    if (!defaults) continue;

    const currentBackground =
      typeof merged[key]?.backgroundColor === 'string'
        ? merged[key].backgroundColor
        : undefined;
    const shouldFillBackground = isDefaultDarkSurfaceBackground(currentBackground);
    const patch: React.CSSProperties = { ...defaults };
    if (!shouldFillBackground) {
      delete patch.backgroundColor;
      delete patch.border;
      delete patch.boxShadow;
    }
    merged[key] = { ...merged[key], ...patch };
  }
}

/** Merges default styles with optional theme overrides from the host app. */
export function mergeOnboardModalTheme(theme?: OnboardModalTheme) {
  if (!theme) return defaultStyles;
  const merged = { ...defaultStyles } as Record<OnboardStyleKey, React.CSSProperties>;
  for (const key of Object.keys(theme) as OnboardStyleKey[]) {
    if (theme[key]) {
      merged[key] = { ...defaultStyles[key], ...theme[key] } as React.CSSProperties;
    }
  }
  applyThemePaletteGaps(merged, theme);
  applyLightInteractiveSurfaceGaps(merged, theme);
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

  const hslMatch = normalized.match(
    /^hsla?\(\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%(?:\s*\/\s*([0-9]*\.?[0-9]+))?\s*\)$/i,
  );
  if (hslMatch) {
    const h = Number(hslMatch[1]) / 360;
    const s = Number(hslMatch[2]) / 100;
    const l = Number(hslMatch[3]) / 100;
    const alpha = hslMatch[4] ? Number(hslMatch[4]) : 1;
    const hue2rgb = (p: number, q: number, t: number) => {
      let value = t;
      if (value < 0) value += 1;
      if (value > 1) value -= 1;
      if (value < 1 / 6) return p + (q - p) * 6 * value;
      if (value < 1 / 2) return q;
      if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
      alpha,
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

function resolveWarningBoxStyle(box: React.CSSProperties): React.CSSProperties {
  const padding = box.padding;
  if (padding === undefined || padding === null || padding === 0 || padding === '0') {
    return { ...box, padding: defaultStyles.warningBox.padding };
  }
  return box;
}

function getWarningStyles(styles: typeof defaultStyles) {
  const lightTheme = isLightBackgroundColor(
    typeof styles.modal.backgroundColor === 'string'
      ? styles.modal.backgroundColor
      : undefined,
  );

  if (lightTheme) {
    return {
      box: resolveWarningBoxStyle({
        ...styles.warningBox,
        backgroundColor: 'rgba(245, 158, 11, 0.14)',
        border: '1px solid rgba(180, 83, 9, 0.35)',
      }),
      text: {
        ...styles.warningText,
        color: '#78350f',
      },
    };
  }

  return {
    box: resolveWarningBoxStyle(styles.warningBox),
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
  saveBackup = true,
  showSaveBackupOption = true,
  onSaveBackupChange,
  onManualAesKeySubmit,
  warnings,
  runtimeWarnings,
  theme,
}) => {
  const [copied, setCopied] = useState(false);
  const [isAesVisible, setIsAesVisible] = useState(false);
  const [showManualKeyInput, setShowManualKeyInput] = useState(false);
  const [manualAesKey, setManualAesKey] = useState('');
  const [manualAesKeyError, setManualAesKeyError] = useState<string | null>(null);
  const [isSubmittingManualKey, setIsSubmittingManualKey] = useState(false);
  const [showBackupTooltip, setShowBackupTooltip] = useState(false);
  const styles = mergeOnboardModalTheme(theme);
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

  const screen = deriveOnboardScreen({ currentStep, isLoading, error, aesKey });
  const showIntro = screen === 'intro';
  const showProgress = screen === 'progress';
  const showSuccess = screen === 'success';
  const showError = screen === 'error';
  const hasDescription = showIntro || showSuccess || showError;

  useEffect(() => {
    logger.debug('[OnboardModal] screen', {
      screen,
      currentStep,
      isOpen,
      isLoading,
      hasError: !!error,
      hasAesKey: !!aesKey,
    });
  }, [screen, currentStep, isOpen, isLoading, error, aesKey]);

  const walletName = getWalletDisplayName(walletType);
  const includePersistStep = saveBackup || !showSaveBackupOption;
  const displaySteps = getDisplayOnboardingSteps(includePersistStep);

  const renderTitleRow = (icon: React.ReactNode, title: string) => (
    <div style={styles.titleRow}>
      <div style={styles.iconContainer}>{icon}</div>
      <h2 id="onboard-modal-title" style={styles.title}>{title}</h2>
    </div>
  );

  const renderPageWarning = (page: OnboardModalPage) => {
    const message = resolveOnboardPageWarning(page, {
      warnings,
      runtimeWarnings,
      saveBackup,
    });
    if (!message) return null;

    return (
      <div style={warningStyles.box}>
        <p style={warningStyles.text}>{message}</p>
      </div>
    );
  };

  const renderSaveLocallyOption = () => {
    if (!showSaveBackupOption) return null;

    return (
      <div
        style={{
          ...styles.saveOptionCard,
          ...(saveBackup ? styles.saveOptionCardActive : {}),
        }}
      >
        <div style={styles.saveOptionIconWrap} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
        </div>

        <div style={styles.saveOptionBody}>
          <div style={styles.saveOptionTitleRow}>
            <span style={styles.saveOptionTitle}>Save Locally</span>
            <span style={styles.tooltipWrap}>
              <button
                type="button"
                aria-label="How local save works"
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
                  Only an encrypted blob is stored locally. Restoring it requires a wallet signature.
                </span>
              )}
            </span>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={saveBackup}
          aria-label={saveBackup ? 'Disable local save' : 'Enable local save'}
          onClick={() => onSaveBackupChange?.(!saveBackup)}
          style={{
            ...styles.saveOptionSwitchTrack,
            ...(saveBackup ? styles.saveOptionSwitchTrackOn : styles.saveOptionSwitchTrackOff),
          }}
        >
          <span
            style={{
              ...styles.saveOptionSwitchKnob,
              transform: saveBackup ? 'translate(18px, -50%)' : 'translateY(-50%)',
            }}
          />
        </button>
      </div>
    );
  };

  const renderProgressCallout = (step: OnboardingStep) => {
    if (step === 'granting-funds') {
      return (
        <div style={styles.calloutBox}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <p style={styles.calloutText}>
            <strong>Funding in progress:</strong> Requesting native COTI from the grant service.
          </p>
        </div>
      );
    }

    if (step === 'waiting-for-funds') {
      return (
        <div style={styles.calloutBox}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M4 12h4l2-4 4 8 2-4h4" />
          </svg>
          <p style={styles.calloutText}>
            <strong>Grant submitted:</strong> Waiting for the funded balance to appear on COTI.
          </p>
        </div>
      );
    }

    if (step === 'preparing-onboard') {
      return (
        <div style={styles.calloutBox}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <p style={styles.calloutText}>
            <strong>Preparing onboarding:</strong> Checking wallet balance and contract state.
            Your wallet will prompt you to sign when ready.
          </p>
        </div>
      );
    }

    if (step === 'signing-transaction') {
      return (
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
      );
    }

    if (step === 'retrieving-key') {
      return (
        <div style={styles.calloutBox}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12h8" />
            <path d="M12 8l4 4-4 4" />
          </svg>
          <p style={styles.calloutText}>
            <strong>Transaction submitted:</strong> Waiting for confirmation and retrieving your AES key.
          </p>
        </div>
      );
    }

    if (
      step === 'validating-key'
      || step === 'restoring-network'
      || step === 'persisting-key'
      || step === 'saving-backup'
    ) {
      return (
        <div style={styles.calloutBox}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p style={styles.calloutText}>
            <strong>Finalizing:</strong> Securing your AES key and refreshing private balances.
          </p>
        </div>
      );
    }

    return null;
  };
  // Handle copy to clipboard
  const handleCopy = async () => {
    if (!aesKey) return;
    try {
      await navigator.clipboard.writeText(aesKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy AES key:', err);
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
      setManualAesKeyError('Wrong AES key');
      return;
    }

    setIsSubmittingManualKey(true);
    try {
      await onManualAesKeySubmit(normalizedKey, { saveBackup });
      setManualAesKey('');
      setShowManualKeyInput(false);
    } catch (err: unknown) {
      setManualAesKeyError(err instanceof Error ? err.message : 'Could not save AES key.');
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
          {...(hasDescription ? { 'aria-describedby': 'onboard-modal-description' } : {})}
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
              {renderTitleRow(
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#00E5FF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>,
                'Onboard User',
              )}

              <p id="onboard-modal-description" style={styles.description}>
                This will execute a transaction on the COTI Network to retrieve your encryption key.
              </p>

              {renderPageWarning('intro')}

              {renderSaveLocallyOption()}

              <div
                style={{
                  ...styles.actionRow,
                  marginBottom: onManualAesKeySubmit ? 0 : styles.actionRow.marginBottom,
                }}
              >
                {showManualKeyInput ? (
                  <>
                    <input
                      type="text"
                      value={manualAesKey}
                      onChange={(event) => setManualAesKey(event.target.value)}
                      placeholder="Paste key"
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
                    style={{
                      ...styles.primaryButton,
                      ...styles.actionPrimary,
                      ...styles.actionFieldButton,
                    }}
                  >
                    Onboard
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

              {onManualAesKeySubmit && (
                <div style={styles.manualKeyErrorRow}>
                  <div style={styles.manualKeyErrorColumn}>
                    {manualAesKeyError && (
                      <p style={styles.manualKeyErrorText}>{manualAesKeyError}</p>
                    )}
                  </div>
                  {showManualKeyInput && <div style={styles.actionSideSpacer} aria-hidden="true" />}
                  <div style={styles.actionSideSpacer} aria-hidden="true" />
                </div>
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
              {renderTitleRow(
                <div style={styles.spinner} />,
                getProgressTitle(currentStep),
              )}

              {renderPageWarning('progress')}

              {/* Step Progress */}
              <div style={styles.stepperContainer}>
                {displaySteps.map((step) => {
                  const status = getOnboardingStepStatus(step.id, currentStep, !!error, includePersistStep);
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

              <div style={styles.progressCalloutSlot} aria-label="Progress action">
                {renderProgressCallout(currentStep)}
              </div>
            </>
          )}

          {/* SUCCESS SCREEN */}
          {showSuccess && (
            <>
              {renderTitleRow(
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>,
                'Onboarding Complete',
              )}

              <p id="onboard-modal-description" style={styles.description}>
                Your encryption key has been successfully retrieved.
              </p>

              <div style={styles.keyInputWrap}>
                <input
                  type={isAesVisible ? 'text' : 'password'}
                  value={aesKey ?? ''}
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

              {renderPageWarning('success')}

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
              {renderTitleRow(
                <svg
                  width="22"
                  height="22"
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
                </svg>,
                'Onboarding Failed',
              )}

              <p id="onboard-modal-description" style={styles.description}>
                The onboarding process encountered an error. You can retry the signature request.
              </p>

              <div style={styles.errorBox}>
                <p style={styles.errorText}>{error || 'An unknown error occurred'}</p>
              </div>

              {renderPageWarning('error')}

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
