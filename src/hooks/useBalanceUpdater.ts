import { useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, ERC20_ABI, getPublicTokensForChain, getPrivateTokensForChain } from '../contracts/config';
import { getRpcUrlForChainId } from '../config/chains';
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
    fetchPrivateBalance: (userAddress: string, aesKey: string, contractAddress: string, version: 64 | 256, decimals?: number, readChainId?: number) => Promise<string>;
    sessionAesKey?: string | null;
    setSessionAesKey: (key: string | null, keyWallet?: string) => void;
}

/**
 * Custom hook to handle account state updates and balance fetching.
 * Dynamically iterates over SUPPORTED_TOKENS filtered by chain — no hardcoded token lists.
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

    const updateAccountState = useCallback(async (
        account: string,
        checkSnap = false,
        fetchPrivate = false,
        aesKeyOverride?: string | null,
        chainOverride?: number
    ) => {
        try {
            setWalletAddress(account);
            setIsConnected(true);

            const hasChainOverride = typeof chainOverride === 'number';
            if (window.ethereum || hasChainOverride) {
                const browserProvider = window.ethereum ? new ethers.BrowserProvider(window.ethereum) : null;

                // Ensure network name is updated immediately when MetaMask is available.
                if (browserProvider) {
                    await checkNetwork(browserProvider);
                }

                const currentChainId = hasChainOverride
                    ? chainOverride
                    : Number((await browserProvider!.getNetwork()).chainId);
                const readProvider = hasChainOverride
                    ? new ethers.JsonRpcProvider(getRpcUrlForChainId(currentChainId), currentChainId)
                    : browserProvider!;

                const addresses = CONTRACT_ADDRESSES[currentChainId];

                // ─── Public Balances (dynamic) ──────────────────────────────────
                const publicTokenConfigs = getPublicTokensForChain(currentChainId);

                // Fetch native balance (used for tokens without addressKey, e.g. COTI)
                const nativeBalanceWei = await readProvider.getBalance(account);
                const nativeBalance = ethers.formatEther(nativeBalanceWei);

                // Fetch all ERC20 public balances in parallel
                const publicBalances = await Promise.all(publicTokenConfigs.map(async token => {
                    // Native token (no addressKey) — use native balance
                    if (!token.addressKey) {
                        return nativeBalance;
                    }
                    const tokenAddress = addresses?.[token.addressKey];
                    if (!tokenAddress) return '0';
                    try {
                        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, readProvider);
                        const bal = await contract.balanceOf(account);
                        return ethers.formatUnits(bal, token.decimals);
                    } catch {
                        return '0';
                    }
                }));

                console.log('✅ Updating public tokens list');
                setPublicTokens(publicTokenConfigs.map((token, index) => ({
                    symbol: token.symbol,
                    name: token.name,
                    balance: formatTokenBalanceDisplay(token.symbol, publicBalances[index]),
                    isPrivate: false,
                    icon: token.icon,
                    addressKey: token.addressKey,
                    bridgeAddressKey: token.bridgeAddressKey,
                })));

                // ─── Private Balances (dynamic) ─────────────────────────────────
                if (addresses && checkSnap && fetchPrivate) {
                    try {
                        let aesKey = aesKeyOverride ?? sessionAesKey;
                        // Only fetch from Snap if no session key is provided
                        if (!aesKey) {
                            aesKey = await getAESKeyFromSnap(account);
                            if (aesKey) {
                                setSessionAesKey(aesKey, account);
                            }
                        } else {
                            setHasSnap(true);
                        }

                        if (aesKey) {
                            if (!sessionAesKey) setHasSnap(true);

                            console.log('🔄 Fetching private balances...');

                            const privateTokenConfigs = getPrivateTokensForChain(currentChainId);

                            const privateFetches = await Promise.all(privateTokenConfigs.map(async token => {
                                const tokenAddress = token.addressKey ? addresses[token.addressKey] : undefined;
                                if (!tokenAddress) {
                                    return { symbol: token.symbol, value: '0', isMismatch: false };
                                }
                                try {
                                    const value = await fetchPrivateBalance(account, aesKey, tokenAddress, 256, token.decimals, currentChainId);
                                    return { symbol: token.symbol, value, isMismatch: false };
                                } catch (e: any) {
                                    const msg = e?.message || '';
                                    const isMismatch =
                                        msg.includes('AES key mismatch') ||
                                        msg.includes('onboarding') ||
                                        msg.includes('ACCOUNT_NOT_ONBOARDED') ||
                                        msg.includes('implausible decrypted balance');
                                    if (isMismatch) {
                                        console.warn(`⚠️ Private token decrypt mismatch for ${tokenAddress}. Falling back to 0.`);
                                        return { symbol: token.symbol, value: '0', isMismatch: true };
                                    }
                                    throw e;
                                }
                            }));

                            const mismatchCount = privateFetches.filter(r => r.isMismatch).length;

                            // Any AES key mismatch means the key is wrong for this account.
                            if (mismatchCount > 0) {
                                throw new Error('AES key mismatch: Error decrypting. Re-onboarding required.');
                            }

                            console.log('🔐 Updating private tokens list');
                            setPrivateTokens(privateTokenConfigs.map(token => {
                                const result = privateFetches.find(r => r.symbol === token.symbol);
                                return {
                                    symbol: token.symbol,
                                    name: token.name,
                                    balance: formatTokenBalanceDisplay(token.symbol, result?.value ?? '0'),
                                    isPrivate: true,
                                    icon: token.icon,
                                    addressKey: token.addressKey,
                                    bridgeAddressKey: token.bridgeAddressKey,
                                };
                            }));
                            return true;
                        } else {
                            console.log('ℹ️ Snap available but keys missing/rejected.');
                            return false;
                        }
                    } catch (privateError: any) {
                        console.warn('⚠️ Could not fetch/decrypt private balance on load:', privateError);
                        if (privateError.message && (privateError.message.includes('AES key') || privateError.message.includes('onboarding') || privateError.message.includes('SNAP_DIALOG_REJECTED') || privateError.message.includes('SNAP_CONNECT_FAILED'))) {
                            throw privateError;
                        }
                        return false;
                    }
                }
            }
            return true;
        } catch (error: any) {
            console.error('Error updating account state:', error);
            if (error.message && (error.message.includes('AES key') || error.message.includes('onboarding') || error.message.includes('SNAP_DIALOG_REJECTED') || error.message.includes('SNAP_CONNECT_FAILED'))) {
                throw error;
            }
            return false;
        }
    }, [setWalletAddress, setHasSnap, setIsConnected, setPublicTokens, checkNetwork, getAESKeyFromSnap, fetchPrivateBalance, setPrivateTokens, sessionAesKey, setSessionAesKey]);

    return { updateAccountState };
};
