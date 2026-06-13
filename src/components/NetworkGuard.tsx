import React, { useState, useCallback } from 'react';
import { usePrivacyBridgeContext } from '../context/PrivacyBridgeContext';

export interface NetworkGuardProps {
  /** App content to render behind the guard when the wallet needs a network switch */
  children?: React.ReactNode;
}

const styles = {
  overlay: {
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
  panel: {
    backgroundColor: '#04133D',
    borderRadius: '24px',
    padding: '40px',
    width: '440px',
    maxWidth: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    textAlign: 'center' as const,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    lineHeight: 1.2,
    marginBottom: '12px',
    color: '#ffffff',
  },
  description: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '15px',
    lineHeight: 1.6,
    marginBottom: '24px',
  },
  warningBox: {
    width: '100%',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '12px',
    padding: '12px 16px',
    marginBottom: '24px',
  },
  warningText: {
    fontSize: '13px',
    color: '#f87171',
    lineHeight: 1.5,
    margin: 0,
  },
  button: {
    width: '100%',
    padding: '14px 24px',
    backgroundColor: '#1E29F6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  buttonDisabled: {
    width: '100%',
    padding: '14px 24px',
    backgroundColor: 'rgba(30, 41, 246, 0.5)',
    color: 'rgba(255, 255, 255, 0.6)',
    border: 'none',
    borderRadius: '12px',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'not-allowed',
  },
} as const;

/**
 * Blocks the UI when the connected wallet is unsupported or off the configured target network.
 * Uses {@link usePrivacyBridgeContext} fields wired from {@link useNetworkEnforcer}.
 *
 * Place inside {@link PrivacyBridgeProvider}:
 *
 * ```tsx
 * <PrivacyBridgeProvider>
 *   <NetworkGuard>
 *     <App />
 *   </NetworkGuard>
 * </PrivacyBridgeProvider>
 * ```
 */
export const NetworkGuard: React.FC<NetworkGuardProps> = ({ children }) => {
  const {
    isConnected,
    isUnsupportedNetwork,
    isOffTargetNetwork,
    networkMismatchWarning,
    enforceNetwork,
    networkName,
  } = usePrivacyBridgeContext();
  const [isSwitching, setIsSwitching] = useState(false);
  const needsNetworkSwitch = isUnsupportedNetwork || isOffTargetNetwork;

  const handleSwitch = useCallback(async () => {
    setIsSwitching(true);
    try {
      await enforceNetwork();
    } finally {
      setIsSwitching(false);
    }
  }, [enforceNetwork]);

  if (!isConnected || !needsNetworkSwitch) {
    return <>{children}</>;
  }

  const title = isUnsupportedNetwork ? 'Unsupported Network' : 'Switch Network';
  const description = isUnsupportedNetwork
    ? `Your wallet is connected to ${networkName}. Switch to a supported COTI network to continue.`
    : `Your wallet is connected to ${networkName}. Switch to the required network to continue.`;

  return (
    <>
      {children}
      <div
        style={styles.overlay}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="network-guard-title"
        aria-describedby="network-guard-description"
      >
        <div style={styles.panel}>
          <h2 id="network-guard-title" style={styles.title}>
            {title}
          </h2>
          <p id="network-guard-description" style={styles.description}>
            {description}
          </p>
          {networkMismatchWarning && (
            <div style={styles.warningBox}>
              <p style={styles.warningText}>{networkMismatchWarning}</p>
            </div>
          )}
          <button
            type="button"
            onClick={handleSwitch}
            style={isSwitching ? styles.buttonDisabled : styles.button}
            disabled={isSwitching}
          >
            {isSwitching ? 'Switching network…' : 'Switch Network'}
          </button>
        </div>
      </div>
    </>
  );
};

export default NetworkGuard;
