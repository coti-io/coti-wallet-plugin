import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount as useWagmiAccount, useDisconnect as useWagmiDisconnect } from 'wagmi';
import { useMetamask } from '../../hooks/useMetamask';
import { useSnap } from '../../hooks/useSnap';
import { useBalanceUpdater } from '../../hooks/useBalanceUpdater';
import { usePrivateTokenBalance } from '../../hooks/usePrivateTokenBalance';
import { useNetworkEnforcer } from '../../hooks/useNetworkEnforcer';
import { isChainUpdatesMuted } from '../../lib/chainMute';
import { logger } from '../../lib/logger';
import { truncateAddress } from '../../lib/format';
import {
  getInitialPublicTokens,
  getInitialPrivateTokens,
  type Token,
} from '../../hooks/usePrivacyBridge';
import { saveAesKeyLocally, unlockCachedAesKey as unlockCachedAesKeyFromVault } from '../../crypto/localAesKeyVault';
import { getUnlockStrategyForChain, getWalletNetworkConfigs } from '../../chains';
import { isMultipleWalletsError } from '../../utils/walletErrors';
import { useWalletType } from '../../hooks/useWalletType';
import { useAesKeyProvider } from '../../hooks/useAesKeyProvider';
import { getPluginConfig } from '../../config/plugin';
import type { PrivacyBridgeModalsContextValue } from './types';
import { usePrivacyBridgeSessionKey } from './usePrivacyBridgeSessionKey';

interface UsePrivacyBridgeSessionOptions {
  modals: PrivacyBridgeModalsContextValue;
}

/**
 * Wallet, network, token, and unlock orchestration shared by the bridge provider.
 * Bridge/swap execution stays in {@link usePrivacyBridge}; PoD in {@link usePrivacyBridgePodState}.
 */
