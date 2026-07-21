import { useState, useCallback, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { getPluginConfig } from '../config/plugin';
import { getMetaMaskProvider } from '../lib/ethereum';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';
import { truncateAddress } from '../lib/format';
import { isChainUpdatesMuted } from '../lib/chainMute';
import { getMetaMaskMobileEthAccountsDelayMs } from '../lib/metaMaskMobile';
import {
    getChainIdConstants,
    getNetworkNameForChain,
    getWalletNetworkConfigs,
} from '../chains';

const { COTI_MAINNET_ID, COTI_TESTNET_ID, SEPOLIA_ID } = getChainIdConstants();

interface UseMetamaskCallbacks {
    onNetworkChanged?: () => Promise<void>;
    onAccountChanged?: (account: string) => Promise<void>;
    onDisconnect?: () => void;
    onSnapCheck?: (account: string) => void;
}

/**
 * Custom hook to manage Metamask wallet interactions, including network management and connection.
 * 
 * This hook provides a unified interface for:
 * 1. **Network Identification**: Detecting the current network and mapping it to a human-readable name.
 * 2. **Network Switching**: Requesting the wallet to switch chains (and adding the chain if missing).
 * 3. **Wallet Connection**: Handling the permissions request and account retrieval flow.
 * 4. **State Refresh**: Triggering manual updates of the network and account state.
 * 5. **Event Listeners**: Handling accountsChanged and chainChanged events automatically.
 * 
 * @param callbacks - Object containing optional callbacks for various events.
 * @returns {Object} An object containing helper functions and constants.
 */
export const useMetamask = ({
    onNetworkChanged,
    onAccountChanged,
    onDisconnect,
    onSnapCheck
}: UseMetamaskCallbacks = {}) => {
    const [networkName, setNetworkName] = useState('Unknown Network');
    const [chainId, setChainId] = useState<string | null>(null);
    const isInitialCheckDone = useRef(false);

    /**
     * Checks the provided provider's network and updates the local network name state.
     * 
     * @param provider - The Ethers.js provider to check.
     */
    const checkNetwork = useCallback(async (provider: ethers.BrowserProvider) => {
        const network = await provider.getNetwork();
        const id = Number(network.chainId);
        setChainId(id.toString());

        setNetworkName(getNetworkNameForChain(id));
    }, []);


    /**
     * Requests a network switch to the target chain ID. 
     * Attempts to add the network if it doesn't exist in the wallet.
     * 
     * @param targetChainId - The Hex chain ID to switch to.
     * @returns True if successful, false otherwise.
     */
    const switchNetwork = async (targetChainId: string): Promise<boolean> => {
        const eth = getMetaMaskProvider();
        if (!eth) return false;

        try {
            // Try to switch to the network
            await eth.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: targetChainId }],
            });

            // Trigger callback if provided (e.g., to refresh balances)
            if (onNetworkChanged) {
                await onNetworkChanged();
            }
            return true;
        } catch (switchError: any) {
            // This error code indicates that the chain has not been added to MetaMask.
            if (switchError.code === 4902) {
                const networkConfig = getWalletNetworkConfigs()[targetChainId];
                if (!networkConfig) {
                    logger.error(`Unsupported chain for wallet_addEthereumChain: ${targetChainId}`);
                    return false;
                }
                try {
                    // Add the network
                    await eth.request({
                        method: 'wallet_addEthereumChain',
                        params: [networkConfig],
                    });

                    // After adding, MetaMask should auto-switch, but we can try again to be safe
                    try {
                        await eth.request({
                            method: 'wallet_switchEthereumChain',
                            params: [{ chainId: targetChainId }],
                        });
                    } catch (retrySwitchError) {
                        // If this fails, MetaMask likely already switched during the add
                        logger.log('Network added successfully, proceeding.');
                    }

                    // Trigger callback
                    if (onNetworkChanged) {
                        await onNetworkChanged();
                    }
                    return true;
                } catch (addError) {
                    logger.error(`Failed to add ${networkConfig.chainName}:`, addError);
                    return false;
                }
            } else {
                logger.error('Failed to switch network:', switchError);
                return false;
            }
        }
    };

    /**
     * Connects to the user's Metamask wallet.
     * Requests permissions, gets accounts, ensures the correct network, and triggers state updates.
     *
     * @param onConnect - Callback to execute with the connected account address.
     * @returns `true` when an account was connected and `onConnect` completed; `false` on rejection, empty accounts, or provider errors.
     */
    const connectWallet = async (onConnect: (account: string) => Promise<void>): Promise<boolean> => {
        const eth = getMetaMaskProvider();
        if (!eth) {
            throw new CotiPluginError(CotiErrorCode.METAMASK_NOT_INSTALLED, 'MetaMask or compatible wallet not found');
        }

        try {
            // 1. Request Account Access
            await eth.request({
                method: 'wallet_requestPermissions',
                params: [{ eth_accounts: {} }]
            });

            // 2. Get Selected Accounts
            const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[];

            if (!accounts || accounts.length === 0) return false;

            // Check network, default to Mainnet if on wrong network
            const provider = new ethers.BrowserProvider(eth);
            const network = await provider.getNetwork();

            const envDefaultNetwork = getPluginConfig().defaultNetworkId;

            /*
                        if (envDefaultNetwork) {
                            // STRICT MODE: If env var is set (CI/CD deployments), enforce that specific network
                            if (network.chainId !== BigInt(envDefaultNetwork)) {
                                logger.log(`Enforcing strict network switch to ${envDefaultNetwork}`);
                                const success = await switchNetwork(envDefaultNetwork);
                                if (!success) {
                                    logger.error(`Failed to switch to required network (${envDefaultNetwork})`);
                                }
                            }
                        } else { */
            /*
                            // PERMISSIVE MODE (Local Dev): Allow either, default to Mainnet if neither
                            if (network.chainId !== BigInt(COTI_MAINNET_ID) && network.chainId !== BigInt(COTI_TESTNET_ID) && network.chainId !== BigInt(SEPOLIA_ID)) {
                                const success = await switchNetwork(COTI_MAINNET_ID);
                                if (!success) {
                                    logger.error("Failed to switch to mainnet default");
                                }
                            }
                        } */

            // 4. Update State via callback
            /* v8 ignore next 2 -- unreachable: empty accounts return above at line 176 */
            if (accounts.length > 0) {
                await onConnect(accounts[0]);
                return true;
            }
            return false;
        } catch (error) {
            logger.error('Error connecting to MetaMask:', error);
            return false;
        }
    };

    /**
     * Refreshes the network state and triggers the change callback.
     * Useful for manual refreshes or periodic checks.
     */
    const refreshNetworkState = useCallback(async () => {
        const eth = getMetaMaskProvider();
        if (!eth) return;
        try {
            const provider = new ethers.BrowserProvider(eth);
            await checkNetwork(provider);

            if (onNetworkChanged) {
                await onNetworkChanged();
            }
        } catch (error) {
            logger.error('Error refreshing network state:', error);
        }
    }, [checkNetwork, onNetworkChanged]);

    // Handle initial check and event listeners
    useEffect(() => {
        const setup = () => {
            const eth = getMetaMaskProvider();
            if (!eth) return;

            const handleAccountsChanged = (accounts: string[]) => {
                if (accounts.length > 0) {
                    if (onAccountChanged) onAccountChanged(accounts[0]);
                } else {
                    if (onDisconnect) onDisconnect();
                }
            };

            const handleChainChanged = () => {
                // Skip reload if chain updates are muted (cross-chain onboarding in progress).
                // The onboarding flow temporarily switches to COTI and back; reloading would
                // disrupt the UI and lose the onboarding state.
                if (isChainUpdatesMuted()) {
                    logger.log('🔇 [useMetamask] chainChanged ignored (muted for onboarding)');
                    return;
                }
                // Prefer a soft resync via the callback instead of a full page reload.
                // A hard reload is disruptive even with reconnectOnMount; only fall back
                // to a reload when no handler is wired (legacy injected-only integrations).
                if (onNetworkChanged) {
                    void onNetworkChanged();
                    return;
                }
                window.location.reload();
            };

            eth.on?.('accountsChanged', handleAccountsChanged);
            eth.on?.('chainChanged', handleChainChanged);

            // Deferred via setTimeout so MetaMask Mobile's JSON-RPC relay
            // is fully ready before we send eth_accounts. Without the defer, this
            // request races with any eth_accounts call triggered by user interaction
            // (e.g. tapping Unlock) on the very first page load, overflowing
            // MetaMask Mobile's request coalescer. The flag is set synchronously
            // so that re-renders during the same tick do not schedule duplicates.
            if (!isInitialCheckDone.current) {
                isInitialCheckDone.current = true;
                const deferMs = getMetaMaskMobileEthAccountsDelayMs();
                setTimeout(() => {
                    logger.log(`🔄 useMetamask: Performing initial eth_accounts check (defer=${deferMs}ms)`);
                    (eth.request({ method: 'eth_accounts' }) as Promise<string[]>).then((accounts) => {
                        logger.log(
                            '🔄 useMetamask: eth_accounts result:',
                            accounts.length === 0
                                ? 'no accounts'
                                : `${accounts.length} account(s), primary: ${truncateAddress(accounts[0])}`,
                        );
                        if (accounts.length > 0) {
                            if (onAccountChanged) onAccountChanged(accounts[0]);
                            logger.log('🔄 useMetamask: triggering checkSnapConnection');
                            if (onSnapCheck) onSnapCheck(accounts[0]);
                        } else {
                            logger.log('ℹ️ useMetamask: No accounts returned by eth_accounts');
                        }
                    }).catch((err: any) => logger.error('❌ useMetamask: eth_accounts failed', err));
                }, deferMs);
            }

            return () => {
                eth.removeListener?.('accountsChanged', handleAccountsChanged);
                eth.removeListener?.('chainChanged', handleChainChanged);
            };
        };

        // Run setup immediately if provider is already available
        const cleanup = setup();

        // Also listen for late injection (MetaMask not yet loaded when page mounted)
        const handleEthereumInitialized = () => {
            logger.log('🔄 useMetamask: ethereum#initialized fired, re-running setup');
            setup();
        };
        window.addEventListener('ethereum#initialized', handleEthereumInitialized, { once: true });

        return () => {
            window.removeEventListener('ethereum#initialized', handleEthereumInitialized);
            cleanup?.();
        };
    }, [onAccountChanged, onDisconnect, onSnapCheck]);

    /**
     * Registers a one-time listener for the `ethereum#initialized` event.
     * This event is fired by MetaMask after it injects `window.ethereum` into the page.
     *
     * @param callback - Function to invoke when the event fires.
     */
    const registerEthereumInitializedListener = (callback: () => void) => {
        window.addEventListener('ethereum#initialized', callback, { once: true });
    };

    return {
        networkName,
        chainId,
        checkNetwork,
        switchNetwork,
        connectWallet,
        refreshNetworkState,
        registerEthereumInitializedListener,
        COTI_MAINNET_ID,
        COTI_TESTNET_ID,
        SEPOLIA_ID
    };
};
