import { useState, useCallback, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { getPluginConfig } from '../config/plugin';
import { getEthereumProvider } from '../lib/ethereum';
import { CotiPluginError, CotiErrorCode } from '../errors';

// Constants for COTI Networks
const COTI_MAINNET_ID = '0x282b34'; // 2632500
const COTI_TESTNET_ID = '0x6c11a0'; // 7082400
const SEPOLIA_ID = '0xaa36a7'; // 11155111

// Network Configurations
const networks = {
    [COTI_MAINNET_ID]: {
        chainId: COTI_MAINNET_ID,
        chainName: 'COTI Mainnet',
        rpcUrls: ['https://mainnet.coti.io/rpc'],
        nativeCurrency: { name: 'COTI', symbol: 'COTI', decimals: 18 },
        blockExplorerUrls: ['https://mainnet.cotiscan.io'],
    },
    [COTI_TESTNET_ID]: {
        chainId: COTI_TESTNET_ID,
        chainName: 'COTI Testnet',
        rpcUrls: ['https://testnet.coti.io/rpc'],
        nativeCurrency: { name: 'COTI', symbol: 'COTI', decimals: 18 },
        blockExplorerUrls: ['https://testnet.cotiscan.io'],
    },
    [SEPOLIA_ID]: {
        chainId: SEPOLIA_ID,
        chainName: 'Sepolia',
        rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
        nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
        blockExplorerUrls: ['https://sepolia.etherscan.io'],
    }
};

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

        if (id === 2632500) {
            setNetworkName('COTI Mainnet');
        } else if (id === 7082400) {
            setNetworkName('COTI Testnet');
        } else if (id === 11155111) {
            setNetworkName('Sepolia');
        } else {
            setNetworkName('Wrong Network');
        }
    }, []);


    /**
     * Requests a network switch to the target chain ID. 
     * Attempts to add the network if it doesn't exist in the wallet.
     * 
     * @param targetChainId - The Hex chain ID to switch to.
     * @returns True if successful, false otherwise.
     */
    const switchNetwork = async (targetChainId: string): Promise<boolean> => {
        if (typeof window.ethereum === 'undefined') return false;
        const eth = getEthereumProvider()!;

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
                const networkConfig = (networks as any)[targetChainId];
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
                        console.log('Network added successfully, proceeding.');
                    }

                    // Trigger callback
                    if (onNetworkChanged) {
                        await onNetworkChanged();
                    }
                    return true;
                } catch (addError) {
                    console.error(`Failed to add ${networkConfig.chainName}:`, addError);
                    return false;
                }
            } else {
                console.error('Failed to switch network:', switchError);
                return false;
            }
        }
    };

    /**
     * Connects to the user's Metamask wallet.
     * Requests permissions, gets accounts, ensures the correct network, and triggers state updates.
     * 
     * @param onConnect - Callback to execute with the connected account address.
     * @returns Void. Handles errors internally.
     */
    const connectWallet = async (onConnect: (account: string) => Promise<void>) => {
        if (!window.ethereum) {
            throw new CotiPluginError(CotiErrorCode.METAMASK_NOT_INSTALLED, 'MetaMask or compatible wallet not found');
        }

        const eth = getEthereumProvider()!;

        try {
            // 1. Request Account Access
            await eth.request({
                method: 'wallet_requestPermissions',
                params: [{ eth_accounts: {} }]
            });

            // 2. Get Selected Accounts
            const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[];

            if (!accounts || accounts.length === 0) return;

            // Check network, default to Mainnet if on wrong network
            const provider = new ethers.BrowserProvider(window.ethereum);
            const network = await provider.getNetwork();

            const envDefaultNetwork = getPluginConfig().defaultNetworkId;

            /*
                        if (envDefaultNetwork) {
                            // STRICT MODE: If env var is set (CI/CD deployments), enforce that specific network
                            if (network.chainId !== BigInt(envDefaultNetwork)) {
                                console.log(`Enforcing strict network switch to ${envDefaultNetwork}`);
                                const success = await switchNetwork(envDefaultNetwork);
                                if (!success) {
                                    console.error(`Failed to switch to required network (${envDefaultNetwork})`);
                                }
                            }
                        } else { */
            /*
                            // PERMISSIVE MODE (Local Dev): Allow either, default to Mainnet if neither
                            if (network.chainId !== BigInt(COTI_MAINNET_ID) && network.chainId !== BigInt(COTI_TESTNET_ID) && network.chainId !== BigInt(SEPOLIA_ID)) {
                                const success = await switchNetwork(COTI_MAINNET_ID);
                                if (!success) {
                                    console.error("Failed to switch to mainnet default");
                                }
                            }
                        } */

            // 4. Update State via callback
            if (accounts.length > 0) {
                await onConnect(accounts[0]);
            }
        } catch (error) {
            console.error('Error connecting to MetaMask:', error);
        }
    };

    /**
     * Refreshes the network state and triggers the change callback.
     * Useful for manual refreshes or periodic checks.
     */
    const refreshNetworkState = useCallback(async () => {
        if (!window.ethereum) return;
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            await checkNetwork(provider);

            if (onNetworkChanged) {
                await onNetworkChanged();
            }
        } catch (error) {
            console.error('Error refreshing network state:', error);
        }
    }, [checkNetwork, onNetworkChanged]);

    // Handle initial check and event listeners
    useEffect(() => {
        const setup = () => {
            if (typeof window.ethereum === 'undefined') return;
            const eth = getEthereumProvider()!;

            const handleAccountsChanged = (accounts: string[]) => {
                if (accounts.length > 0) {
                    if (onAccountChanged) onAccountChanged(accounts[0]);
                } else {
                    if (onDisconnect) onDisconnect();
                }
            };

            const handleChainChanged = () => {
                window.location.reload();
            };

            eth.on?.('accountsChanged', handleAccountsChanged);
            eth.on?.('chainChanged', handleChainChanged);

            // Check if already connected - ONLY ONCE
            if (!isInitialCheckDone.current) {
                console.log('🔄 useMetamask: Performing initial eth_accounts check');
                (eth.request({ method: 'eth_accounts' }) as Promise<string[]>).then((accounts) => {
                    console.log('🔄 useMetamask: eth_accounts result:', accounts);
                    if (accounts.length > 0) {
                        if (onAccountChanged) onAccountChanged(accounts[0]);
                        console.log('🔄 useMetamask: triggering checkSnapConnection');
                        if (onSnapCheck) onSnapCheck(accounts[0]);
                    } else {
                        console.log('ℹ️ useMetamask: No accounts returned by eth_accounts');
                    }
                }).catch((err: any) => console.error('❌ useMetamask: eth_accounts failed', err));
                isInitialCheckDone.current = true;
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
            console.log('🔄 useMetamask: ethereum#initialized fired, re-running setup');
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
