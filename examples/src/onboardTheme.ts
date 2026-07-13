import type { OnboardModalTheme } from '@coti-io/coti-wallet-plugin';

export type ExampleThemeMode = 'light' | 'dark';

/**
 * Maps example palette tokens to every onboard modal control the host app can theme.
 * See ONBOARD_MODAL_STYLE_KEYS in the plugin for the full list.
 */
const PALETTES: Record<
  ExampleThemeMode,
  {
    foreground: string;
    mutedForeground: string;
    primary: string;
    primaryForeground: string;
    border: string;
    modalBg: string;
    modalInset: string;
    overlayBlur: string;
    pageBg: string;
    pageText: string;
    danger: string;
    warning: string;
    warningBg: string;
    warningBorder: string;
  }
> = {
  light: {
    foreground: '#0f172a',
    mutedForeground: '#475569',
    primary: '#1E29F6',
    primaryForeground: '#ffffff',
    border: '#cbd5e1',
    modalBg: '#ffffff',
    modalInset: '#f1f5f9',
    overlayBlur: 'rgba(4, 19, 61, 0.35)',
    pageBg: '#f8fafc',
    pageText: '#0f172a',
    danger: '#b91c1c',
    warning: '#78350f',
    warningBg: 'rgba(245, 158, 11, 0.14)',
    warningBorder: '1px solid rgba(180, 83, 9, 0.35)',
  },
  dark: {
    foreground: '#f8fafc',
    mutedForeground: '#94a3b8',
    primary: '#00E5FF',
    primaryForeground: '#04133D',
    border: '#1e293b',
    modalBg: '#04133D',
    modalInset: '#071848',
    overlayBlur: 'rgba(0, 0, 0, 0.6)',
    pageBg: '#0b1220',
    pageText: '#f8fafc',
    danger: '#f87171',
    warning: '#fef3c7',
    warningBg: 'rgba(251, 191, 36, 0.1)',
    warningBorder: '1px solid rgba(251, 191, 36, 0.3)',
  },
};

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

export function buildExampleOnboardTheme(mode: ExampleThemeMode): OnboardModalTheme {
  const {
    foreground,
    mutedForeground,
    primary,
    primaryForeground,
    border,
    modalBg,
    modalInset,
    overlayBlur,
    danger,
    warning,
    warningBg,
    warningBorder,
  } = PALETTES[mode];

  const softBorder = `1px solid ${border}`;
  const iconBorder = `1px solid ${withAlpha(foreground, mode === 'light' ? 0.18 : 0.14)}`;

  return {
    backdrop: { backgroundColor: overlayBlur },
    modal: {
      backgroundColor: modalBg,
      color: foreground,
      border: softBorder,
    },
    closeButton: { color: mutedForeground },
    iconContainer: {
      backgroundColor: withAlpha(primary, 0.1),
      border: `1px solid ${withAlpha(primary, 0.22)}`,
    },
    title: { color: foreground },
    description: { color: mutedForeground },
    saveOptionTitle: { color: foreground },
    saveOptionCard: {
      backgroundColor: withAlpha(foreground, 0.04),
      border: softBorder,
    },
    saveOptionIconWrap: {
      backgroundColor: withAlpha(primary, 0.1),
      border: `1px solid ${withAlpha(primary, 0.22)}`,
      color: primary,
    },
    tooltipButton: {
      color: mutedForeground,
      backgroundColor: withAlpha(foreground, 0.08),
      border: `1px solid ${withAlpha(foreground, 0.2)}`,
    },
    tooltipBubble: {
      backgroundColor: mode === 'light' ? foreground : 'rgba(0, 0, 0, 0.92)',
      color: mode === 'light' ? modalBg : foreground,
      border: `1px solid ${withAlpha(foreground, 0.14)}`,
    },
    warningBox: {
      backgroundColor: warningBg,
      border: warningBorder,
    },
    warningText: { color: warning },
    primaryButton: {
      backgroundColor: primary,
      color: primaryForeground,
    },
    primaryButtonDisabled: {
      backgroundColor: withAlpha(primary, 0.5),
      color: withAlpha(primaryForeground, 0.6),
    },
    cancelButton: {
      color: foreground,
      fontWeight: 600,
    },
    iconButton: {
      backgroundColor: modalInset,
      color: foreground,
      border: iconBorder,
    },
    iconButtonPressed: {
      backgroundColor: withAlpha(primary, 0.14),
      color: primary,
      border: `1px solid ${withAlpha(primary, 0.38)}`,
      boxShadow: 'none',
    },
    iconButtonDisabled: {
      backgroundColor: withAlpha(foreground, 0.04),
      color: withAlpha(foreground, 0.38),
      border: `1px solid ${withAlpha(foreground, 0.1)}`,
    },
    manualKeyInput: {
      backgroundColor: modalInset,
      color: foreground,
      border: softBorder,
    },
    manualKeyErrorText: { color: danger },
    inlineIconButton: {
      backgroundColor: withAlpha(primary, 0.1),
      color: primary,
      border: `1px solid ${withAlpha(primary, 0.28)}`,
    },
    stepLabel: { color: foreground },
    stepDescription: { color: mutedForeground },
    keyInput: {
      backgroundColor: modalInset,
      color: primary,
      border: softBorder,
    },
    aesKeyBox: {
      backgroundColor: modalInset,
      color: primary,
      border: softBorder,
    },
    calloutBox: {
      backgroundColor: withAlpha(primary, 0.1),
      border: `1px solid ${withAlpha(primary, 0.28)}`,
    },
    calloutText: { color: primary },
    errorBox: {
      backgroundColor: withAlpha(danger, 0.1),
      border: `1px solid ${withAlpha(danger, 0.3)}`,
    },
    errorText: { color: danger },
  };
}

export function getExamplePageColors(mode: ExampleThemeMode) {
  const palette = PALETTES[mode];
  return {
    backgroundColor: palette.pageBg,
    color: palette.pageText,
    mutedColor: palette.mutedForeground,
    borderColor: palette.border,
  };
}
