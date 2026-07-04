import { useRef } from 'react';
import type { PrivacyBridgeModalsContextValue } from './types';
import type { UpdateAccountStateFn } from './sessionShared';
import { usePrivacyBridgeSessionCore } from './usePrivacyBridgeSessionCore';
import { usePrivacyBridgeNetworkSession } from './usePrivacyBridgeNetworkSession';
import { usePrivacyBridgeAccountSync } from './usePrivacyBridgeAccountSync';
import { usePrivacyBridgeWagmiSync } from './usePrivacyBridgeWagmiSync';
import { usePrivacyBridgeWalletConnection } from './usePrivacyBridgeWalletConnection';
import { usePrivacyBridgeUnlockSession } from './usePrivacyBridgeUnlockSession';

interface UsePrivacyBridgeSessionOptions {
  modals: PrivacyBridgeModalsContextValue;
}

/**
 * Composes wallet, network, balance sync, wagmi sync, connection, and unlock sub-hooks.
 * Return shape is unchanged for {@link PrivacyBridgeProvider} and existing API clients.
 */
export const usePrivacyBridgeSession = ({ modals }: UsePrivacyBridgeSessionOptions) => {
  const core = usePrivacyBridgeSessionCore({ modals });
  const updateAccountStateRef = useRef<UpdateAccountStateFn | null>(null);

  const network = usePrivacyBridgeNetworkSession({ core, updateAccountStateRef });
  const accountSync = usePrivacyBridgeAccountSync({ core, network, updateAccountStateRef });

  usePrivacyBridgeWagmiSync({ core, network, accountSync });

  const { handleConnect, handleDisconnect } = usePrivacyBridgeWalletConnection({
    core,
    network,
    accountSync,
  });

  const unlock = usePrivacyBridgeUnlockSession({ core, network, accountSync });

  return {
    isConnected: core.isConnected,
    walletAddress: core.walletAddress,
    hasSnap: core.hasSnap,
    setHasSnap: core.setHasSnap,
    snapError: core.snapError,
    publicTokens: core.publicTokens,
    privateTokens: core.privateTokens,
    setPublicTokens: core.setPublicTokens,
    setPrivateTokens: core.setPrivateTokens,
    metamaskDetected: core.metamaskDetected,
    setMetamaskDetected: core.setMetamaskDetected,
    connectToSnap: core.connectToSnap,
    requestSnapConnection: core.requestSnapConnection,
    getAESKeyFromSnap: core.getAESKeyFromSnap,
    hasAesKeyInSnap: core.hasAesKeyInSnap,
    handleOnboard: unlock.handleOnboard,
    handleVerifyKeys: unlock.handleVerifyKeys,
    handleConnect,
    handleDisconnect,
    refreshPublicBalances: unlock.refreshPublicBalances,
    refreshPrivateBalances: unlock.refreshPrivateBalances,
    lockPrivateBalances: unlock.lockPrivateBalances,
    saveManualAesKey: unlock.saveManualAesKey,
    unlockCachedAesKey: unlock.unlockCachedAesKey,
    sendPrivateToken: unlock.sendPrivateToken,
    sessionAesKey: core.sessionAesKey,
    isPrivateUnlocked: unlock.isPrivateUnlocked,
    showSnapMissingModal: core.showSnapMissingModal,
    setShowSnapMissingModal: core.setShowSnapMissingModal,
    showCotiWalletAesKeyModal: core.showCotiWalletAesKeyModal,
    setShowCotiWalletAesKeyModal: core.setShowCotiWalletAesKeyModal,
    chainId: network.chainId,
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
    wagmiSyncRef: core.wagmiSyncRef,
  };
};
