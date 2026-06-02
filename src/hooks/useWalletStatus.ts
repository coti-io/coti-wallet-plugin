import { useState, useCallback, useMemo } from 'react';
import { useAccount, useSwitchChain, useDisconnect } from 'wagmi';
import { isValidChain } from '../lib/crossChainUtils';

/**
 * Result interface for the wallet status hook.
 *
 * Provides comprehensive wallet connection information including chain validity
 * for cross-chain bridge operations, network switching, and disconnect capability.
 */
export interface UseWalletStatusResult {
  /** Whether the wallet is currently connected. */
  isConnected: boolean;
  /** The connected wallet address as a hex string, or empty string when disconnected. */
  address: string;
  /** The current chain ID as a number, or null when disconnected. */
  chainId: number | null;
  /** Whether the current chain ID is valid for cross-chain bridge operations in the active environment. */
  isValidChain: boolean;
  /** Switches the wallet to the specified chain ID. Captures errors into switchError state. */
  switchChain: (chainId: number) => Promise<void>;
  /** Error message from the last failed chain switch attempt, or null. */
  switchError: string | null;
  /** Disconnects the wallet, resetting all state. */
  disconnect: () => void;
}

/**
 * Hook that provides wallet status information including chain validation
 * and network switching for cross-chain bridge operations.
 *
 * Uses wagmi's `useAccount` for connection status, `useSwitchChain` for
 * network switching, and `useDisconnect` for wallet disconnection.
 *
 * Chain validity is determined by checking if the current chain ID belongs
 * to the active Chain_Pair for the current environment (testnet or mainnet),
 * using the connected wallet's own chainId to resolve the environment.
 *
 * @example
 * ```tsx
 * const { isConnected, isValidChain, switchChain, switchError } = useWalletStatus();
 *
 * if (!isValidChain) {
 *   await switchChain(7082400); // Switch to COTI Testnet
 * }
 * ```
 */
export function useWalletStatus(): UseWalletStatusResult {
  const { isConnected, address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { disconnect: wagmiDisconnect } = useDisconnect();

  const [switchError, setSwitchError] = useState<string | null>(null);

  /**
   * Switches the wallet to the specified chain ID.
   * On failure (user rejection or RPC error), captures the error message
   * into switchError state without altering the current chain or connection.
   */
  const handleSwitchChain = useCallback(
    async (targetChainId: number): Promise<void> => {
      setSwitchError(null);
      try {
        await switchChainAsync({ chainId: targetChainId });
      } catch (error: any) {
        const message =
          error?.shortMessage || error?.message || 'Failed to switch chain';
        setSwitchError(message);
      }
    },
    [switchChainAsync]
  );

  /**
   * Disconnects the wallet via wagmi's useDisconnect.
   */
  const handleDisconnect = useCallback(() => {
    setSwitchError(null);
    wagmiDisconnect();
  }, [wagmiDisconnect]);

  /**
   * Determines chain validity by checking if the connected chain ID
   * is in the active Chain_Pair. Uses the chainId itself to resolve
   * the environment (testnet vs mainnet).
   */
  const chainIsValid = useMemo(() => {
    if (!isConnected || chainId == null) {
      return false;
    }
    return isValidChain(chainId, chainId);
  }, [isConnected, chainId]);

  return {
    isConnected: isConnected ?? false,
    address: isConnected && address ? address : '',
    chainId: isConnected && chainId != null ? chainId : null,
    isValidChain: chainIsValid,
    switchChain: handleSwitchChain,
    switchError,
    disconnect: handleDisconnect,
  };
}
