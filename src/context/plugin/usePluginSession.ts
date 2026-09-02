import { useRef } from 'react';
import type { CotiModalsContextValue } from './types';
import type { UpdateAccountStateRef } from './sessionShared';
import { usePluginSessionState } from './usePluginSessionState';
import { usePluginNetworkSession } from './usePluginNetworkSession';
import { usePluginAccountSync } from './usePluginAccountSync';
import { usePluginWagmiSync } from './usePluginWagmiSync';
import { usePluginWalletConnection } from './usePluginWalletConnection';
import { usePluginUnlockSession } from './usePluginUnlockSession';

interface UsePluginSessionOptions {
  modals: CotiModalsContextValue;
  autoInitTokens?: boolean;
}

/**
 * Composes wallet, network, balance sync, wagmi sync, connection, and unlock sub-hooks.
 * Always runs (core). Token catalog seeding follows `autoInitTokens`.
 * Return shape is unchanged for {@link CotiPluginProvider} and existing API clients.
 */
export const usePluginSession = ({
  modals,
  autoInitTokens,
}: UsePluginSessionOptions) => {
  const sessionState = usePluginSessionState({ modals, autoInitTokens });
  const updateAccountStateRef = useRef<UpdateAccountStateRef['current']>(null);

  const network = usePluginNetworkSession({ core: sessionState, updateAccountStateRef });
  const accountSync = usePluginAccountSync({
    core: sessionState,
    network,
    updateAccountStateRef,
    autoInitTokens,
  });

  usePluginWagmiSync({ core: sessionState, network, accountSync, autoInitTokens });

  const { handleConnect, handleDisconnect } = usePluginWalletConnection({
    core: sessionState,
    network,
    accountSync,
    autoInitTokens,
  });

  const unlock = usePluginUnlockSession({
    core: sessionState,
    network,
    accountSync,
    autoInitTokens,
  });

  return {
    isConnected: sessionState.isConnected,
    walletAddress: sessionState.walletAddress,
    hasSnap: sessionState.hasSnap,
    setHasSnap: sessionState.setHasSnap,
    snapError: sessionState.snapError,
    publicTokens: sessionState.publicTokens,
    privateTokens: sessionState.privateTokens,
    setPublicTokens: sessionState.setPublicTokens,
    setPrivateTokens: sessionState.setPrivateTokens,
    metamaskDetected: sessionState.metamaskDetected,
    setMetamaskDetected: sessionState.setMetamaskDetected,
    connectToSnap: sessionState.connectToSnap,
    requestSnapConnection: sessionState.requestSnapConnection,
    checkSnapStatus: sessionState.checkSnapStatus,
    getAESKeyFromSnap: sessionState.getAESKeyFromSnap,
    hasAesKeyInSnap: sessionState.hasAesKeyInSnap,
    handleOnboard: unlock.handleOnboard,
    handleVerifyKeys: unlock.handleVerifyKeys,
    aesKeyChainId: sessionState.aesKeyChainId,
    setAesKeyChainId: sessionState.setAesKeyChainId,
    handleConnect,
    handleDisconnect,
    refreshPublicBalances: unlock.refreshPublicBalances,
    refreshPrivateBalances: unlock.refreshPrivateBalances,
    onboardingError: sessionState.onboardingError,
    onboardingWarnings: sessionState.onboardingWarnings,
    lockPrivateBalances: unlock.lockPrivateBalances,
    saveManualAesKey: unlock.saveManualAesKey,
    sendPrivateToken: unlock.sendPrivateToken,
    encryptPrivateValue: unlock.encryptPrivateValue,
    decryptPrivateValue: unlock.decryptPrivateValue,
    sessionAesKey: sessionState.sessionAesKey,
    isPrivateUnlocked: unlock.isPrivateUnlocked,
    showSnapMissingModal: sessionState.showSnapMissingModal,
    setShowSnapMissingModal: sessionState.setShowSnapMissingModal,
    showCotiWalletAesKeyModal: sessionState.showCotiWalletAesKeyModal,
    setShowCotiWalletAesKeyModal: sessionState.setShowCotiWalletAesKeyModal,
    chainId: network.chainId,
    currentChainId: network.currentChainId,
    switchNetwork: network.switchNetwork,
    networkName: network.networkName,
    isUnsupportedNetwork: network.isUnsupportedNetwork,
    isOffTargetNetwork: network.isOffTargetNetwork,
    isWrongNetwork: network.isWrongNetwork,
    networkMismatchWarning: network.networkMismatchWarning,
    enforceNetwork: network.enforceNetwork,
    COTI_MAINNET_ID: network.COTI_MAINNET_ID,
    COTI_TESTNET_ID: network.COTI_TESTNET_ID,
    SEPOLIA_ID: network.SEPOLIA_ID,
    wagmiChainId: network.wagmiChainId,
    wagmiSyncRef: sessionState.wagmiSyncRef,
  };
};
