import { useEffect, useCallback, useState } from 'react';
import { logger } from '../lib/logger';
import { useAccount } from 'wagmi';
import { getPluginConfig } from '../config/plugin';
import { DEFAULT_CHAIN_ID, isSupportedChain } from '../chains';
import { useWalletType } from './useWalletType';

export interface NetworkEnforcerResult {
  /** Wallet is on a chain outside {@link CHAIN_CONFIGS} */
  isUnsupportedNetwork: boolean;
  /** Wallet is on a supported chain but not the configured enforcement target */
  isOffTargetNetwork: boolean;
  /**
   * @deprecated Use {@link isUnsupportedNetwork}. Kept for backward compatibility.
   */
  isWrongNetwork: boolean;
  /** Error/warning message when network switch is rejected or fails */
  networkMismatchWarning: string | null;
  /** Manually trigger network enforcement (switches to configured target) */
  enforceNetwork: () => Promise<void>;
}

/**
 * Network enforcement hook that supports both MetaMask (direct RPC) and
 * non-MetaMask wallets.
 *
 * - Both paths use the provided `switchNetwork` callback (the unified router),
 *   which handles WalletConnect sessions (namespace check, wallet_addEthereumChain
 *   push, deep-link foregrounding) as well as injected providers
 * - {@link isUnsupportedNetwork}: chain ∉ {@link CHAIN_CONFIGS}
 * - {@link isOffTargetNetwork}: supported chain ≠ configured target ({@link getTargetChainId})
 * - {@link enforceNetwork} switches to the configured target when current chain ≠ target
 *
 * @param chainId - Current chain ID as a string (decimal or hex), used for MetaMask path
 * @param switchNetwork - Network switch function (wallet_switchEthereumChain or unified router)
 */
export const useNetworkEnforcer = (
  chainId: string | null,
  switchNetwork: (chainId: string) => Promise<boolean>
): NetworkEnforcerResult => {
  const { chain } = useAccount();
  const { isMetaMaskWithSnap, walletType } = useWalletType();
  const [networkMismatchWarning, setNetworkMismatchWarning] = useState<string | null>(null);

  const envDefaultNetwork = getPluginConfig().defaultNetworkId;

  /**
   * Determines the target chain ID to enforce.
   * Uses the plugin config's defaultNetworkId if set, otherwise {@link DEFAULT_CHAIN_ID} (COTI Testnet).
   */
  const getTargetChainId = useCallback((): number => {
    if (envDefaultNetwork) {
      try {
        const parsed = envDefaultNetwork.startsWith('0x')
          ? parseInt(envDefaultNetwork, 16)
          : Number(envDefaultNetwork);
        if (isSupportedChain(parsed)) return parsed;
      } catch {
        // Fall through to default
      }
    }
    return DEFAULT_CHAIN_ID;
  }, [envDefaultNetwork]);

  const getCurrentChainNum = useCallback((): number | null => {
    if (walletType === 'metamask' || isMetaMaskWithSnap) {
      if (!chainId) return null;
      try {
        return chainId.startsWith('0x')
          ? parseInt(chainId, 16)
          : Number(chainId);
      } catch {
        return null;
      }
    }
    return chain?.id ?? null;
  }, [chainId, chain, walletType, isMetaMaskWithSnap]);

  const isUnsupportedNetwork = useCallback((): boolean => {
    const current = getCurrentChainNum();
    if (current == null) return false;
    return !isSupportedChain(current);
  }, [getCurrentChainNum]);

  const isOffTargetNetwork = useCallback((): boolean => {
    const current = getCurrentChainNum();
    if (current == null || !isSupportedChain(current)) return false;
    return current !== getTargetChainId();
  }, [getCurrentChainNum, getTargetChainId]);

  /**
   * Enforce network switch.
   * Both MetaMask and non-MetaMask wallets use the provided `switchNetwork`
   * router, which picks the right transport (direct RPC, injected provider,
   * or WalletConnect add-chain + deep-link flow) for the active connection.
   */
  const enforceNetwork = useCallback(async () => {
    const targetChainId = getTargetChainId();

    if (walletType === 'metamask' || isMetaMaskWithSnap) {
      if (!chainId) return;

      const currentChainIdHex = (() => {
        try {
          return '0x' + BigInt(chainId).toString(16);
        } catch {
          return chainId.startsWith('0x')
            ? chainId
            : '0x' + Number(chainId).toString(16);
        }
      })();

      const targetHex = '0x' + targetChainId.toString(16);

      if (currentChainIdHex.toLowerCase() !== targetHex.toLowerCase()) {
        logger.warn(
          `[NetworkEnforcer] MetaMask on wrong network: ${currentChainIdHex}. Enforcing: ${targetHex}`
        );
        try {
          const success = await switchNetwork(targetHex);
          if (!success) {
            setNetworkMismatchWarning(
              'Network switch was rejected. Please switch to a supported network to continue.'
            );
          } else {
            setNetworkMismatchWarning(null);
          }
        } catch (err) {
          logger.error('[NetworkEnforcer] MetaMask switch error:', err);
          setNetworkMismatchWarning(
            'Failed to switch network. Please switch to a supported network manually.'
          );
        }
      }
    } else {
      if (!chain) return;

      if (chain.id !== targetChainId) {
        logger.warn(
          `[NetworkEnforcer] Non-MetaMask wallet on chain ${chain.id}. Enforcing: ${targetChainId}`
        );
        const targetHex = '0x' + targetChainId.toString(16);
        try {
          // Route through the unified switchNetwork router rather than wagmi's
          // switchChainAsync: for WalletConnect sessions it pre-checks the
          // approved namespace, pushes the chain with wallet_addEthereumChain
          // and deep-links the wallet app to the foreground so the user
          // actually sees the approval prompt.
          const success = await switchNetwork(targetHex);
          if (!success) {
            setNetworkMismatchWarning(
              'Network switch was rejected. Please switch to a supported network to continue.'
            );
          } else {
            setNetworkMismatchWarning(null);
          }
        } catch (err) {
          logger.error('[NetworkEnforcer] switchNetwork error:', err);
          setNetworkMismatchWarning(
            'Network switch was rejected. Please switch to a supported network to continue.'
          );
        }
      }
    }
  }, [
    chainId,
    chain,
    walletType,
    isMetaMaskWithSnap,
    switchNetwork,
    getTargetChainId,
  ]);

  const unsupported = isUnsupportedNetwork();
  const offTarget = isOffTargetNetwork();

  // Auto-enforce on chain changes (disabled in favor of NetworkGuard UI, but available)
  useEffect(() => {
    // Automatic enforcement is disabled in favor of NetworkGuard UI
    // enforceNetwork();
  }, [enforceNetwork]);

  // Clear warning when on the configured target (supported and not off-target)
  useEffect(() => {
    if (!unsupported && !offTarget) {
      setNetworkMismatchWarning(null);
    }
  }, [unsupported, offTarget]);

  return {
    isUnsupportedNetwork: unsupported,
    isOffTargetNetwork: offTarget,
    isWrongNetwork: unsupported,
    networkMismatchWarning,
    enforceNetwork,
  };
};
