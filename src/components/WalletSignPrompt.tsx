import React from 'react';
import type { WalletType } from '../hooks/useWalletType';
import { mergeOnboardModalTheme, type OnboardModalTheme } from './OnboardModal';
import { getWalletDisplayName } from '../lib/walletDisplayName';

const SPINNER_KEYFRAMES = `
@keyframes wallet-sign-spin {
  to { transform: rotate(360deg); }
}
`;

export type WalletSignPromptPurpose = 'decrypt-backup' | 'save-backup';

export interface WalletSignPromptProps {
  isOpen: boolean;
  walletType: WalletType;
  theme?: OnboardModalTheme;
  purpose?: WalletSignPromptPurpose;
}

const TRUST_LINE = 'Only sign from an official or trusted COTI app.';

function getPurposeBody(purpose: WalletSignPromptPurpose, walletName: string): string {
  if (purpose === 'save-backup') {
    return `Approve the signature(s) in ${walletName} to encrypt your COTI privacy key backup. Your wallet may prompt up to twice — once to encrypt, once to verify restore works.`;
  }

  return `Approve the signature in ${walletName} to decrypt your COTI privacy key backup and unlock private data.`;
}

export const WalletSignPrompt: React.FC<WalletSignPromptProps> = ({
  isOpen,
  walletType,
  theme,
  purpose = 'decrypt-backup',
}) => {
  if (!isOpen) return null;

  const styles = mergeOnboardModalTheme(theme);
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
          <div style={styles.titleRow}>
            <div style={styles.iconContainer}>
              <div style={{ ...styles.spinner, animation: 'wallet-sign-spin 0.8s linear infinite' }} />
            </div>
            <h2 id="wallet-sign-prompt-title" style={styles.title}>
              Sign in your wallet
            </h2>
          </div>

          <p
            id="wallet-sign-prompt-description"
            style={{ ...styles.description, width: '100%', textAlign: 'left' }}
          >
            {getPurposeBody(purpose, walletName)}
            <br />
            {TRUST_LINE}
          </p>

          <div style={styles.calloutBox}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00E5FF" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p style={styles.calloutText}>
              <strong>Waiting for signature</strong> — this screen closes automatically after you finish signing.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

export default WalletSignPrompt;
