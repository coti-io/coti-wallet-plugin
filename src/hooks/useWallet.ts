import { useState, useCallback, useRef } from 'react';
import { useMetamask } from './useMetamask';
import { useSnap } from './useSnap';

/**
 * Result interface for the unified wallet hook.
 *
 * Composes MetaMask connection/network management with COTI Snap AES key
 * retrieval into a single consumer-facing API. Consumers should prefer the
 * unified methods (`connect`, `disconnect`, `getAesKey`, `unlockPrivateBalances`)
 * over the Snap-specific escape hatches unless backward compatibility requires them.
 */
export interface UseWalletResult {
  // ─── Connection ───────────────────────────────────────────────────────────────
  /** Whether the wallet is currently connected. */
  isConnected: boolean;
  /** The currently connected wallet address (checksummed or lowercase). */
  walletAddress: string;
  /** Initiates the wallet connection flow (MetaMask permissions + account retrieval). */
  connect: () => Promise<void>;
  /** Disconnects the wallet, clears all session state and caches. */
  disconnect: () => Promise<void>;

  // ─── Network ──────────────────────────────────────────────────────────────────
  /** Human-readable name of the current network (e.g. "COTI Mainnet"). */
  networkName: string;
  /** Current chain ID as a decimal string, or null if unknown. */
  chainId: string | null;
  /** Requests a network switch to the given hex chain ID. Returns true on success. */
  switchNetwork: (chainId: string) => Promise<boolean>;

  // ─── AES Key (unified) ────────────────────────────────────────────────────────
  /**
   * Retrieves the AES key for the given address.
   * Currently routes to the Snap path; in the future may route to the onboard contract.
   */
  getAesKey: (address: string) => Promise<string | null>;
  /** The current session AES key (React state only, never persisted to storage). */
  sessionAesKey: string | null;
  /** Whether private balances are currently unlocked (session key is set). */
  isPrivateUnlocked: boolean;
  /**
   * Fetches the AES key and sets it as the session key, unlocking private balances.
   * Returns true on success, false if the user rejected or an error occurred.
   */
  unlockPrivateBalances: () => Promise<boolean>;
  /** Clears the session key and snap cache, locking private balances. */
  lockPrivateBalances: () => void;
  /** Clears the internal AES key cache (forces re-fetch on next unlock). */
  clearKeyCache: () => void;

  // ─── Snap-specific (backward compat) ─────────────────────────────────────────
  /** Checks whether the COTI Snap is installed and connected to this origin. */
  isSnapInstalled: () => Promise<boolean>;
  /** Requests permission to connect to the COTI Snap. Returns true on success. */
  connectToSnap: () => Promise<boolean>;
  /** Current Snap error message, or null. */
  snapError: string | null;

  // ─── Onboarding ───────────────────────────────────────────────────────────────
  /**
   * Triggers the manual onboarding flow (generate/recover AES key via SDK).
   * Returns the generated key on success, or null.
   */
  handleOnboard: () => Promise<string | null>;

  // ─── MetaMask detection ───────────────────────────────────────────────────────
  /** Whether MetaMask (window.ethereum) was detected. */
  metamaskDetected: boolean;
  /** Whether the "Install MetaMask" modal should be shown. */
  showInstallModal: boolean;
  /** Controls visibility of the install modal. */
  setShowInstallModal: (show: boolean) => void;

  // ─── Constants ────────────────────────────────────────────────────────────────
  /** Hex chain ID for COTI Mainnet. */
  COTI_MAINNET_ID: string;
  /** Hex chain ID for COTI Testnet. */
  COTI_TESTNET_ID: string;
}

/**
 * Unified wallet hook that composes `useMetamask` and `useSnap` into a single
 * consumer-facing API for wallet connection, network management, and AES key
 * lifecycle.
 *
 * @example
 * ```tsx
 * const {
 *   isConnected, connect, disconnect,
 *   sessionAesKey, unlockPrivateBalances, lockPrivateBalances,
 * } = useWallet();
 * ```
 *
 * @remarks
 * - The AES key is held in React state only — never written to localStorage or sessionStorage.
 * - On disconnect or account change the session key is automatically cleared.
 * - The underlying `useMetamask` and `useSnap` hooks remain as internal implementations
 *   and are not deleted.
 */
