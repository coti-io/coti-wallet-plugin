import { useEffect, useState } from 'react';
import { isMultipleWalletsError } from '../../utils/walletErrors';
import type { PrivacyBridgeModalsContextValue } from './types';

/** Install and multi-wallet modal visibility (shared across connection flows). */
export const usePrivacyBridgeModalsState = (): PrivacyBridgeModalsContextValue => {
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showMultipleWalletsModal, setShowMultipleWalletsModal] = useState(false);

  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      const message =
        event.reason?.message ?? (typeof event.reason === 'string' ? event.reason : '');
      if (isMultipleWalletsError(message)) {
        event.preventDefault();
        setShowMultipleWalletsModal(true);
      }
    };

    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  return {
    showInstallModal,
    setShowInstallModal,
    showMultipleWalletsModal,
    setShowMultipleWalletsModal,
  };
};
