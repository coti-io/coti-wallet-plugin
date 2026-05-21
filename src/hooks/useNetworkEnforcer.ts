import { useEffect, useCallback, useState } from 'react';
import { useSwitchChain, useAccount } from 'wagmi';
import { getPluginConfig } from '../config/plugin';
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from '../config/chains';
import { useWalletType } from './useWalletType';

/** Allowed COTI chain IDs */
const ALLOWED_CHAIN_IDS = [COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID];

/**
 * Determines if a chain ID is a supported COTI chain.
 */
function isCotiChain(chainId: number): boolean {
  return ALLOWED_CHAIN_IDS.includes(chainId);
}

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
 * - Both paths enforce COTI Mainnet (2632500) or Testnet (7082400) only
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
  const { switchChain } = useSwitchChain();
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
        if (isCotiChain(parsed)) return parsed;
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
        return !isCotiChain(currentChainNum);
      } catch {
        return false;
      }
    } else {
      // Non-MetaMask path: use wagmi's chain from useAccount
      if (!chain) return false;
      return !isCotiChain(chain.id);
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
        console.warn(
          `[NetworkEnforcer] MetaMask on wrong network: ${currentChainIdHex}. Enforcing: ${targetHex}`
        );
        try {
          const success = await switchNetwork(targetHex);
          if (!success) {
            setNetworkMismatchWarning(
              'Network switch was rejected. Please switch to a COTI network to continue.'
            );
          } else {
            setNetworkMismatchWarning(null);
          }
        } catch (err) {
          console.error('[NetworkEnforcer] MetaMask switch error:', err);
          setNetworkMismatchWarning(
            'Failed to switch network. Please switch to a COTI network manually.'
          );
        }
      }
    } else {
      // Non-MetaMask path: use wagmi useSwitchChain
      if (!chain) return;

      if (!isCotiChain(chain.id)) {
        console.warn(
          `[NetworkEnforcer] Non-MetaMask wallet on wrong network: ${chain.id}. Enforcing: ${targetChainId}`
        );
        try {
          switchChain({ chainId: targetChainId });
          setNetworkMismatchWarning(null);
        } catch (err) {
          console.error('[NetworkEnforcer] wagmi switchChain error:', err);
          setNetworkMismatchWarning(
            'Network switch was rejected. Please switch to a COTI network to continue.'
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
    switchChain,
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
