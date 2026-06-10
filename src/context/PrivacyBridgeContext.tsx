import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAccount as useWagmiAccount, useDisconnect as useWagmiDisconnect } from 'wagmi';
import { useMetamask } from '../hooks/useMetamask';
import { useSnap } from '../hooks/useSnap';
import { useBalanceUpdater } from '../hooks/useBalanceUpdater';
import { usePrivateTokenBalance } from '../hooks/usePrivateTokenBalance';
import { useNetworkEnforcer } from '../hooks/useNetworkEnforcer';
import { isChainUpdatesMuted } from '../lib/chainMute';
import { usePrivacyBridge, Token, getInitialPublicTokens, getInitialPrivateTokens, type SwapProgressStage } from '../hooks/usePrivacyBridge';
import { saveAesKeyLocally, unlockCachedAesKey as unlockCachedAesKeyFromVault } from '../crypto/localAesKeyVault';
import { loadPodRequests, savePodRequests } from '../pod/podPortalRequestsStorage';
import { getUnlockStrategyForChain, getWalletNetworkConfigs } from '../chains';
import { SEPOLIA_CHAIN_ID, type PodPortalRequest } from '../contracts/pod';
import { resolvePodRequestStatus } from '../chains/portal/podRequestStatus';
import { isMultipleWalletsError } from '../utils/walletErrors';
import { useWalletType } from '../hooks/useWalletType';
import { useAesKeyProvider } from '../hooks/useAesKeyProvider';

interface PrivacyBridgeContextType {
    isConnected: boolean;
    walletAddress: string;
    hasSnap: boolean;
    snapError: string | null;
    connectToSnap: () => Promise<boolean>;
    publicTokens: Token[];
    privateTokens: Token[];
    isBridgingLoading: boolean;
    handleConnect: () => Promise<void>;
    handleSwap: (
        amount?: string,
        direction?: 'to-private' | 'to-public',
        tokenIndex?: number,
        onProgress?: (stage: SwapProgressStage, txHash?: string) => void
    ) => Promise<void>;

    // Expose setters or other hook returns if needed by children
    setAmount: (amount: string) => void;
    setDirection: (direction: 'to-private' | 'to-public') => void;
    setSelectedTokenIndex: (index: number) => void;
    amount: string;
    direction: 'to-private' | 'to-public';
    selectedTokenIndex: number;
    // Approval
    isApprovalNeeded: boolean;
    isApproving: boolean;
    handleApprove: () => Promise<void>;
    handleOnboard: () => Promise<string | null>;
    saveManualAesKey: (aesKey: string) => Promise<void>;
    unlockCachedAesKey: () => Promise<void>;
    handleVerifyKeys: () => Promise<void>;
    handleDisconnect: () => Promise<void>;
    // Network Switch
    switchNetwork: (chainId: string) => Promise<boolean>;
    networkName: string;
    COTI_MAINNET_ID: string;
    COTI_TESTNET_ID: string;
    SEPOLIA_ID: string;
    refreshPrivateBalances: () => Promise<boolean>;
    lockPrivateBalances: () => void;
    chainId: string | null;
    sessionAesKey: string | null;
    isPrivateUnlocked: boolean;
    estimatedGasFee: string | null;
    showInstallModal: boolean;
    setShowInstallModal: (show: boolean) => void;
    updateGasFee: () => Promise<void>;
    isGasEstimating: boolean;
    portalFeeCoti: string | null;
    feeDebugInfo: { cotiLastUpdated: string; tokenLastUpdated: string; blockTimestamp: string } | null;
    showSnapMissingModal: boolean;
    setShowSnapMissingModal: (show: boolean) => void;
    requestSnapConnection: () => Promise<boolean>;
    metamaskDetected: boolean;
    podRequests: PodPortalRequest[];
    refreshPodRequest: (request: PodPortalRequest) => Promise<void>;
    showCotiWalletAesKeyModal: boolean;
    setShowCotiWalletAesKeyModal: (show: boolean) => void;
    showMultipleWalletsModal: boolean;
    setShowMultipleWalletsModal: (show: boolean) => void;
}

