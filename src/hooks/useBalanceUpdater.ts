import { useCallback } from 'react';
import { ethers } from 'ethers';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
const { generateRandomAesKeySizeNumber, recoverUserKey } = CotiSDK;
import { CONTRACT_ADDRESSES, ERC20_ABI } from '../contracts/config';
import { getPluginConfig } from '../config/plugin';
import type { Token } from './usePrivacyBridge';
import { formatTokenBalanceDisplay } from '../lib/utils';

interface UseBalanceUpdaterProps {
    setWalletAddress: (address: string) => void;
    setIsConnected: (connected: boolean) => void;
    setHasSnap: (hasSnap: boolean) => void;
    setPublicTokens: React.Dispatch<React.SetStateAction<Token[]>>;
    setPrivateTokens: React.Dispatch<React.SetStateAction<Token[]>>;
    checkNetwork: (provider: ethers.BrowserProvider) => Promise<void>;
    getAESKeyFromSnap: (accountAddress: string) => Promise<string | null>;
    fetchPrivateBalance: (userAddress: string, aesKey: string, contractAddress: string, version: 64 | 256, decimals?: number) => Promise<string>;
    sessionAesKey?: string | null;
    setSessionAesKey: (key: string | null) => void;
}

/**
 * Custom hook to handle account state updates and balance fetching.
 * 
 * @param props - State setters and helper functions required for updating the account.
 * @returns An object containing the `updateAccountState` function.
 */