export const useWallet = (): UseWalletResult => {
  // ─── Local state ────────────────────────────────────────────────────────────
  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [sessionAesKey, setSessionAesKey] = useState<string | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [metamaskDetected, setMetamaskDetected] = useState(
    typeof window !== 'undefined' && typeof window.ethereum !== 'undefined'
  );

  const ethereumListenerRegistered = useRef(false);
  const handleConnectRef = useRef<() => Promise<void>>();

  // ─── Compose useSnap ────────────────────────────────────────────────────────
  const {
    isSnapInstalled,
    connectToSnap,
    getAESKeyFromSnap,
    handleManualOnboarding,
    clearSnapCache,
  } = useSnap(setSnapError);

  // ─── Compose useMetamask ────────────────────────────────────────────────────
  const {
    networkName,
    chainId,
    switchNetwork,
    connectWallet,
    checkNetwork,
    registerEthereumInitializedListener,
    COTI_MAINNET_ID,
    COTI_TESTNET_ID,
  } = useMetamask({
    onAccountChanged: async (account: string) => {
      // If account didn't actually change, skip
      if (walletAddress && account.toLowerCase() === walletAddress.toLowerCase()) {
        return;
      }
      // Clear session key on account change
      setSessionAesKey(null);
      setWalletAddress(account);
      setIsConnected(true);
    },
    onDisconnect: () => {
      setIsConnected(false);
      setWalletAddress('');
      setSessionAesKey(null);
    },
  });

  // ─── Connection ─────────────────────────────────────────────────────────────

  /**
   * Initiates the MetaMask connection flow.
   * On success, sets `isConnected` and `walletAddress`.
   * If MetaMask is not installed, shows the install modal and registers a
   * listener for late injection.
   */
  const connect = useCallback(async (): Promise<void> => {
    if (!window.ethereum && ethereumListenerRegistered.current) {
      return;
    }
    try {
      await connectWallet(async (account: string) => {
        setWalletAddress(account);
        setIsConnected(true);
      });
      setMetamaskDetected(true);
    } catch (error: any) {
      if (error.message === 'METAMASK_NOT_INSTALLED') {
        setMetamaskDetected(false);
        setShowInstallModal(true);
        if (!ethereumListenerRegistered.current) {
          registerEthereumInitializedListener(() => {
            ethereumListenerRegistered.current = false;
            setShowInstallModal(false);
            setMetamaskDetected(true);
            handleConnectRef.current?.();
          });
          ethereumListenerRegistered.current = true;
        }
      }
    }
  }, [connectWallet, registerEthereumInitializedListener, walletAddress]);

  // Keep ref in sync for the ethereum#initialized callback
  handleConnectRef.current = connect;

  /**
   * Disconnects the wallet: revokes MetaMask permissions, clears all local state
   * and the Snap AES key cache.
   */
  const disconnect = useCallback(async (): Promise<void> => {
    if (window.ethereum) {
      try {
        await (window.ethereum as any).request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        });
      } catch {
        // wallet_revokePermissions may not be supported — non-critical
      }
    }
    setIsConnected(false);
    setWalletAddress('');
    setSessionAesKey(null);
    clearSnapCache();
  }, [clearSnapCache]);

  // ─── AES Key lifecycle ──────────────────────────────────────────────────────

  /**
   * Retrieves the AES key for the given address via the Snap.
   * In the future this will route to the onboard contract for non-MetaMask wallets.
   */
  const getAesKey = useCallback(
    async (address: string): Promise<string | null> => {
      return getAESKeyFromSnap(address);
    },
    [getAESKeyFromSnap]
  );

  /**
   * Fetches the AES key for the current wallet address and stores it as the
   * session key, effectively unlocking private balances.
   *
   * @returns `true` if the key was successfully retrieved and set.
   */
  const unlockPrivateBalances = useCallback(async (): Promise<boolean> => {
    if (!walletAddress) return false;
    try {
      const key = await getAesKey(walletAddress);
      if (key) {
        setSessionAesKey(key);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [walletAddress, getAesKey]);

  /**
   * Clears the session AES key and the Snap's internal cache, locking private
   * balances until the user explicitly unlocks again.
   */
  const lockPrivateBalances = useCallback((): void => {
    setSessionAesKey(null);
    clearSnapCache();
  }, [clearSnapCache]);

  /**
   * Clears only the internal AES key cache without affecting the session key.
   * Forces a fresh retrieval on the next `getAesKey` / `unlockPrivateBalances` call.
   */
  const clearKeyCache = useCallback((): void => {
    clearSnapCache();
  }, [clearSnapCache]);

  // ─── Onboarding ─────────────────────────────────────────────────────────────

  /**
   * Triggers the manual onboarding flow (generate/recover AES key via SDK).
   * On success, persists the key to the Snap and sets it as the session key.
   *
   * @returns The generated AES key, or null if the flow was cancelled/failed.
   */
  const handleOnboard = useCallback(async (): Promise<string | null> => {
    const key = await handleManualOnboarding();
    if (key) {
      setSessionAesKey(key);
    }
    return key;
  }, [handleManualOnboarding]);

  // ─── Derived state ──────────────────────────────────────────────────────────
  const isPrivateUnlocked = sessionAesKey !== null;

  // ─── Return unified interface ───────────────────────────────────────────────
  return {
    // Connection
    isConnected,
    walletAddress,
    connect,
    disconnect,

    // Network
    networkName,
    chainId,
    switchNetwork,

    // AES Key (unified)
    getAesKey,
    sessionAesKey,
    isPrivateUnlocked,
    unlockPrivateBalances,
    lockPrivateBalances,
    clearKeyCache,

    // Snap-specific (backward compat)
    isSnapInstalled,
    connectToSnap,
    snapError,

    // Onboarding
    handleOnboard,

    // MetaMask detection
    metamaskDetected,
    showInstallModal,
    setShowInstallModal,

    // Constants
    COTI_MAINNET_ID,
    COTI_TESTNET_ID,
  };
};
