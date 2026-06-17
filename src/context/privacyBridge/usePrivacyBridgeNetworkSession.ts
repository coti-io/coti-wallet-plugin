import { useCallback, useMemo } from 'react';
import { useAccount as useWagmiAccount, useDisconnect as useWagmiDisconnect } from 'wagmi';
import { useMetamask } from '../../hooks/useMetamask';
import { useNetworkEnforcer } from '../../hooks/useNetworkEnforcer';
import { getWalletNetworkConfigs } from '../../chains';
import { logger } from '../../lib/logger';
import { truncateAddress } from '../../lib/format';
import type { PrivacyBridgeSessionCore, UpdateAccountStateRef } from './sessionShared';

interface UsePrivacyBridgeNetworkSessionOptions {
  core: PrivacyBridgeSessionCore;
  updateAccountStateRef: UpdateAccountStateRef;
}

/** MetaMask + wagmi network switching and effective chain id. */
export const usePrivacyBridgeNetworkSession = ({
  core,
  updateAccountStateRef,
}: UsePrivacyBridgeNetworkSessionOptions) => {
  const {
    isConnected,
    walletAddress,
    hasSnap,
    wagmiSyncRef,
    metamaskExplicitConnect,
    setSessionAesKey,
    setArePrivateBalancesHidden,
    executeSnapCheck,
  } = core;

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
    onNetworkChanged: async () => {
      // wagmi/RainbowKit already reacts to chain changes (wagmiChainId updates
      // and usePrivacyBridgeWagmiSync resyncs account state). A full page reload
      // here would drop the wagmi connection (reconnectOnMount: false), forcing
      // the user to reconnect after every network switch.
      if (wagmiSyncRef.current || wagmiConnected) {
        logger.log('Ignoring MetaMask chainChanged — wagmi is managing connection');
        return;
      }
      // Non-wagmi (injected MetaMask) path: soft-resync account/network state
      // instead of reloading the page.
      if (walletAddress) {
        await updateAccountStateRef.current?.(walletAddress, hasSnap, false);
      }
    },
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
      await updateAccountStateRef.current?.(account, hasSnap, false);
    },
    onSnapCheck: async account => {
      if (wagmiSyncRef.current || wagmiConnected) return;
      if (!metamaskExplicitConnect.current && !isConnected) return;

      await executeSnapCheck(async () => {
        await updateAccountStateRef.current?.(account, true, false);
        return true;
      });
    },
  });

  const switchNetwork = useCallback(async (targetChainId: string): Promise<boolean> => {
    if (wagmiSyncRef.current) return switchNetworkViaWagmiProvider(targetChainId);
    return metamaskSwitchNetwork(targetChainId);
  }, [switchNetworkViaWagmiProvider, metamaskSwitchNetwork, wagmiSyncRef]);

  const chainId = useMemo(() => {
    if (wagmiConnected && wagmiChainId) return wagmiChainId.toString();
    return metamaskChainId;
  }, [wagmiConnected, wagmiChainId, metamaskChainId]);

  const networkEnforcer = useNetworkEnforcer(chainId, switchNetwork);
  const currentChainId = chainId ? Number(chainId) : undefined;

  return {
    connectWallet,
    checkNetwork,
    registerEthereumInitializedListener,
    switchNetwork,
    chainId,
    currentChainId,
    networkName,
    COTI_MAINNET_ID,
    COTI_TESTNET_ID,
    SEPOLIA_ID,
    wagmiAddress,
    wagmiConnected,
    wagmiChainId,
    wagmiConnector,
    wagmiDisconnect,
    ...networkEnforcer,
  };
};

export type PrivacyBridgeNetworkSession = ReturnType<typeof usePrivacyBridgeNetworkSession>;