export const useBalanceUpdater = ({
    setWalletAddress,
    setIsConnected,
    setHasSnap,
    setPublicTokens,
    setPrivateTokens,
    checkNetwork,
    getAESKeyFromSnap,
    fetchPrivateBalance,
    sessionAesKey,
    setSessionAesKey
}: UseBalanceUpdaterProps) => {

    const updateAccountState = useCallback(async (account: string, checkSnap = false, fetchPrivate = false) => {
        try {
            setWalletAddress(account);
            setIsConnected(true);

            if (window.ethereum) {
                const provider = new ethers.BrowserProvider(window.ethereum);

                // Ensure network name is updated immediately
                await checkNetwork(provider);

                const network = await provider.getNetwork();
                const currentChainId = Number(network.chainId);

                // GUARD: Check against Strict Network Enforcement
                // We rely on NetworkGuard for UI blocking and CONTRACT_ADDRESSES for validity
                // If addresses are found for the currentChainId, we fetch.
                /* 
                const envDefaultNetwork = getPluginConfig().defaultNetworkId;
                if (envDefaultNetwork) {
                    const allowedChainId = Number(envDefaultNetwork);
                    if (currentChainId !== allowedChainId) {
                         console.warn(`[BalanceUpdater] Skipping update: Wrong Network ...`);
                         // return false; 
                    }
                }
                */

                const addresses = CONTRACT_ADDRESSES[currentChainId];

                // Fetch public COTI balance
                const balanceWei = await provider.getBalance(account);
                const balanceEth = ethers.formatEther(balanceWei);

                // Fetch all public ERC20 balances in parallel
                const [wethBalance, wbtcBalance, usdtBalance, usdcEBalance, wadaBalance, gCotiBalance] = await Promise.all([
                    // WETH
                    addresses?.WETH
                        ? (async () => {
                            try {
                                const contract = new ethers.Contract(addresses.WETH!, ERC20_ABI, provider);
                                const bal = await contract.balanceOf(account);
                                return ethers.formatUnits(bal, 18);
                            } catch { return '0'; }
                        })()
                        : Promise.resolve('0'),
                    // WBTC
                    addresses?.WBTC
                        ? (async () => {
                            try {
                                const contract = new ethers.Contract(addresses.WBTC!, ERC20_ABI, provider);
                                const bal = await contract.balanceOf(account);
                                return ethers.formatUnits(bal, 8);
                            } catch { return '0'; }
                        })()
                        : Promise.resolve('0'),
                    // USDT
                    addresses?.USDT
                        ? (async () => {
                            try {
                                const contract = new ethers.Contract(addresses.USDT!, ERC20_ABI, provider);
                                const bal = await contract.balanceOf(account);
                                return ethers.formatUnits(bal, 6);
                            } catch { return '0'; }
                        })()
                        : Promise.resolve('0'),
                    // USDC.e
                    addresses?.USDC_E
                        ? (async () => {
                            try {
                                const contract = new ethers.Contract(addresses.USDC_E!, ERC20_ABI, provider);
                                const bal = await contract.balanceOf(account);
                                return ethers.formatUnits(bal, 6);
                            } catch { return '0'; }
                        })()
                        : Promise.resolve('0'),
                    // WADA
                    addresses?.WADA
                        ? (async () => {
                            try {
                                const contract = new ethers.Contract(addresses.WADA!, ERC20_ABI, provider);
                                const bal = await contract.balanceOf(account);
                                return ethers.formatUnits(bal, 6);
                            } catch { return '0'; }
                        })()
                        : Promise.resolve('0'),
                    // gCOTI
                    addresses?.gCOTI
                        ? (async () => {
                            try {
                                const contract = new ethers.Contract(addresses.gCOTI!, ERC20_ABI, provider);
                                const bal = await contract.balanceOf(account);
                                return ethers.formatUnits(bal, 18);
                            } catch { return '0'; }
                        })()
                        : Promise.resolve('0'),
                ]);

                setPublicTokens(prevTokens => {
                    console.log('✅ Updating public tokens list');
                    return prevTokens.map(t => {
                        if (t.symbol === 'COTI') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, balanceEth) };
                        if (t.symbol === 'WETH') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, wethBalance) };
                        if (t.symbol === 'WBTC') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, wbtcBalance) };
                        if (t.symbol === 'USDT') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, usdtBalance) };
                        if (t.symbol === 'USDC.e') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, usdcEBalance) };
                        if (t.symbol === 'WADA') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, wadaBalance) };
                        if (t.symbol === 'gCOTI') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, gCotiBalance) };
                        return t;
                    });
                });

                // Fetch all private balances in parallel
                if (addresses && checkSnap && fetchPrivate) {
                    try {
                        let aesKey = sessionAesKey;
                        // Only fetch from Snap if no session key is provided
                        if (!aesKey) {
                            aesKey = await getAESKeyFromSnap(account);
                            if (aesKey) {
                                // Cache the key for this session
                                setSessionAesKey(aesKey);
                            }
                        } else {
                            // Mark snap as active since we have a key
                            setHasSnap(true);
                        }

                        if (aesKey) {
                            if (!sessionAesKey) setHasSnap(true); // If came from Snap, confirm

                            console.log('🔄 Fetching private balances with Snap/Key...');

                            const fetchPrivateSafely = async (address: string | undefined, version: 64 | 256, decimals: number) => {
                                if (!address) {
                                    return { value: '0', isMismatch: false };
                                }
                                try {
                                    const value = await fetchPrivateBalance(account, aesKey, address, version, decimals);
                                    return { value, isMismatch: false };
                                } catch (e: any) {
                                    const msg = e?.message || '';
                                    const isMismatch = msg.includes('AES key mismatch') || msg.includes('onboarding') || msg.includes('ACCOUNT_NOT_ONBOARDED');
                                    if (isMismatch) {
                                        console.warn(`⚠️ Private token decrypt mismatch for ${address}. Falling back to 0 for this token.`);
                                        return { value: '0', isMismatch: true };
                                    }
                                    throw e;
                                }
                            };

                            const privateFetches = await Promise.all([
                                fetchPrivateSafely(addresses.PrivateCoti, 64, 18),
                                fetchPrivateSafely(addresses["p.WETH"], 256, 18),
                                fetchPrivateSafely(addresses["p.WBTC"], 256, 8),
                                fetchPrivateSafely(addresses["p.USDT"], 256, 6),
                                fetchPrivateSafely(addresses["p.USDC_E"], 256, 6),
                                fetchPrivateSafely(addresses["p.WADA"], 256, 6),
                                fetchPrivateSafely(addresses["p.gCOTI"], 256, 18),
                            ]);

                            const configuredPrivateTokenCount = [
                                addresses.PrivateCoti,
                                addresses["p.WETH"],
                                addresses["p.WBTC"],
                                addresses["p.USDT"],
                                addresses["p.USDC_E"],
                                addresses["p.WADA"],
                                addresses["p.gCOTI"],
                            ].filter(Boolean).length;

                            const mismatchCount = privateFetches.filter(r => r.isMismatch).length;

                            // Any AES key mismatch means the key is wrong for this account.
                            // Even a single garbage decryption proves the key doesn't match —
                            // uninitialized (0,0) tokens return '0.00' without throwing, so
                            // mismatchCount can be 1 even when the key is completely wrong.
                            if (mismatchCount > 0) {
                                throw new Error('AES key mismatch: Error decrypting. Re-onboarding required.');
                            }

                            const [privateBalance, pWethBalance, pWbtcBalance, pUsdtBalance, pUsdcEBalance, pWadaBalance, pGCotiBalance] =
                                privateFetches.map(r => r.value);

                            setPrivateTokens(prevTokens => {
                                console.log('🔐 Updating private tokens list');
                                return prevTokens.map(t => {
                                    if (t.symbol === 'p.COTI') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, privateBalance) };
                                    if (t.symbol === 'p.WETH') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, pWethBalance) };
                                    if (t.symbol === 'p.WBTC') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, pWbtcBalance) };
                                    if (t.symbol === 'p.USDT') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, pUsdtBalance) };
                                    if (t.symbol === 'p.USDC.e') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, pUsdcEBalance) };
                                    if (t.symbol === 'p.WADA') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, pWadaBalance) };
                                    if (t.symbol === 'p.gCOTI') return { ...t, balance: formatTokenBalanceDisplay(t.symbol, pGCotiBalance) };
                                    return t;
                                });
                            });
                            return true; // Snap connected and balances fetched
                        } else {
                            console.log('ℹ️ Snap available but keys missing/rejected.');
                            return false; // AES key missing (cancelled/rejected)
                        }
                    } catch (privateError: any) {
                        console.warn('⚠️ Could not fetch/decrypt private balance on load:', privateError);
                        // Rethrow so context can handle onboarding if needed
                        if (privateError.message && (privateError.message.includes('AES key') || privateError.message.includes('onboarding') || privateError.message.includes('SNAP_DIALOG_REJECTED') || privateError.message.includes('SNAP_CONNECT_FAILED'))) {
                            throw privateError;
                        }
                        return false;
                    }
                }
            }
            return true; // Success (default fall-through)
        } catch (error: any) {
            console.error('Error updating account state:', error);
            // Rethrow so upstream works (e.g. RefreshPrivateBalances) can catch it
            if (error.message && (error.message.includes('AES key') || error.message.includes('onboarding') || error.message.includes('SNAP_DIALOG_REJECTED') || error.message.includes('SNAP_CONNECT_FAILED'))) {
                throw error;
            }
            return false;
        }
    }, [setWalletAddress, setHasSnap, setIsConnected, setPublicTokens, checkNetwork, getAESKeyFromSnap, fetchPrivateBalance, setPrivateTokens, sessionAesKey, setSessionAesKey]);

    return { updateAccountState };
};
