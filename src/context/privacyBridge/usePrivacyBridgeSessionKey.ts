import { useCallback, useMemo, useState } from 'react';
import { logger } from '../../lib/logger';

/** Wallet-bound session AES key (prevents cross-account key bleed). */
export const usePrivacyBridgeSessionKey = (walletAddress: string) => {
  const [sessionKeyRecord, setSessionKeyRecord] = useState<{ wallet: string; key: string } | null>(
    null,
  );
  const [arePrivateBalancesHidden, setArePrivateBalancesHidden] = useState(true);

  const sessionAesKey = useMemo(() => {
    if (!sessionKeyRecord || !walletAddress) return null;
    if (sessionKeyRecord.wallet.toLowerCase() !== walletAddress.toLowerCase()) return null;
    return sessionKeyRecord.key;
  }, [sessionKeyRecord, walletAddress]);

  const setSessionAesKey = useCallback(
    (key: string | null, keyWallet?: string) => {
      if (key == null || key === '') {
        setSessionKeyRecord(null);
        return;
      }
      const w = keyWallet ?? walletAddress;
      if (!w) {
        logger.warn('setSessionAesKey: no wallet for key binding; clearing');
        setSessionKeyRecord(null);
        return;
      }
      setSessionKeyRecord({ wallet: w.toLowerCase(), key });
    },
    [walletAddress],
  );

  return {
    sessionAesKey,
    setSessionAesKey,
    arePrivateBalancesHidden,
    setArePrivateBalancesHidden,
  };
};
