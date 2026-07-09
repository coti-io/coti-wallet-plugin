import React from 'react';
import type { WalletType } from '../hooks/useWalletType';
import { onboardModalDefaultStyles, type OnboardModalTheme } from './OnboardModal';

const SPINNER_KEYFRAMES = `
@keyframes wallet-sign-spin {
  to { transform: rotate(360deg); }
}
`;

export interface WalletSignPromptProps {
  isOpen: boolean;
  walletType: WalletType;
  theme?: OnboardModalTheme;
}

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

function mergeTheme(theme?: OnboardModalTheme) {
  const styles = { ...onboardModalDefaultStyles } as Record<
    keyof typeof onboardModalDefaultStyles,
    React.CSSProperties
  >;
  if (!theme) return styles;

  for (const key of Object.keys(theme) as Array<keyof OnboardModalTheme>) {
    const override = theme[key];
    if (override) {
      styles[key] = { ...styles[key], ...override } as React.CSSProperties;
    }
  }
  return styles as typeof onboardModalDefaultStyles;
}

export const WalletSignPrompt: React.FC<WalletSignPromptProps> = ({
  isOpen,
  walletType,
  theme,
}) => {
  if (!isOpen) return null;

  const styles = mergeTheme(theme);
  const walletName = getWalletDisplayName(walletType);

  return (
    <>
      <style>{SPINNER_KEYFRAMES}</style>
      <div
        style={{ ...styles.backdrop, zIndex: 60 }}
        role="presentation"
        data-testid="wallet-sign-prompt"
      >
        <div
          style={{ ...styles.modal, width: '320px', padding: '24px' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-sign-prompt-title"
          aria-describedby="wallet-sign-prompt-description"
        >
          <div style={styles.iconContainer}>
            <div style={{ ...styles.spinner, animation: 'wallet-sign-spin 0.8s linear infinite' }} />
          </div>

          <h2 id="wallet-sign-prompt-title" style={styles.title}>
            Sign in your wallet
          </h2>

          <p id="wallet-sign-prompt-description" style={styles.description}>
            Approve the signature in {walletName} to decrypt your encrypted backup and unlock
            private balances.
          </p>

          <div style={styles.calloutBox}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p style={styles.calloutText}>
              <strong>Waiting for signature</strong> — this screen closes automatically after you sign.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default WalletSignPrompt;