export const usePrivacyBridgeSession = ({ modals }: UsePrivacyBridgeSessionOptions) => {
  const { setShowInstallModal, setShowMultipleWalletsModal } = modals;

  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [hasSnap, setHasSnap] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [publicTokens, setPublicTokens] = useState<Token[]>(getInitialPublicTokens());
  const [privateTokens, setPrivateTokens] = useState<Token[]>(getInitialPrivateTokens());
  const [showSnapMissingModal, setShowSnapMissingModal] = useState(false);
  const [showCotiWalletAesKeyModal, setShowCotiWalletAesKeyModal] = useState(false);
  const [metamaskDetected, setMetamaskDetected] = useState(false);
  const ethereumListenerRegistered = useRef(false);
  const wagmiSyncRef = useRef(false);
  const metamaskExplicitConnect = useRef(false);

  const {
    sessionAesKey,
    setSessionAesKey,
    arePrivateBalancesHidden,
    setArePrivateBalancesHidden,
  } = usePrivacyBridgeSessionKey(walletAddress);

  useEffect(() => {
    if (snapError) setShowSnapMissingModal(true);
  }, [snapError]);

  const {
    executeSnapCheck,
    getAESKeyFromSnap,
    connectToSnap,
    requestSnapConnection,
    handleManualOnboarding,
    handleKeyVerification,
    clearSnapCache,
  } = useSnap(setSnapError);

  const walletTypeInfo = useWalletType();
  const { getAesKey: getAesKeyFromProvider } = useAesKeyProvider(walletTypeInfo);
  const { fetchPrivateBalance } = usePrivateTokenBalance();

  const { address: wagmiAddress, isConnected: wagmiConnected, chainId: wagmiChainId, connector: wagmiConnector } =
    useWagmiAccount();
  const { disconnect: wagmiDisconnect } = useWagmiDisconnect();

  const switchNetworkViaWagmiProvider = useCallback(async (targetChainId: string): Promise<boolean> => {
    if (!wagmiConnector) {
      logger.warn('[switchNetworkViaWagmi] No wagmi connector available');
      return false;
    }

    let provider: any;
    try {
      provider = await wagmiConnector.getProvider();
    } catch (e) {
      logger.warn('[switchNetworkViaWagmi] Failed to get provider from connector:', e);
      return false;
    }

    if (!provider?.request) {
      logger.warn('[switchNetworkViaWagmi] Provider has no request method');
      return false;
    }

    const networks = getWalletNetworkConfigs();

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainId }],
      });
      return true;
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        const networkConfig = networks[targetChainId];
        if (!networkConfig) {
          logger.error('[switchNetworkViaWagmi] No network config for chainId', targetChainId);
          return false;
        }
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [networkConfig],
          });
          return true;
        } catch (addError) {
          logger.error('[switchNetworkViaWagmi] Failed to add chain:', addError);
          return false;
        }
      }
      logger.error('[switchNetworkViaWagmi] Failed to switch:', switchError);
      return false;
    }
  }, [wagmiConnector]);

  const {
    connectWallet,
    checkNetwork,
    switchNetwork: metamaskSwitchNetwork,
    networkName,
    COTI_MAINNET_ID,
    COTI_TESTNET_ID,
    SEPOLIA_ID,
    chainId: metamaskChainId,
    registerEthereumInitializedListener,
  } = useMetamask({
    onAccountChanged: async account => {
      if (wagmiSyncRef.current || wagmiConnected) {
        logger.log('Ignoring MetaMask accountsChanged — wagmi is managing connection');
        return;
      }

      if (!metamaskExplicitConnect.current && !isConnected) {
        logger.log("Ignoring MetaMask auto-detection — user hasn't clicked MetaMask");
        return;
      }

      if (walletAddress && account.toLowerCase() === walletAddress.toLowerCase()) {
        logger.log('Account unchanged, skipping session reset');
        return;
      }

      logger.log('Account changed, clearing sessionAesKey and locking', truncateAddress(account));
      setSessionAesKey(null);
      setArePrivateBalancesHidden(true);
      await updateAccountState(account, hasSnap, false);
    },
    onSnapCheck: async account => {
      if (wagmiSyncRef.current || wagmiConnected) return;
      if (!metamaskExplicitConnect.current && !isConnected) return;

      await executeSnapCheck(async () => {
        await updateAccountState(account, true, false);
        return true;
      });
    },
  });

  const switchNetwork = useCallback(async (targetChainId: string): Promise<boolean> => {
    if (wagmiSyncRef.current) return switchNetworkViaWagmiProvider(targetChainId);
    return metamaskSwitchNetwork(targetChainId);
  }, [switchNetworkViaWagmiProvider, metamaskSwitchNetwork]);

  const chainId = useMemo(() => {
    if (wagmiConnected && wagmiChainId) return wagmiChainId.toString();
    return metamaskChainId;
  }, [wagmiConnected, wagmiChainId, metamaskChainId]);

  const networkEnforcer = useNetworkEnforcer(chainId, switchNetwork);
  const currentChainId = chainId ? Number(chainId) : undefined;
  const usesManualAesKey = getUnlockStrategyForChain(currentChainId) === 'manual-aes-key';

  const getAESKeyForCurrentNetwork = useCallback(
    async (accountAddress: string) => {
      if (sessionAesKey) return sessionAesKey;

      if (usesManualAesKey) {
        const cachedKey = await unlockCachedAesKeyFromVault(accountAddress);
        if (cachedKey) return cachedKey;
      }

      return getAesKeyFromProvider(accountAddress);
    },
    [getAesKeyFromProvider, usesManualAesKey, sessionAesKey],
  );

  const { updateAccountState } = useBalanceUpdater({
    setWalletAddress,
    setIsConnected,
    setHasSnap,
    setPublicTokens,
    setPrivateTokens,
    checkNetwork,
    getAESKeyFromSnap: getAESKeyForCurrentNetwork,
    fetchPrivateBalance,
    sessionAesKey,
    setSessionAesKey,
  });

  const handleConnectRef = useRef<() => Promise<void>>();

  const handleConnect = async () => {
    if (!window.ethereum && ethereumListenerRegistered.current) return;
    metamaskExplicitConnect.current = true;
    try {
      await connectWallet(async account => {
        await updateAccountState(account, false, false);
      });
    } catch (error: any) {
      logger.error('Connection failed:', error);

      if (isMultipleWalletsError(error?.message)) {
        setShowMultipleWalletsModal(true);
        return;
      }

      if (error.message === 'METAMASK_NOT_INSTALLED') {
        setShowInstallModal(true);
        if (!ethereumListenerRegistered.current) {
          registerEthereumInitializedListener(() => {
            ethereumListenerRegistered.current = false;
            setShowInstallModal(false);
            handleConnectRef.current?.();
          });
          ethereumListenerRegistered.current = true;
        }
      }
    }
  };

  handleConnectRef.current = handleConnect;

  useEffect(() => {
    if (wagmiConnected && wagmiAddress && !isConnected) {
      logger.log('RainbowKit connection detected, syncing to context', {
        address: truncateAddress(wagmiAddress),
        chainId: wagmiChainId,
      });
      wagmiSyncRef.current = true;
      updateAccountState(wagmiAddress, false, false, undefined, wagmiChainId);

      const connectorId = wagmiConnector?.id?.toLowerCase() || '';
      const connectorName = wagmiConnector?.name?.toLowerCase() || '';
      const isMetaMask =
        connectorId.includes('metamask') ||
        connectorName.includes('metamask') ||
        connectorId === 'io.metamask';
      if (isMetaMask) {
        logger.log('MetaMask detected via RainbowKit — checking Snap...');
        executeSnapCheck(async () => {
          logger.log('Snap found via RainbowKit MetaMask connection');
          setHasSnap(true);
          return true;
        });
      }
    }

    if (!wagmiConnected && wagmiSyncRef.current) {
      logger.log('RainbowKit disconnected, clearing context');
      wagmiSyncRef.current = false;
      setIsConnected(false);
      setWalletAddress('');
      if (getPluginConfig().clearSessionKeyOnWagmiDisconnect) {
        setSessionAesKey(null);
        clearSnapCache();
      }
      setArePrivateBalancesHidden(true);
    }

    if (wagmiConnected && wagmiAddress && isConnected && wagmiAddress !== walletAddress) {
      logger.log('RainbowKit account switched', truncateAddress(wagmiAddress));
      setSessionAesKey(null);
      clearSnapCache();
      updateAccountState(wagmiAddress, false, false, undefined, wagmiChainId);
    }
  }, [wagmiConnected, wagmiAddress, walletAddress, isConnected, wagmiChainId]);

  const prevWagmiChainIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (wagmiConnected && wagmiAddress && isConnected && wagmiAddress === walletAddress && wagmiChainId) {
      if (prevWagmiChainIdRef.current !== undefined && prevWagmiChainIdRef.current !== wagmiChainId) {
        if (isChainUpdatesMuted()) {
          logger.log('[ChainMuted] Ignoring chain change during onboarding', {
            from: prevWagmiChainIdRef.current,
            to: wagmiChainId,
          });
          prevWagmiChainIdRef.current = wagmiChainId;
          return;
        }
        logger.log('RainbowKit chain changed', {
          from: prevWagmiChainIdRef.current,
          to: wagmiChainId,
        });
        updateAccountState(wagmiAddress, false, false, undefined, wagmiChainId);
      }
      prevWagmiChainIdRef.current = wagmiChainId;
    }
  }, [wagmiConnected, wagmiAddress, walletAddress, isConnected, wagmiChainId]);

  useEffect(() => {
    if (isChainUpdatesMuted()) return;

    if (!isConnected) {
      setPublicTokens(getInitialPublicTokens(currentChainId));
      setPrivateTokens(getInitialPrivateTokens(currentChainId));
    } else if (!hasSnap) {
      setPrivateTokens(getInitialPrivateTokens(currentChainId));
    }
  }, [isConnected, hasSnap, currentChainId]);

  useEffect(() => {
    if (sessionAesKey && walletAddress) {
      logger.log('Session AES Key set, refreshing account state...');
      if (!hasSnap) setHasSnap(true);
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      updateAccountState(walletAddress, true, false, undefined, chainOverride).then(() => {
        setArePrivateBalancesHidden(false);
      });
    }
  }, [sessionAesKey, walletAddress, updateAccountState, hasSnap]);

  const handleOnboard = async () => {
    const key = await handleManualOnboarding();
    if (key && walletAddress) setSessionAesKey(key, walletAddress);
    return key;
  };

  const saveManualAesKey = async (aesKey: string) => {
    if (!walletAddress) throw new Error('Connect your wallet first.');
    const key = await saveAesKeyLocally(walletAddress, aesKey);
    setSessionAesKey(key, walletAddress);
    setHasSnap(true);
    setSnapError(null);

    const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
    const success = await updateAccountState(walletAddress, true, true, key, chainOverride);
    if (success) setArePrivateBalancesHidden(false);
  };

  const unlockCachedAesKey = async () => {
    if (!walletAddress) throw new Error('Connect your wallet first.');
    const key = await unlockCachedAesKeyFromVault(walletAddress);
    if (!key) throw new Error('No cached AES key found for this wallet.');
    setSessionAesKey(key, walletAddress);
    setHasSnap(true);
    setSnapError(null);

    const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
    const success = await updateAccountState(walletAddress, true, true, key, chainOverride);
    if (success) setArePrivateBalancesHidden(false);
  };

  const refreshPrivateBalances = useCallback(async () => {
    if (!walletAddress) return false;

    logger.log('Triggering private balance fetch...');
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      let success = await updateAccountState(walletAddress, true, true, undefined, chainOverride);
      logger.log('Private balance fetch completed', { success });

      if (!success) {
        logger.log('First private balance fetch failed, retrying after 1.5s');
        await new Promise(resolve => setTimeout(resolve, 1500));
        success = await updateAccountState(walletAddress, true, true, undefined, chainOverride);
        logger.log('Retry private balance fetch completed', { success });
      }

      if (success) {
        setArePrivateBalancesHidden(false);
        setSnapError(null);
      }
      return success;
    } catch (err: any) {
      logger.log('Unlock logic caught error', { code: err.code, name: err.name });

      if (err.message === 'SNAP_CONNECT_FAILED' || err.message?.includes('SNAP_CONNECT_FAILED')) {
        throw new Error('SNAP_REQUIRED');
      }

      if (
        err.code === 4001 ||
        err.message?.includes('User rejected') ||
        err.message?.includes('rejected the request')
      ) {
        return false;
      }

      if (err.message === 'SNAP_DIALOG_REJECTED') throw err;

      if (err.message?.includes('ACCOUNT_NOT_ONBOARDED')) {
        setSessionAesKey(null);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        throw new Error('SNAP_REQUIRED');
      }

      if (err.message?.includes('AES key') || err.message?.includes('onboarding')) {
        setSessionAesKey(null);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        const mismatchError = new Error('AES_KEY_MISMATCH');
        (mismatchError as any).detail = err.message;
        throw mismatchError;
      }
      return false;
    }
  }, [
    walletAddress,
    updateAccountState,
    wagmiChainId,
    clearSnapCache,
    setSessionAesKey,
    setArePrivateBalancesHidden,
    setSnapError,
  ]);

  const handleDisconnect = async () => {
    if (wagmiSyncRef.current || wagmiConnected) {
      wagmiDisconnect();
      wagmiSyncRef.current = false;
    }

    if (window.ethereum && !wagmiConnected) {
      try {
        await (window.ethereum as any).request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        });
      } catch (err) {
        logger.warn('wallet_revokePermissions failed (may not be supported):', err);
      }
    }

    setIsConnected(false);
    setWalletAddress('');
    setHasSnap(false);
    setPublicTokens(getInitialPublicTokens(currentChainId));
    setPrivateTokens(getInitialPrivateTokens(currentChainId));
    setSessionAesKey(null);
    setArePrivateBalancesHidden(true);
    setShowMultipleWalletsModal(false);
    clearSnapCache();
    logger.log('Disconnected wallet');
  };

  const lockPrivateBalances = () => {
    logger.log('Hard locking private balances and clearing caches');
    setArePrivateBalancesHidden(true);
    setSessionAesKey(null);
    clearSnapCache();
    setPrivateTokens(getInitialPrivateTokens(currentChainId));
  };

  const isPrivateUnlocked = !!sessionAesKey && !arePrivateBalancesHidden;

  return {
    isConnected,
    walletAddress,
    hasSnap,
    setHasSnap,
    snapError,
    publicTokens,
    privateTokens,
    setPublicTokens,
    setPrivateTokens,
    metamaskDetected,
    setMetamaskDetected,
    connectToSnap,
    requestSnapConnection,
    getAESKeyFromSnap,
    handleOnboard,
    handleVerifyKeys: handleKeyVerification,
    handleConnect,
    handleDisconnect,
    refreshPrivateBalances,
    lockPrivateBalances,
    saveManualAesKey,
    unlockCachedAesKey,
    sessionAesKey,
    isPrivateUnlocked,
    showSnapMissingModal,
    setShowSnapMissingModal,
    showCotiWalletAesKeyModal,
    setShowCotiWalletAesKeyModal,
    chainId,
    switchNetwork,
    networkName,
    ...networkEnforcer,
    COTI_MAINNET_ID,
    COTI_TESTNET_ID,
    SEPOLIA_ID,
    wagmiChainId,
    wagmiSyncRef,
  };
};