const PrivacyBridgeContext = createContext<PrivacyBridgeContextType | undefined>(undefined);

export const PrivacyBridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {

    // Global State
    const [isConnected, setIsConnected] = useState(false);
    const [walletAddress, setWalletAddress] = useState('');
    const [hasSnap, setHasSnap] = useState(false);
    const [snapError, setSnapError] = useState<string | null>(null);
    const [publicTokens, setPublicTokens] = useState<Token[]>(getInitialPublicTokens());
    const [privateTokens, setPrivateTokens] = useState<Token[]>(getInitialPrivateTokens());
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [showSnapMissingModal, setShowSnapMissingModal] = useState(false);
    const [showCotiWalletAesKeyModal, setShowCotiWalletAesKeyModal] = useState(false);
    const [showMultipleWalletsModal, setShowMultipleWalletsModal] = useState<boolean>(false);
    const [metamaskDetected, setMetamaskDetected] = useState(false);
    const ethereumListenerRegistered = useRef(false);
    // Track whether the current session was initiated via RainbowKit (COTI Wallet button)
    const wagmiSyncRef = useRef(false);
    // Track whether the user explicitly clicked the MetaMask button
    const metamaskExplicitConnect = useRef(false);

    // Auto-open Snap Required modal the first time a snap error appears
    useEffect(() => {
        if (snapError) {
            setShowSnapMissingModal(true);
        }
    }, [snapError]);

    // Global unhandled rejection listener for multiple wallets error
    useEffect(() => {
        const handler = (event: PromiseRejectionEvent) => {
            const message =
                event.reason?.message ?? (typeof event.reason === 'string' ? event.reason : '');
            if (isMultipleWalletsError(message)) {
                event.preventDefault();
                setShowMultipleWalletsModal(true);
            }
        };

        window.addEventListener('unhandledrejection', handler);
        return () => {
            window.removeEventListener('unhandledrejection', handler);
        };
    }, []);

    // Transaction State
    const [amount, setAmount] = useState('');
    const [direction, setDirection] = useState<'to-private' | 'to-public'>('to-private');
    const [selectedTokenIndex, setSelectedTokenIndex] = useState(0);
    const [toastState, setToastState] = useState({ visible: false, title: '', message: '' as React.ReactNode });
    const [error, setError] = useState<{ title: string; message: string } | null>(null);
    /**
     * Session AES key is stored with the wallet it belongs to. Without this, switching
     * MetaMask accounts can briefly apply the previous user's key to the new user's
     * ciphertext (PoD / manual AES) and show nonsense balances.
     */
    const [sessionKeyRecord, setSessionKeyRecord] = useState<{ wallet: string; key: string } | null>(null);

    const sessionAesKey = useMemo(() => {
        if (!sessionKeyRecord || !walletAddress) return null;
        if (sessionKeyRecord.wallet.toLowerCase() !== walletAddress.toLowerCase()) return null;
        return sessionKeyRecord.key;
    }, [sessionKeyRecord, walletAddress]);

    const setSessionAesKey = useCallback((key: string | null, keyWallet?: string) => {
        if (key == null || key === '') {
            setSessionKeyRecord(null);
            return;
        }
        const w = keyWallet ?? walletAddress;
        if (!w) {
            console.warn('setSessionAesKey: no wallet for key binding; clearing');
            setSessionKeyRecord(null);
            return;
        }
        setSessionKeyRecord({ wallet: w.toLowerCase(), key });
    }, [walletAddress]);

    const [arePrivateBalancesHidden, setArePrivateBalancesHidden] = useState(true);

    // Logic: Unhide when session key becomes available
    useEffect(() => {
        if (sessionAesKey) {
            setArePrivateBalancesHidden(false);
        }
    }, [sessionAesKey]);

    // Initialize Hooks
    const {
        isSnapInstalled,
        executeSnapCheck,
        getAESKeyFromSnap,
        saveAESKeyToSnap,
        connectToSnap,
        requestSnapConnection,
        handleManualOnboarding,
        handleKeyVerification,
        clearSnapCache
    } = useSnap(setSnapError);

    const walletTypeInfo = useWalletType();
    const { getAesKey: getAesKeyFromProvider } = useAesKeyProvider(walletTypeInfo);

    // Helper to fetch private balance (needed by useBalanceUpdater)
    // Using the plugin's usePrivateTokenBalance hook
    const { fetchPrivateBalance } = usePrivateTokenBalance();

    // Wagmi state — used when the user connects via "COTI Wallet" (RainbowKit).
    // MUST be read before useMetamask so we can use it in the chainId derivation.
    const { address: wagmiAddress, isConnected: wagmiConnected, chainId: wagmiChainId, connector: wagmiConnector } = useWagmiAccount();
    const { disconnect: wagmiDisconnect } = useWagmiDisconnect();

    /**
     * Switch network via the wagmi connector's provider directly.
     * Uses wallet_switchEthereumChain / wallet_addEthereumChain on the
     * actual connected wallet's provider (not window.ethereum).
     */
    const switchNetworkViaWagmiProvider = useCallback(async (targetChainId: string): Promise<boolean> => {
        if (!wagmiConnector) {
            console.warn("[switchNetworkViaWagmi] No wagmi connector available");
            return false;
        }

        // Get the provider directly from the connector
        let provider: any;
        try {
            provider = await wagmiConnector.getProvider();
        } catch (e) {
            console.warn("[switchNetworkViaWagmi] Failed to get provider from connector:", e);
            return false;
        }

        if (!provider?.request) {
            console.warn("[switchNetworkViaWagmi] Provider has no request method");
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
                    console.error("[switchNetworkViaWagmi] No network config for", targetChainId);
                    return false;
                }
                try {
                    await provider.request({
                        method: 'wallet_addEthereumChain',
                        params: [networkConfig],
                    });
                    return true;
                } catch (addError) {
                    console.error("[switchNetworkViaWagmi] Failed to add chain:", addError);
                    return false;
                }
            }
            console.error("[switchNetworkViaWagmi] Failed to switch:", switchError);
            return false;
        }
    }, [wagmiConnector]);

    const { connectWallet, checkNetwork, switchNetwork: metamaskSwitchNetwork, networkName, COTI_MAINNET_ID, COTI_TESTNET_ID, SEPOLIA_ID, chainId: metamaskChainId, registerEthereumInitializedListener } = useMetamask({
        onAccountChanged: async (account) => {
            // Ignore MetaMask events when connected via RainbowKit/wagmi
            if (wagmiSyncRef.current || wagmiConnected) {
                console.log("ℹ️ Ignoring MetaMask accountsChanged — wagmi is managing connection");
                return;
            }

            // Ignore MetaMask auto-detection unless user explicitly clicked MetaMask button
            if (!metamaskExplicitConnect.current && !isConnected) {
                console.log("ℹ️ Ignoring MetaMask auto-detection — user hasn't clicked MetaMask");
                return;
            }

            // Prevent spurious updates if account is same (ignoring case)
            if (walletAddress && account.toLowerCase() === walletAddress.toLowerCase()) {
                console.log("ℹ️ Account unchanged, skipping session reset");
                return;
            }

            // Do not fetch private balances automatically on account change
            // Clear session key on account change
            console.log("👤 Account changed, clearing sessionAesKey and locking");
            setSessionAesKey(null);
            setArePrivateBalancesHidden(true);
            await updateAccountState(account, hasSnap, false);
        },
        onSnapCheck: async (account) => {
            // Ignore Snap checks when connected via RainbowKit/wagmi
            if (wagmiSyncRef.current || wagmiConnected) return;
            // Ignore unless user explicitly connected via MetaMask
            if (!metamaskExplicitConnect.current && !isConnected) return;

            await executeSnapCheck(async () => {
                // Snap found, but do not fetch private balances until requested
                await updateAccountState(account, true, false);
                return true;
            });
        }
    });

    // Enforce Network Policy
    useNetworkEnforcer(metamaskChainId, metamaskSwitchNetwork);

    // ─── Unified switchNetwork ───────────────────────────────────────────
    // Routes to wagmi connector provider when connected via RainbowKit,
    // or to useMetamask's switchNetwork when connected directly.
    const switchNetwork = useCallback(async (targetChainId: string): Promise<boolean> => {
        if (wagmiSyncRef.current) {
            return switchNetworkViaWagmiProvider(targetChainId);
        }
        return metamaskSwitchNetwork(targetChainId);
    }, [switchNetworkViaWagmiProvider, metamaskSwitchNetwork]);

    // ─── Effective chainId ───────────────────────────────────────────────
    // When connected via RainbowKit, wagmi's chainId is the source of truth.
    // Otherwise (MetaMask direct), useMetamask's chainId is the source of truth.
    const chainId = useMemo(() => {
        if (wagmiConnected && wagmiChainId) {
            // Convert numeric chainId to decimal string format (matches useMetamask output)
            return wagmiChainId.toString();
        }
        return metamaskChainId;
    }, [wagmiConnected, wagmiChainId, metamaskChainId]);

    const currentChainId = chainId ? Number(chainId) : undefined;
    const usesManualAesKey = getUnlockStrategyForChain(currentChainId) === 'manual-aes-key';

    const getAESKeyForCurrentNetwork = useCallback(async (accountAddress: string) => {
        // If we already have a session key, use it regardless of chain
        if (sessionAesKey) return sessionAesKey;

        // For manual-aes-key chains (Sepolia): try cached key first, then fall through to Snap
        if (usesManualAesKey) {
            const cachedKey = await unlockCachedAesKeyFromVault(accountAddress);
            if (cachedKey) return cachedKey;
        }

        return getAesKeyFromProvider(accountAddress);
    }, [getAesKeyFromProvider, usesManualAesKey, sessionAesKey]);

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
        setSessionAesKey
    });

    // Ref so the ethereum#initialized callback can call the latest handleConnect
    const handleConnectRef = useRef<() => Promise<void>>();

    // Orchestrate Connection
    const handleConnect = async () => {
        if (!window.ethereum && ethereumListenerRegistered.current) {
            return;
        }
        metamaskExplicitConnect.current = true;
        try {
            await connectWallet(async (account) => {
                // Initial update on connect (public only)
                await updateAccountState(account, false, false);
            });
        } catch (error: any) {
            console.error("Connection failed:", error);

            // Check for multiple wallets conflict FIRST
            if (isMultipleWalletsError(error?.message)) {
                setShowMultipleWalletsModal(true);
                return;
            }

            if (error.message === 'METAMASK_NOT_INSTALLED') {
                setShowInstallModal(true);
                if (!ethereumListenerRegistered.current) {
                    registerEthereumInitializedListener(() => {
                        // MetaMask just injected window.ethereum — reset guard and auto-connect
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

    // ─── Wagmi/RainbowKit account sync ───────────────────────────────────
    // When a user connects via RainbowKit (COTI Wallet button), wagmi's
    // useAccount fires with the new address. Sync it into our context so
    // balances are fetched and the UI updates.
    useEffect(() => {
        // Only act when wagmi is connected AND our context is NOT already connected
        // (avoids double-triggering when MetaMask flow already set isConnected)
        if (wagmiConnected && wagmiAddress && !isConnected) {
            console.log("🌈 RainbowKit connection detected, syncing to context:", wagmiAddress, "chain:", wagmiChainId);
            wagmiSyncRef.current = true;
            // Pass wagmiChainId so useBalanceUpdater uses RPC directly instead of window.ethereum
            updateAccountState(wagmiAddress, false, false, undefined, wagmiChainId);

            // If MetaMask is connected via RainbowKit, check for Snap availability.
            // useSnap now uses the EIP-6963 discovered MetaMask provider, which is
            // immune to hijacking by other wallets that own window.ethereum.
            const connectorId = wagmiConnector?.id?.toLowerCase() || '';
            const connectorName = wagmiConnector?.name?.toLowerCase() || '';
            const isMetaMask = connectorId.includes('metamask') || connectorName.includes('metamask') || connectorId === 'io.metamask';
            if (isMetaMask) {
                console.log("🦊 MetaMask detected via RainbowKit — checking Snap...");
                executeSnapCheck(async () => {
                    console.log("🦊 Snap found via RainbowKit MetaMask connection");
                    setHasSnap(true);
                    return true;
                });
            }
        }
        // If wagmi disconnects but we were synced via wagmi, clear state
        if (!wagmiConnected && wagmiSyncRef.current) {
            console.log("🌈 RainbowKit disconnected, clearing context");
            wagmiSyncRef.current = false;
            setIsConnected(false);
            setWalletAddress('');
            // We intentionally do NOT clear setSessionAesKey(null) here, so the
            // ephemeral AES key cache survives a temporary wallet lock.
            setArePrivateBalancesHidden(true);
        }

        // If wagmi account switches while connected, clear state and update
        if (wagmiConnected && wagmiAddress && isConnected && wagmiAddress !== walletAddress) {
            console.log("🌈 RainbowKit account switched:", wagmiAddress);
            setSessionAesKey(null);
            clearSnapCache();
            updateAccountState(wagmiAddress, false, false, undefined, wagmiChainId);
        }
    }, [wagmiConnected, wagmiAddress, walletAddress, isConnected, wagmiChainId]);

    // When wagmi chain changes while already connected, refresh balances for the new chain
    const prevWagmiChainIdRef = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (wagmiConnected && wagmiAddress && isConnected && wagmiAddress === walletAddress && wagmiChainId) {
            if (prevWagmiChainIdRef.current !== undefined && prevWagmiChainIdRef.current !== wagmiChainId) {
                // Skip UI update if chain changes are muted (onboarding in progress)
                if (isChainUpdatesMuted()) {
                    console.log("🔇 [ChainMuted] Ignoring chain change during onboarding:", prevWagmiChainIdRef.current, "→", wagmiChainId);
                    prevWagmiChainIdRef.current = wagmiChainId;
                    return;
                }
                console.log("🌈 RainbowKit chain changed:", prevWagmiChainIdRef.current, "→", wagmiChainId);
                updateAccountState(wagmiAddress, false, false, undefined, wagmiChainId);
            }
            prevWagmiChainIdRef.current = wagmiChainId;
        }
    }, [wagmiConnected, wagmiAddress, walletAddress, isConnected, wagmiChainId]);

    // ─────────────────────────────────────────────────────────────────────

    // Reset balances if disconnected from wallet or Snap
    useEffect(() => {
        // Skip token list reset if chain updates are muted (onboarding in progress)
        if (isChainUpdatesMuted()) return;

        if (!isConnected) {
            setPublicTokens(getInitialPublicTokens(currentChainId));
            setPrivateTokens(getInitialPrivateTokens(currentChainId));
            // We intentionally do NOT clear setSessionAesKey(null) here, so the
            // ephemeral AES key cache survives a temporary wallet lock.
        } else if (!hasSnap) {
            // If snap is lost, we might want to keep the session key if it was manually provided?
            // But logic above assumes hasSnap drives private availability.
            // Let's keep it safe: if hasSnap goes false, we assume we lost ability to decrypt nicely.
            // However, usually hasSnap is set true if we have a key.
            setPrivateTokens(getInitialPrivateTokens(currentChainId));
        }
    }, [isConnected, hasSnap, currentChainId]);

    // Trigger update when sessionAesKey is set
    useEffect(() => {
        if (sessionAesKey && walletAddress) {
            console.log("🔄 Session AES Key set, refreshing account state...");
            // We have a key, so we can consider the "snap" (or key provider) active
            if (!hasSnap) setHasSnap(true);
            const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
            // Only refresh public balances here — private balances were already
            // fetched by the unlock flow that set sessionAesKey. Passing
            // fetchPrivate=false with skipPrivateReset=true avoids wiping the
            // just-decrypted private token list.
            updateAccountState(walletAddress, true, false, undefined, chainOverride).then(() => {
                // Ensure private balances are visible after public refresh
                setArePrivateBalancesHidden(false);
            });
        }
    }, [sessionAesKey, walletAddress, updateAccountState, hasSnap]);

    const handleOnboard = async () => {
        const key = await handleManualOnboarding();
        if (key && walletAddress) {
            setSessionAesKey(key, walletAddress);
        }
        return key;
    };

    const saveManualAesKey = async (aesKey: string) => {
        if (!walletAddress) throw new Error("Connect your wallet first.");
        const key = await saveAesKeyLocally(walletAddress, aesKey);
        setSessionAesKey(key, walletAddress);
        setHasSnap(true);
        setSnapError(null);

        const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
        const success = await updateAccountState(walletAddress, true, true, key, chainOverride);
        if (success) setArePrivateBalancesHidden(false);
    };

    const unlockCachedAesKey = async () => {
        if (!walletAddress) throw new Error("Connect your wallet first.");
        const key = await unlockCachedAesKeyFromVault(walletAddress);
        if (!key) throw new Error("No cached AES key found for this wallet.");
        setSessionAesKey(key, walletAddress);
        setHasSnap(true);
        setSnapError(null);

        const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
        const success = await updateAccountState(walletAddress, true, true, key, chainOverride);
        if (success) setArePrivateBalancesHidden(false);
    };

    const refreshPrivateBalances = async () => {
        if (walletAddress) {
            console.log("🔓 Triggering private balance fetch...");
            try {
                // Pass wagmiChainId when connected via RainbowKit so useBalanceUpdater
                // uses the correct RPC instead of window.ethereum (which may be hijacked)
                const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
                const success = await updateAccountState(walletAddress, true, true, undefined, chainOverride);
                console.log(`🔓 Private Balance Fetch Completed. Success: ${success}`);
                if (success) {
                    setArePrivateBalancesHidden(false);
                    setSnapError(null);
                }
                return success;
            } catch (err: any) {
                console.log(`⚠️ Unlock Logic Caught Error: Code=${err.code}, Message="${err.message}"`);

                if (err.message === "SNAP_CONNECT_FAILED" || err.message?.includes("SNAP_CONNECT_FAILED")) {
                    console.log("⚠️ Snap Connection Failed. Requiring Snap Installation.");
                    throw new Error("SNAP_REQUIRED");
                }

                if (err.code === 4001 || err.message?.includes("User rejected") || err.message?.includes("rejected the request")) {
                    console.log("🚫 User rejected unlock. Skipping onboarding.");
                    return false;
                }

                // Handle explicit rejection (Snap returned null / AES key not found)
                if (err.message === 'SNAP_DIALOG_REJECTED') {
                    console.log("🚫 Snap dialog rejected (likely AES key not found). Rethrowing for UI handling.");
                    throw err; // Let Index.tsx handle this and show the AES Key Missing modal
                }

                // Belt-and-suspenders: explicitly handle ACCOUNT_NOT_ONBOARDED (non-onboarded account detected via all-zero ciphertext)
                if (err.message && err.message.includes('ACCOUNT_NOT_ONBOARDED')) {
                    console.log("⚠️ Non-onboarded account detected (all-zero ciphertext). Clearing session key and forcing Snap re-onboarding flow.");
                    setSessionAesKey(null);
                    clearSnapCache();
                    setArePrivateBalancesHidden(true);
                    throw new Error("SNAP_REQUIRED");
                }

                if (err.message && (err.message.includes('AES key') || err.message.includes('onboarding'))) {
                    console.log("⚠️ AES key issue detected during unlock. Clearing session key and forcing Snap re-onboarding flow.");
                    setSessionAesKey(null);
                    clearSnapCache();
                    setArePrivateBalancesHidden(true);
                    const mismatchError = new Error("AES_KEY_MISMATCH");
                    (mismatchError as any).detail = err.message;
                    throw mismatchError;
                }
                return false;
            }
        }
        return false;
    };

    const [podRequests, setPodRequests] = useState<PodPortalRequest[]>(() => loadPodRequests(''));
    const completedPodRefreshesRef = useRef<Set<string>>(new Set());

    const persistPodRequests = useCallback(
        (updater: (prev: PodPortalRequest[]) => PodPortalRequest[]) => {
            setPodRequests(prev => {
                const next = updater(prev);
                savePodRequests(walletAddress, next);
                return next;
            });
        },
        [walletAddress],
    );

    useEffect(() => {
        setPodRequests(loadPodRequests(walletAddress));
    }, [walletAddress]);

    const upsertPodRequest = useCallback(
        (request: PodPortalRequest) => {
            persistPodRequests(prev => {
                const i = prev.findIndex(r => r.id === request.id);
                if (i === -1) return [request, ...prev].slice(0, 20);
                const next = [...prev];
                next[i] = request;
                return next;
            });
        },
        [persistPodRequests],
    );

    const updatePodRequest = useCallback(
        (id: string, patch: Partial<PodPortalRequest>) => {
            persistPodRequests(prev =>
                prev.map(r => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r)),
            );
        },
        [persistPodRequests],
    );

    const refreshBalancesAfterPodCompletion = useCallback(
        async (requestId: string) => {
            if (completedPodRefreshesRef.current.has(requestId)) return;
            completedPodRefreshesRef.current.add(requestId);

            try {
                await refreshPrivateBalances();
            } catch (e) {
                console.warn('refreshBalancesAfterPodCompletion', e);
            } finally {
                updatePodRequest(requestId, { balanceRefreshPending: false });
            }
        },
        [refreshPrivateBalances, updatePodRequest],
    );

    const refreshPodRequest = useCallback(
        async (request: PodPortalRequest) => {
            try {
                const resolved = await resolvePodRequestStatus(request);
                if (!resolved) return;

                const shouldRefreshBalances =
                    resolved.refreshPrivateBalances && !completedPodRefreshesRef.current.has(request.id);

                updatePodRequest(request.id, {
                    status: resolved.status,
                    message: resolved.message,
                    balanceRefreshPending: shouldRefreshBalances
                        ? true
                        : resolved.refreshPrivateBalances
                            ? false
                            : request.balanceRefreshPending,
                });

                if (shouldRefreshBalances) {
                    void refreshBalancesAfterPodCompletion(request.id);
                }
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                if (message.includes('not found')) {
                    updatePodRequest(request.id, {
                        status: 'pod-pending',
                        message: 'PoD request is waiting to be indexed.',
                    });
                    return;
                }
                console.warn('refreshPodRequest', e);
            }
        },
        [updatePodRequest, refreshBalancesAfterPodCompletion],
    );

    useEffect(() => {
        if (!walletAddress) return;
        const active = podRequests.filter(
            r =>
                r.chainId === SEPOLIA_CHAIN_ID &&
                r.wallet.toLowerCase() === walletAddress.toLowerCase() &&
                !['succeeded', 'failed', 'callback-errored', 'burn-debt'].includes(r.status),
        );
        if (active.length === 0) return;
        active.forEach(r => {
            refreshPodRequest(r).catch(console.warn);
        });
        const intervalId = setInterval(() => {
            active.forEach(r => refreshPodRequest(r).catch(console.warn));
        }, 10_000);
        return () => clearInterval(intervalId);
    }, [podRequests, refreshPodRequest, walletAddress]);

    // Main Logic Hook
    const {
        handleSwap,
        isBridgingLoading,
        isApprovalNeeded,
        isApproving,
        handleApprove,
        estimatedGasFee,
        updateGasFee,
        isGasEstimating,
        portalFeeCoti,
        feeDebugInfo
    } = usePrivacyBridge({
        isConnected,
        walletAddress,
        publicTokens,
        setPublicTokens,
        setPrivateTokens,
        setToastState,
        amount,
        setAmount,
        direction,
        setDirection,
        selectedTokenIndex,
        setSelectedTokenIndex,
        error,
        hasSnap,
        setHasSnap,
        getAESKeyFromSnap,
        handleOnboard,
        refreshPrivateBalances,
        upsertPodRequest,
    });



    const handleVerifyKeys = handleKeyVerification;

    const handleDisconnect = async () => {
        // Disconnect wagmi/RainbowKit if connected via that path
        if (wagmiSyncRef.current || wagmiConnected) {
            wagmiDisconnect();
            wagmiSyncRef.current = false;
        }

        // Revoke MetaMask permissions so the wallet doesn't auto-reconnect on reload
        if (window.ethereum && !wagmiConnected) {
            try {
                await (window.ethereum as any).request({
                    method: 'wallet_revokePermissions',
                    params: [{ eth_accounts: {} }]
                });
            } catch (err) {
                console.warn("⚠️ wallet_revokePermissions failed (may not be supported):", err);
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
        console.log("🔌 Disconnected wallet");
    };



    const lockPrivateBalances = () => {
        // Hard lock: Hide balances, clear displayed data, AND clear the session/cache keys
        // so the next unlock MUST re-request permission/signature.
        console.log("🔒 Hard locking private balances and clearing caches");
        setArePrivateBalancesHidden(true);
        setSessionAesKey(null);
        clearSnapCache();
        setPrivateTokens(getInitialPrivateTokens(currentChainId));
    };

    const isPrivateUnlocked = !!sessionAesKey && !arePrivateBalancesHidden;

    return (
        <PrivacyBridgeContext.Provider value={{
            isConnected,
            walletAddress,
            hasSnap,
            snapError,
            connectToSnap,
            publicTokens,
            privateTokens,
            isBridgingLoading,
            handleConnect,
            handleSwap,
            setAmount,
            setDirection,
            setSelectedTokenIndex,
            amount,
            direction,
            selectedTokenIndex,
            // Approval
            isApprovalNeeded,
            isApproving,
            handleApprove,
            handleOnboard,
            saveManualAesKey,
            unlockCachedAesKey,
            handleVerifyKeys, // Exposed verification
            handleDisconnect,
            switchNetwork,
            networkName,
            COTI_MAINNET_ID,
            COTI_TESTNET_ID,
            SEPOLIA_ID,
            refreshPrivateBalances,
            lockPrivateBalances,
            chainId,
            sessionAesKey,
            isPrivateUnlocked,
            estimatedGasFee,
            showInstallModal,
            setShowInstallModal,
            updateGasFee,
            isGasEstimating,
            portalFeeCoti,
            feeDebugInfo,
            showSnapMissingModal,
            setShowSnapMissingModal,
            requestSnapConnection,
            metamaskDetected,
            podRequests,
            refreshPodRequest,
            showCotiWalletAesKeyModal,
            setShowCotiWalletAesKeyModal,
            showMultipleWalletsModal,
            setShowMultipleWalletsModal,
        }}>
            {children}
        </PrivacyBridgeContext.Provider>
    );
};

export const usePrivacyBridgeContext = () => {
    const context = useContext(PrivacyBridgeContext);
    if (context === undefined) {
        throw new Error('usePrivacyBridgeContext must be used within a PrivacyBridgeProvider');
    }
    return context;
};

