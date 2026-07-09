import { useCallback, useMemo } from 'react';
import { useAccount as useWagmiAccount, useConfig } from 'wagmi';
import { useMetamask } from '../../hooks/useMetamask';
import { useNetworkEnforcer } from '../../hooks/useNetworkEnforcer';
import { getNetworkNameForChain, getWalletNetworkConfigs } from '../../chains';
import { logger } from '../../lib/logger';
import { truncateAddress } from '../../lib/format';
import type { PrivacyBridgeSessionCore, UpdateAccountStateRef } from './sessionShared';

interface UsePrivacyBridgeNetworkSessionOptions {
  core: PrivacyBridgeSessionCore;
  updateAccountStateRef: UpdateAccountStateRef;
}

interface WalletConnectEip155Namespace {
  chains?: string[];
  accounts?: string[];
  methods?: string[];
}

// Native URL schemes used to foreground the wallet app so the user sees the
// wallet_addEthereumChain approval prompt (WalletConnect requests are silent
// while the wallet app is backgrounded, unless it has push enabled).
const WALLET_DEEPLINK_SCHEMES: Record<string, string> = {
  zerion: 'zerion://',
  trust: 'trust://',
  onekey: 'onekey-wallet://',
  metaMask: 'metamask://',
};

const isMobileBrowser = (): boolean =>
  typeof navigator !== 'undefined' && (
    /android|iphone|ipod/i.test(navigator.userAgent)
    || /ipad/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );

const foregroundWalletApp = (connector: { id: string; rkDetails?: { id?: string } } | undefined): void => {
  if (!isMobileBrowser() || typeof window === 'undefined' || !connector) return;
  const walletId = connector.rkDetails?.id ?? connector.id;
  const scheme = WALLET_DEEPLINK_SCHEMES[walletId];
  if (!scheme) return;
  // Give the relay websocket a moment to flush the request before the browser
  // is backgrounded by the app switch.
  setTimeout(() => {
    window.location.href = scheme;
  }, 300);
};

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
    disconnectingRef,
    metamaskExplicitConnect,
    setSessionAesKey,
    setArePrivateBalancesHidden,
    executeSnapCheck,
  } = core;

  const { address: wagmiAddress, isConnected: wagmiConnected, chainId: wagmiChainId, connector: wagmiConnector } =
    useWagmiAccount();
  const wagmiConfig = useConfig();

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

    // WalletConnect sessions never surface MetaMask's 4902 "unrecognized chain"
    // error, so the add-chain fallback below would never fire. Instead, read the
    // approved session namespace: if the target chain is missing, push it with
    // wallet_addEthereumChain (EIP-3085) before switching, and deep-link the
    // wallet app to the foreground so the user sees the approval prompt.
    const wcSession = provider.session as
      | { namespaces?: Record<string, WalletConnectEip155Namespace> }
      | undefined;
    if (provider.isWalletConnect || wcSession?.namespaces) {
      const eip155 = wcSession?.namespaces?.['eip155'];
      const approvedChains = new Set<string>([
        ...(eip155?.chains ?? []),
        ...(eip155?.accounts ?? []).map(account => account.split(':').slice(0, 2).join(':')),
      ]);
      const targetCaip = `eip155:${parseInt(targetChainId, 16)}`;

      if (!approvedChains.has(targetCaip)) {
        const networkConfig = networks[targetChainId];
        if (!networkConfig) {
          logger.error('[switchNetworkViaWagmi] No network config for chainId', targetChainId);
          return false;
        }
        if (eip155?.methods && !eip155.methods.includes('wallet_addEthereumChain')) {
          logger.error(
            '[switchNetworkViaWagmi] Wallet session does not allow wallet_addEthereumChain;',
            'the network must be added manually in the wallet app',
          );
          return false;
        }
        try {
          const addRequest = provider.request({
            method: 'wallet_addEthereumChain',
            params: [networkConfig],
          });
          foregroundWalletApp(wagmiConnector as { id: string; rkDetails?: { id?: string } });
          await addRequest;
        } catch (addError) {
          logger.error('[switchNetworkViaWagmi] Wallet rejected wallet_addEthereumChain:', addError);
          return false;
        }
      }

      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: targetChainId }],
        });
        return true;
      } catch (switchError) {
        logger.error('[switchNetworkViaWagmi] Failed to switch after add:', switchError);
        return false;
      }
    }

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
    networkName: metamaskNetworkName,
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
      if (wagmiSyncRef.current || wagmiConnected || disconnectingRef.current) {
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
      if (wagmiSyncRef.current || wagmiConnected || disconnectingRef.current) {
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
      if (wagmiSyncRef.current || wagmiConnected || disconnectingRef.current) return;
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
  const networkName = useMemo(
    () => (chainId ? getNetworkNameForChain(chainId) : metamaskNetworkName),
    [chainId, metamaskNetworkName],
  );

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
    wagmiConfig,
    ...networkEnforcer,
  };
};

export type PrivacyBridgeNetworkSession = ReturnType<typeof usePrivacyBridgeNetworkSession>;
