import { useEffect, useCallback, useState } from 'react';
import { logger } from '../lib/logger';
import { useSwitchChain, useAccount } from 'wagmi';
import { getPluginConfig } from '../config/plugin';
import { COTI_MAINNET_CHAIN_ID, isSupportedChain } from '../chains';
import { useWalletType } from './useWalletType';

export interface NetworkEnforcerResult {
  /** Whether the connected wallet is on an unsupported network */
  isWrongNetwork: boolean;
  /** Error/warning message when network switch is rejected or fails */
  networkMismatchWarning: string | null;
  /** Manually trigger network enforcement */
  enforceNetwork: () => Promise<void>;
}

/**
 * Network enforcement hook that supports both MetaMask (direct RPC) and
 * non-MetaMask wallets (wagmi useSwitchChain).
 *
 * - MetaMask path: uses the provided `switchNetwork` callback (wallet_switchEthereumChain)
 * - Non-MetaMask path: uses wagmi's `useSwitchChain` hook for chain switching
 * - Both paths treat any {@link CHAIN_CONFIGS} chain as valid for {@link isWrongNetwork}
 * - {@link enforceNetwork} switches to the configured target when current chain ≠ target (both paths)
 *
 * @param chainId - Current chain ID as a string (decimal or hex), used for MetaMask path
 * @param switchNetwork - MetaMask-specific network switch function (wallet_switchEthereumChain)
 */
export const useNetworkEnforcer = (
  chainId: string | null,
  switchNetwork: (chainId: string) => Promise<boolean>
): NetworkEnforcerResult => {
  const { chain } = useAccount();
  const { isMetaMaskWithSnap, walletType } = useWalletType();
  const { switchChainAsync } = useSwitchChain();
  const [networkMismatchWarning, setNetworkMismatchWarning] = useState<string | null>(null);

  const envDefaultNetwork = getPluginConfig().defaultNetworkId;

  /**
   * Determines the target chain ID to enforce.
   * Uses the plugin config's defaultNetworkId if set, otherwise defaults to COTI Mainnet.
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
    return COTI_MAINNET_CHAIN_ID;
  }, [envDefaultNetwork]);

  /**
   * Checks if the current network is wrong based on the wallet type.
   */
  const isWrongNetwork = useCallback((): boolean => {
    if (walletType === 'metamask' || isMetaMaskWithSnap) {
      // MetaMask path: use the chainId string prop
      if (!chainId) return false;
      try {
        const currentChainNum = chainId.startsWith('0x')
          ? parseInt(chainId, 16)
          : Number(chainId);
        return !isSupportedChain(currentChainNum);
      } catch {
        return false;
      }
    } else {
      // Non-MetaMask path: use wagmi's chain from useAccount
      if (!chain) return false;
      return !isSupportedChain(chain.id);
    }
  }, [chainId, chain, walletType, isMetaMaskWithSnap]);

  /**
   * Enforce network switch.
   * - MetaMask: uses existing switchNetwork via wallet_switchEthereumChain
   * - Non-MetaMask: uses wagmi useSwitchChain
   */
  const enforceNetwork = useCallback(async () => {
    const targetChainId = getTargetChainId();

    if (walletType === 'metamask' || isMetaMaskWithSnap) {
      // MetaMask path: continue using existing switchNetwork via wallet_switchEthereumChain
      if (!chainId) return;

      let currentChainIdHex = '';
      try {
        currentChainIdHex = '0x' + BigInt(chainId).toString(16);
      } catch {
        currentChainIdHex = chainId.startsWith('0x')
          ? chainId
          : '0x' + Number(chainId).toString(16);
      }

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
      // Non-MetaMask path: use wagmi useSwitchChain (same rule as MetaMask — switch when not on target)
      if (!chain) return;

      if (chain.id !== targetChainId) {
        logger.warn(
          `[NetworkEnforcer] Non-MetaMask wallet on chain ${chain.id}. Enforcing: ${targetChainId}`
        );
        try {
          await switchChainAsync({ chainId: targetChainId });
          setNetworkMismatchWarning(null);
        } catch (err) {
          logger.error('[NetworkEnforcer] wagmi switchChain error:', err);
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
    switchChainAsync,
    getTargetChainId,
  ]);

  // Auto-enforce on chain changes (disabled in favor of NetworkGuard UI, but available)
  useEffect(() => {
    // Automatic enforcement is disabled in favor of NetworkGuard UI
    // enforceNetwork();
  }, [enforceNetwork]);

  // Clear warning when network becomes correct
  useEffect(() => {
    if (!isWrongNetwork()) {
      setNetworkMismatchWarning(null);
    }
  }, [isWrongNetwork]);

  return {
    isWrongNetwork: isWrongNetwork(),
    networkMismatchWarning,
    enforceNetwork,
  };
};
