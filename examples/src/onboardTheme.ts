import type { OnboardModalTheme } from '@coti-io/coti-wallet-plugin';

export type ExampleThemeMode = 'light' | 'dark';

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
  }
> = {
  light: {
    foreground: '#0f172a',
    mutedForeground: '#64748b',
    primary: '#1E29F6',
    primaryForeground: '#ffffff',
    border: '#e2e8f0',
    modalBg: '#ffffff',
    modalInset: '#f1f5f9',
    overlayBlur: 'rgba(4, 19, 61, 0.35)',
    pageBg: '#f8fafc',
    pageText: '#0f172a',
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
  } = PALETTES[mode];

  return {
    backdrop: { backgroundColor: overlayBlur },
    modal: {
      backgroundColor: modalBg,
      color: foreground,
      border: `1px solid ${border}`,
    },
    title: { color: foreground },
    description: { color: mutedForeground },
    checkboxText: { color: foreground },
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
    primaryButton: {
      backgroundColor: primary,
      color: primaryForeground,
    },
    primaryButtonDisabled: {
      backgroundColor: withAlpha(primary, 0.5),
      color: withAlpha(primaryForeground, 0.6),
    },
    cancelButton: { color: mutedForeground },
    closeButton: { color: mutedForeground },
    stepLabel: { color: foreground },
    stepDescription: { color: mutedForeground },
    manualKeyInput: {
      backgroundColor: modalInset,
      color: foreground,
      border: `1px solid ${withAlpha(foreground, 0.16)}`,
    },
    keyInput: {
      backgroundColor: modalInset,
      color: primary,
      border: `1px solid ${border}`,
    },
    iconButton: {
      backgroundColor: withAlpha(foreground, 0.06),
      color: foreground,
      border: `1px solid ${withAlpha(foreground, 0.14)}`,
    },
    calloutText: { color: primary },
    warningText: { color: mutedForeground },
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
