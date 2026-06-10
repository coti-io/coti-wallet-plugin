import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useMetamask } from '../hooks/useMetamask';
import { useSnap } from '../hooks/useSnap';
import { useBalanceUpdater } from '../hooks/useBalanceUpdater';
import { usePrivacyBridge, Token, getInitialPublicTokens, getInitialPrivateTokens, type SwapProgressStage } from '../hooks/usePrivacyBridge';
import { usePrivateTokenBalance } from '../hooks/usePrivateTokenBalance';
import { CONTRACT_ADDRESSES } from '../contracts/config';
import { useNetworkEnforcer } from '../hooks/useNetworkEnforcer';
import { isMultipleWalletsError } from '../utils/walletErrors';
import { useWalletType } from '../hooks/useWalletType';
import { useAesKeyProvider } from '../hooks/useAesKeyProvider';
import { getEthereumProvider } from '../lib/ethereum';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';

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
    handleVerifyKeys: () => Promise<void>;
    handleDisconnect: () => Promise<void>;
    // Network Switch
    switchNetwork: (chainId: string) => Promise<boolean>;
    networkName: string;
    COTI_MAINNET_ID: string;
    COTI_TESTNET_ID: string;
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
    const [showMultipleWalletsModal, setShowMultipleWalletsModal] = useState<boolean>(false);
    const [metamaskDetected, setMetamaskDetected] = useState(false);
    const ethereumListenerRegistered = useRef(false);

    // --- Wagmi / RainbowKit integration ---
    // Derive connection state from wagmi useAccount when connected via RainbowKit
    const { address: wagmiAddress, isConnected: wagmiIsConnected } = useAccount();
    const walletTypeInfo = useWalletType();
    const { getAesKey: getAesKeyFromProvider, isOnboarding, onboardingError } = useAesKeyProvider(walletTypeInfo);

    // Auto-open Snap Required modal the first time a snap error appears
    useEffect(() => {
        if (snapError) {
            setShowSnapMissingModal(true);
        }
    }, [snapError]);

    // --- RainbowKit path: Sync wagmi connection state to context ---
    // When a wallet connects via RainbowKit, update isConnected and walletAddress
    useEffect(() => {
        if (wagmiIsConnected && wagmiAddress) {
            setIsConnected(true);
            setWalletAddress(wagmiAddress);
        } else if (!wagmiIsConnected && walletTypeInfo.connectorId !== undefined) {
            // Wallet disconnected via RainbowKit — only clear if we were using RainbowKit path
            // (connectorId being defined means wagmi was tracking a connector)
        }
    }, [wagmiIsConnected, wagmiAddress]);

    // --- Clear sessionAesKey on wagmi address changes ---
    // Requirement 4.3: When the connected account changes, clear sessionAesKey and hide private balances
    const prevWagmiAddressRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        // Skip the initial mount (when prevWagmiAddressRef is undefined and wagmiAddress is first set)
        if (prevWagmiAddressRef.current !== undefined && wagmiAddress !== prevWagmiAddressRef.current) {
            logger.log("👤 Wagmi address changed, clearing sessionAesKey and locking");
            setSessionAesKey(null);
            setArePrivateBalancesHidden(true);
        }
        prevWagmiAddressRef.current = wagmiAddress;
    }, [wagmiAddress]);

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
    const [sessionAesKey, setSessionAesKey] = useState<string | null>(null);
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

    // Helper to fetch private balance (needed by useBalanceUpdater)
    // We can implement a simplified version or import from a utility if available. 
    // For now, defining a placeholder or referencing logic from usePrivacyBridge/utils if they existed.
    // Checking useBalanceUpdater signature: fetchPrivateBalance is passed as a prop!
    // We need to implement fetchPrivateBalance here to pass it down.

    const { fetchPrivateBalance } = usePrivateTokenBalance();

    const { connectWallet, checkNetwork, switchNetwork, networkName, COTI_MAINNET_ID, COTI_TESTNET_ID, chainId, registerEthereumInitializedListener } = useMetamask({
        onAccountChanged: async (account) => {
            // Prevent spurious updates if account is same (ignoring case)
            if (walletAddress && account.toLowerCase() === walletAddress.toLowerCase()) {
                logger.log("ℹ️ Account unchanged, skipping session reset");
                return;
            }

            // Do not fetch private balances automatically on account change
            // Clear session key on account change
            logger.log("👤 Account changed, clearing sessionAesKey and locking");
            setSessionAesKey(null);
            setArePrivateBalancesHidden(true);
            await updateAccountState(account, hasSnap, false);
        },
        onSnapCheck: async (account) => {
            await executeSnapCheck(async () => {
                // Snap found, but do not fetch private balances until requested
                await updateAccountState(account, true, false);
                return true;
            });
        }
    });

    // Enforce Network Policy
    useNetworkEnforcer(chainId, switchNetwork);

    const { updateAccountState } = useBalanceUpdater({
        setWalletAddress,
        setIsConnected,
        setHasSnap,
        setPublicTokens,
        setPrivateTokens,
        checkNetwork,
        getAESKeyFromSnap: getAesKeyFromProvider,
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
        try {
            await connectWallet(async (account) => {
                // Initial update on connect (public only)
                await updateAccountState(account, false, false);
            });
        } catch (error: any) {
            logger.error("Connection failed:", error);

            // Check for multiple wallets conflict FIRST
            if (isMultipleWalletsError(error?.message)) {
                setShowMultipleWalletsModal(true);
                return;
            }

            if (error instanceof CotiPluginError && error.code === CotiErrorCode.METAMASK_NOT_INSTALLED) {
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

    // Reset balances if disconnected from wallet or Snap
    useEffect(() => {
        if (!isConnected) {
            setPublicTokens(getInitialPublicTokens());
            setPrivateTokens(getInitialPrivateTokens());
            setSessionAesKey(null);
        } else if (!hasSnap) {
            // If snap is lost, we might want to keep the session key if it was manually provided?
            // But logic above assumes hasSnap drives private availability.
            // Let's keep it safe: if hasSnap goes false, we assume we lost ability to decrypt nicely.
            // However, usually hasSnap is set true if we have a key.
            setPrivateTokens(getInitialPrivateTokens());
        }
    }, [isConnected, hasSnap]);

    // Trigger update when sessionAesKey is set
    useEffect(() => {
        if (sessionAesKey && walletAddress) {
            logger.log("🔄 Session AES Key set, refreshing account state...");
            // We have a key, so we can consider the "snap" (or key provider) active
            if (!hasSnap) setHasSnap(true);
            updateAccountState(walletAddress, true, false);
        }
    }, [sessionAesKey, walletAddress, updateAccountState, hasSnap]);

    const handleOnboard = async () => {
        const key = await handleManualOnboarding();
        if (key) {
            setSessionAesKey(key);
        }
        return key;
    };

    const refreshPrivateBalances = async () => {
        if (walletAddress) {
            logger.log("🔓 Triggering private balance fetch...");
            try {
                const success = await updateAccountState(walletAddress, true, true);
                logger.log(`🔓 Private Balance Fetch Completed. Success: ${success}`);
                if (success) setArePrivateBalancesHidden(false);
                return success;
            } catch (err: any) {
                logger.log(`⚠️ Unlock Logic Caught Error: Code=${err.code}, Message="${err.message}"`);

                if ((err instanceof CotiPluginError && err.code === CotiErrorCode.SNAP_CONNECT_FAILED) || err.message === "SNAP_CONNECT_FAILED") {
                    logger.log("⚠️ Snap Connection Failed. Requiring Snap Installation.");
                    throw new CotiPluginError(CotiErrorCode.SNAP_REQUIRED, 'COTI Snap is required but not available');
                }

                if (err.code === 4001 || err.message?.includes("User rejected") || err.message?.includes("rejected the request")) {
                    logger.log("🚫 User rejected unlock. Skipping onboarding.");
                    return false;
                }

                // Handle explicit rejection (Snap returned null / AES key not found)
                if ((err instanceof CotiPluginError && err.code === CotiErrorCode.SNAP_DIALOG_REJECTED) || err.message === 'SNAP_DIALOG_REJECTED') {
                    logger.log("🚫 Snap dialog rejected (likely AES key not found). Rethrowing for UI handling.");
                    throw err; // Let Index.tsx handle this and show the AES Key Missing modal
                }

                // Belt-and-suspenders: explicitly handle ACCOUNT_NOT_ONBOARDED (non-onboarded account detected via all-zero ciphertext)
                if ((err instanceof CotiPluginError && err.code === CotiErrorCode.ACCOUNT_NOT_ONBOARDED) || (err.message && err.message === 'ACCOUNT_NOT_ONBOARDED')) {
                    logger.log("⚠️ Non-onboarded account detected (all-zero ciphertext). Clearing session key and forcing Snap re-onboarding flow.");
                    setSessionAesKey(null);
                    clearSnapCache();
                    setArePrivateBalancesHidden(true);
                    throw new CotiPluginError(CotiErrorCode.SNAP_REQUIRED, 'Account not onboarded, Snap re-onboarding required');
                }

                if ((err instanceof CotiPluginError && err.code === CotiErrorCode.AES_KEY_MISMATCH) || (err.message && err.message === 'AES_KEY_MISMATCH')) {
                    logger.log("⚠️ AES key issue detected during unlock. Clearing session key and forcing Snap re-onboarding flow.");
                    setSessionAesKey(null);
                    clearSnapCache();
                    setArePrivateBalancesHidden(true);
                    throw new CotiPluginError(CotiErrorCode.AES_KEY_MISMATCH, 'AES key mismatch detected', err.message);
                }
                return false;
            }
        }
        return false;
    };

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
        getAESKeyFromSnap: getAesKeyFromProvider,
        handleOnboard,
        refreshPrivateBalances
    });



    const handleVerifyKeys = handleKeyVerification;

    const handleDisconnect = async () => {
        // Revoke MetaMask permissions so the wallet doesn't auto-reconnect on reload
        if (window.ethereum) {
            try {
                await getEthereumProvider()!.request({
                    method: 'wallet_revokePermissions',
                    params: [{ eth_accounts: {} }]
                });
            } catch (err) {
                logger.warn("⚠️ wallet_revokePermissions failed (may not be supported):", err);
            }
        }

        setIsConnected(false);
        setWalletAddress('');
        setHasSnap(false);
        setPublicTokens(getInitialPublicTokens());
        setPrivateTokens(getInitialPrivateTokens());
        setSessionAesKey(null);
        setArePrivateBalancesHidden(true);
        setShowMultipleWalletsModal(false);
        clearSnapCache();
        logger.log("🔌 Disconnected wallet");
    };



    const lockPrivateBalances = () => {
        // Hard lock: Hide balances, clear displayed data, AND clear the session/cache keys
        // so the next unlock MUST re-request permission/signature.
        logger.log("🔒 Hard locking private balances and clearing caches");
        setArePrivateBalancesHidden(true);
        setSessionAesKey(null);
        clearSnapCache();
        setPrivateTokens(getInitialPrivateTokens());
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
            handleVerifyKeys, // Exposed verification
            handleDisconnect,
            switchNetwork,
            networkName,
            COTI_MAINNET_ID,
            COTI_TESTNET_ID,
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
            showMultipleWalletsModal,
            setShowMultipleWalletsModal
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

