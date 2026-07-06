import { useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, ERC20_ABI, getPublicTokensForChain, getPrivateTokensForChain } from '../contracts/config';
import { getChainConfig } from '../chains';
import { getRpcUrlForChainId } from '../config/chains';
import type { Token } from './usePrivacyBridge';
import type { AesKeyProviderOptions } from './useAesKeyProvider';
import type { PrivateBalanceDecryptOptions } from './usePrivateTokenBalance';
import { formatTokenBalanceDisplay } from '../lib/utils';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';
import type { UpdateAccountStateOptions } from '../context/privacyBridge/sessionShared';
import {
    isAesKeyValidatedForUnlock,
    markAesKeyValidatedForUnlock,
} from '../crypto/aesKeyValidation';

interface UseBalanceUpdaterProps {
    setWalletAddress: (address: string) => void;
    setIsConnected: (connected: boolean) => void;
    setHasSnap: (hasSnap: boolean) => void;
    setPublicTokens: React.Dispatch<React.SetStateAction<Token[]>>;
    setPrivateTokens: React.Dispatch<React.SetStateAction<Token[]>>;
    checkNetwork: (provider: ethers.BrowserProvider) => Promise<void>;
    getAESKeyFromSnap: (
        accountAddress: string,
        options?: { skipCache?: boolean } & AesKeyProviderOptions,
    ) => Promise<string | null>;
    fetchPrivateBalance: (userAddress: string, aesKey: string, contractAddress: string, version: 64 | 256, decimals?: number, readChainId?: number, isPlainBalance?: boolean, decryptOptions?: PrivateBalanceDecryptOptions) => Promise<string>;
    canUseSnapOperations?: boolean;
    snapDecryptOptions?: PrivateBalanceDecryptOptions;
    sessionAesKey?: string | null;
    setSessionAesKey: (key: string | null, keyWallet?: string) => void;
    /** MetaMask-only: read-only Snap key validation on explicit unlock. */
    validateMetaMaskAesKeyOnUnlock?: (
        snapKey: string,
        accountAddress: string,
        connectedChainId?: number | null,
    ) => Promise<void>;
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
    canUseSnapOperations = false,
    snapDecryptOptions,
    sessionAesKey,
    setSessionAesKey,
    validateMetaMaskAesKeyOnUnlock,
}: UseBalanceUpdaterProps) => {
    const updateGenerationRef = useRef(0);

    const updateAccountState = useCallback(async (
        account: string,
        checkSnap = false,
        fetchPrivate = false,
        aesKeyOverride?: string | null,
        chainOverride?: number,
        options?: UpdateAccountStateOptions & AesKeyProviderOptions,
    ) => {
        const generation = ++updateGenerationRef.current;
        const isStale = () => generation !== updateGenerationRef.current;
        const validateOnUnlock = options?.validateOnUnlock === true;

        try {
            setWalletAddress(account);
            setIsConnected(true);
            const allowSnapOperations =
                canUseSnapOperations
                && !options?.forceContractOnboarding
                && (!options?.restoreOnly || options?.snapSideDecrypt === true);

            const hasChainOverride = typeof chainOverride === 'number';
            if (window.ethereum || hasChainOverride) {
                // When wagmi supplies chainOverride, read balances via RPC — do not
                // probe window.ethereum (may be hijacked by another extension).
                const browserProvider = window.ethereum && !hasChainOverride
                    ? new ethers.BrowserProvider(window.ethereum)
                    : null;

                // Ensure network name is updated immediately when MetaMask is available.
                if (browserProvider) {
                    await checkNetwork(browserProvider);
                    if (isStale()) return false;
                }

                const currentChainId = hasChainOverride
                    ? chainOverride
                    : Number((await browserProvider!.getNetwork()).chainId);
                if (isStale()) return false;
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
                    // Native token — show chain coin balance (wrapped address is only for the portal contract).
                    if (!token.addressKey || token.isNative) {
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

                if (isStale()) return false;

                logger.log('✅ Updating public tokens list');
                setPublicTokens(publicTokenConfigs.map((token, index) => ({
                    symbol: token.symbol,
                    name: token.name,
                    balance: formatTokenBalanceDisplay(token.symbol, publicBalances[index]),
                    isPrivate: false,
                    icon: token.icon,
                    addressKey: token.addressKey,
                    bridgeAddressKey: token.bridgeAddressKey,
                    decimals: token.decimals,
                    isNative: token.isNative,
                    supportedChainIds: token.supportedChainIds,
                })));
                // ─── Private Balances (dynamic) ─────────────────────────────────
                if (addresses && fetchPrivate) {
                    try {
                        let aesKey: string | null = aesKeyOverride ?? sessionAesKey ?? null;

                        if (checkSnap && !aesKey && !(allowSnapOperations && options?.snapSideDecrypt)) {
                            const { validateOnUnlock: _validateOnUnlock, ...aesKeyOptions } = options ?? {};
                            if (validateOnUnlock) {
                                aesKey = Object.keys(aesKeyOptions).length === 0
                                    ? await getAESKeyFromSnap(account, { skipCache: true })
                                    : await getAESKeyFromSnap(account, { skipCache: true, ...aesKeyOptions });
                            } else {
                                aesKey = options === undefined
                                    ? await getAESKeyFromSnap(account)
                                    : await getAESKeyFromSnap(account, aesKeyOptions);
                            }
                            if (isStale()) return false;
                        }

                        if (
                            aesKey
                            && validateOnUnlock
                            && validateMetaMaskAesKeyOnUnlock
                            && !isAesKeyValidatedForUnlock(account, aesKey)
                        ) {
                            await validateMetaMaskAesKeyOnUnlock(aesKey, account, currentChainId);
                            if (isStale()) return false;
                            markAesKeyValidatedForUnlock(account, aesKey);
                        }

                        if (allowSnapOperations) {
                            if (isStale()) return false;
                            setHasSnap(true);
                        }

                        const privateTokenConfigs = getPrivateTokensForChain(currentChainId);
                        const publicTokenConfigs = getPublicTokensForChain(currentChainId);
                        // On PoD portal chains (e.g. Sepolia), private tokens always store
                        // encrypted ciphertexts even when the public counterpart is native.
                        // Only on coti-bridge chains can a native public token imply a plain
                        // (unencrypted) private balance (e.g. p.COTI on COTI chain).
                        const chainCfg = getChainConfig(currentChainId);
                        const isPodChain = chainCfg?.portalStrategy === 'pod-privacy-portal';
                        const hasPlainPrivateTokens = !isPodChain && privateTokenConfigs.some(token => {
                            const publicSymbol = token.symbol.replace(/^p\./, '');
                            return !!publicTokenConfigs.find(t => t.symbol === publicSymbol)?.isNative;
                        });

                        if (!aesKey && !allowSnapOperations && !hasPlainPrivateTokens) {
                            logger.log('ℹ️ Snap available but keys missing/rejected.');
                            return false;
                        }

                        if (aesKey || allowSnapOperations || hasPlainPrivateTokens) {
                            logger.log('🔄 Fetching private balances...');

                            const privateFetches = await Promise.all(privateTokenConfigs.map(async token => {
                                const tokenAddress = token.addressKey ? addresses[token.addressKey] : undefined;
                                if (!tokenAddress) {
                                    return { symbol: token.symbol, value: '0', isMismatch: false };
                                }
                                const publicSymbol = token.symbol.replace(/^p\./, '');
                                const pubCfg = publicTokenConfigs.find(t => t.symbol === publicSymbol);
                                const isPlainBalance = !isPodChain && !!pubCfg?.isNative;
                                if (!aesKey && !allowSnapOperations && !isPlainBalance) {
                                    return { symbol: token.symbol, value: '0', isMismatch: false };
                                }
                                try {
                                    const value = await fetchPrivateBalance(
                                        account,
                                        aesKey ?? '',
                                        tokenAddress,
                                        256,
                                        token.decimals,
                                        currentChainId,
                                        isPlainBalance,
                                        allowSnapOperations ? snapDecryptOptions : undefined,
                                    );
                                    return { symbol: token.symbol, value, isMismatch: false };
                                } catch (e: any) {
                                    const msg = e?.message || '';
                                    const isMismatch =
                                        msg.includes('AES key mismatch') ||
                                        msg.includes('onboarding') ||
                                        msg.includes('ACCOUNT_NOT_ONBOARDED') ||
                                        msg.includes('implausible decrypted balance');
                                    if (isMismatch) {
                                        logger.warn(`⚠️ Private token decrypt mismatch for ${tokenAddress}. Falling back to 0.`);
                                        return { symbol: token.symbol, value: '0', isMismatch: true };
                                    }
                                    throw e;
                                }
                            }));

                            if (isStale()) return false;

                            const mismatchCount = privateFetches.filter(r => r.isMismatch).length;

                            if (mismatchCount > 0) {
                                throw new CotiPluginError(
                                    CotiErrorCode.AES_KEY_MISMATCH,
                                    `AES key mismatch for ${mismatchCount} private token(s). Re-onboarding required.`,
                                );
                            }

                            logger.log('🔐 Updating private tokens list');
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
                                    decimals: token.decimals,
                                    supportedChainIds: token.supportedChainIds,
                                };
                            }));
                            if (aesKey) {
                                if (isStale()) return false;
                                setSessionAesKey(aesKey, account);
                            }
                            return true;
                        }
                    } catch (privateError: any) {
                        if (isStale()) return false;
                        logger.warn('⚠️ Could not fetch/decrypt private balance on load:', privateError);
                        if (privateError instanceof CotiPluginError) {
                            throw privateError;
                        }
                        return false;
                    }
                }
            }
            return true;
        } catch (error: any) {
            if (isStale()) return false;
            logger.error('Error updating account state:', error);
            if (error instanceof CotiPluginError) {
                throw error;
            }
            return false;
        }
    }, [setWalletAddress, setHasSnap, setIsConnected, setPublicTokens, checkNetwork, getAESKeyFromSnap, fetchPrivateBalance, canUseSnapOperations, setPrivateTokens, sessionAesKey, setSessionAesKey, validateMetaMaskAesKeyOnUnlock]);

    return { updateAccountState };
};
