import { useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, ERC20_ABI, getPublicTokensForChain, getPrivateTokensForChain } from '../contracts/config';
import { AVALANCHE_FUJI_CHAIN_ID } from '../chains/avalancheFuji';
import {
    createJsonRpcProvider,
    createResilientJsonRpcProvider,
    isRateLimitedRpcError,
    isTransientRpcError,
    markPrimaryRateLimited,
    resolveRpcUrlsForChain,
    withRpcFallback,
} from '../lib/rpcProvider';
import type { Token } from './usePluginBridge';
import type { AesKeyProviderOptions } from './useAesKeyProvider';
import type { PrivateBalanceDecryptOptions } from './usePrivateTokenBalance';
import { formatTokenBalanceDisplay } from '../lib/utils';
import {
    CotiPluginError,
    CotiErrorCode,
    createRpcRateLimitedError,
    hasCotiErrorCode,
    reportPluginError,
} from '../errors';
import { logger } from '../lib/logger';
import {
    ACCOUNT_STATE_OK,
    accountStateFailed,
    type AccountStateOperations,
    type AccountStateResult,
    type RefreshPrivateBalancesParams,
    type RefreshPublicBalancesParams,
    type UpdateAccountStateOptions,
} from '../context/plugin/sessionShared';
import {
    isAesKeyValidatedForUnlock,
    markAesKeyValidatedForUnlock,
} from '../crypto/aesKeyValidation';

const raiseFujiRateLimited = (): never => {
    const err = createRpcRateLimitedError('Avalanche Fuji');
    reportPluginError(err);
    throw err;
};

/**
 * Fuji balance reads try each configured RPC (ethers retries per URL first).
 * After the full primary→fallback cycle, if any URL was rate-limited, surface
 * the reload dialog (even when a later fallback recovered).
 */
const createFujiBalanceReadProvider = async (): Promise<ethers.JsonRpcProvider> => {
    const urls = resolveRpcUrlsForChain(AVALANCHE_FUJI_CHAIN_ID);
    let lastError: unknown;
    let sawRateLimit = false;

    for (const url of urls) {
        const provider = createJsonRpcProvider(url, AVALANCHE_FUJI_CHAIN_ID);
        try {
            await provider.getNetwork();
            if (sawRateLimit) {
                markPrimaryRateLimited(AVALANCHE_FUJI_CHAIN_ID);
                reportPluginError(createRpcRateLimitedError('Avalanche Fuji'));
            }
            return provider;
        } catch (error) {
            lastError = error;
            if (isRateLimitedRpcError(error)) {
                sawRateLimit = true;
                markPrimaryRateLimited(AVALANCHE_FUJI_CHAIN_ID);
            }
            if (!isTransientRpcError(error)) {
                throw error;
            }
            logger.warn(`[rpc] Fuji balance RPC ${url} unavailable, trying next`);
        }
    }

    if (sawRateLimit) {
        raiseFujiRateLimited();
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('No Fuji RPC available for balance reads');
};

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
    /**
     * When false, skip chain token catalogs and balance RPCs. Address/session AES
     * updates still run (tokens feature off / autoInitTokens off).
     */
    autoInitTokens?: boolean;
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
 * @returns Named account-state operations (`bindAccount`, `refreshPublicBalances`, `refreshPrivateBalances`).
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
    autoInitTokens = true,
    validateMetaMaskAesKeyOnUnlock,
}: UseBalanceUpdaterProps) => {
    const updateGenerationRef = useRef(0);

    const runAccountState = useCallback(async (params: {
        account: string;
        fetchPrivate: boolean;
        checkSnap?: boolean;
        aesKey?: string | null;
        chainId?: number;
        options?: UpdateAccountStateOptions & AesKeyProviderOptions;
    }): Promise<AccountStateResult> => {
        const account = params.account;
        const checkSnap = params.checkSnap === true;
        const fetchPrivate = params.fetchPrivate;
        const aesKeyOverride = params.aesKey;
        const chainOverride = params.chainId;
        const options = params.options;

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
            const deferPublicBalances =
                options?.restoreOnly === true
                && fetchPrivate
                && !aesKeyOverride
                && !sessionAesKey;

            if (!autoInitTokens) {
                if (!fetchPrivate) {
                    return ACCOUNT_STATE_OK;
                }

                const forceContractOnboarding = options?.forceContractOnboarding === true;
                const effectiveSessionAesKey = forceContractOnboarding ? null : sessionAesKey;
                let restoredAesKey: string | null = aesKeyOverride ?? effectiveSessionAesKey ?? null;
                const needsAesKeyFetch =
                    !aesKeyOverride
                    && !effectiveSessionAesKey
                    && checkSnap
                    && !(allowSnapOperations && options?.snapSideDecrypt);

                if (needsAesKeyFetch && !restoredAesKey) {
                    const { validateOnUnlock: _validateOnUnlock, ...aesKeyOptions } = options ?? {};
                    restoredAesKey = validateOnUnlock
                        ? await getAESKeyFromSnap(account, { skipCache: true, ...aesKeyOptions })
                        : options === undefined
                            ? await getAESKeyFromSnap(account)
                            : await getAESKeyFromSnap(account, aesKeyOptions);
                    if (isStale()) return accountStateFailed('stale');
                    if (!restoredAesKey) return accountStateFailed('no_aes_key');
                }

                if (
                    restoredAesKey
                    && validateOnUnlock
                    && validateMetaMaskAesKeyOnUnlock
                    && !options?.forceContractOnboarding
                    && !isAesKeyValidatedForUnlock(account, restoredAesKey)
                ) {
                    await validateMetaMaskAesKeyOnUnlock(restoredAesKey, account, chainOverride ?? null);
                    if (isStale()) return accountStateFailed('stale');
                    markAesKeyValidatedForUnlock(account, restoredAesKey);
                }

                if (allowSnapOperations) {
                    setHasSnap(true);
                }
                if (restoredAesKey) {
                    setSessionAesKey(restoredAesKey, account);
                }
                return restoredAesKey || allowSnapOperations
                    ? ACCOUNT_STATE_OK
                    : accountStateFailed('no_aes_key');
            }

            const hasChainOverride = typeof chainOverride === 'number';

            if (!(window.ethereum || hasChainOverride)) {
                if (fetchPrivate) {
                    logger.warn('Cannot fetch private balances without wallet provider or chain override');
                    return accountStateFailed('no_provider');
                }
                return ACCOUNT_STATE_OK;
            }

            if (window.ethereum || hasChainOverride) {
                const browserProvider = window.ethereum && !hasChainOverride
                    ? new ethers.BrowserProvider(window.ethereum)
                    : null;
                const forceContractOnboarding = options?.forceContractOnboarding === true;
                const effectiveSessionAesKey = forceContractOnboarding ? null : sessionAesKey;
                const needsAesKeyFetch =
                    fetchPrivate
                    && !aesKeyOverride
                    && !effectiveSessionAesKey
                    && checkSnap
                    && !(allowSnapOperations && options?.snapSideDecrypt);
                let restoredAesKey: string | null = aesKeyOverride ?? effectiveSessionAesKey ?? null;

                if (deferPublicBalances && needsAesKeyFetch) {
                    logger.log('⚡ Restore-only unlock: fetching AES key before balance RPCs');
                    const { validateOnUnlock: _validateOnUnlock, ...aesKeyOptions } = options ?? {};
                    restoredAesKey = validateOnUnlock
                        ? await getAESKeyFromSnap(account, { skipCache: true, ...aesKeyOptions })
                        : await getAESKeyFromSnap(account, aesKeyOptions);
                    if (isStale()) return accountStateFailed('stale');
                    if (!restoredAesKey) {
                        return accountStateFailed('no_aes_key');
                    }
                }

                if (browserProvider && !deferPublicBalances) {
                    await checkNetwork(browserProvider);
                    if (isStale()) return accountStateFailed('stale');
                }

                const currentChainId = hasChainOverride
                    ? chainOverride
                    : Number((await browserProvider!.getNetwork()).chainId);
                if (isStale()) return accountStateFailed('stale');

                const addresses = CONTRACT_ADDRESSES[currentChainId];
                if (fetchPrivate && !addresses) {
                    logger.warn(`No contract addresses configured for chain ${currentChainId}`);
                    return accountStateFailed('unsupported_chain');
                }

                let readProvider: ethers.Provider;
                try {
                    if (hasChainOverride && currentChainId === AVALANCHE_FUJI_CHAIN_ID) {
                        readProvider = await createFujiBalanceReadProvider();
                    } else if (hasChainOverride) {
                        readProvider = await createResilientJsonRpcProvider(currentChainId);
                    } else {
                        readProvider = browserProvider!;
                    }
                } catch (error) {
                    // createFujiBalanceReadProvider already reports after all RPCs fail.
                    throw error;
                }

                const useFujiRpcFallback =
                    hasChainOverride && currentChainId === AVALANCHE_FUJI_CHAIN_ID;

                // ─── Public Balances (dynamic) ──────────────────────────────────
                if (!deferPublicBalances) {
                const publicTokenConfigs = getPublicTokensForChain(currentChainId);

                let nativeBalance: string;
                try {
                    const nativeBalanceWei = useFujiRpcFallback
                        ? await withRpcFallback(currentChainId, (provider) => provider.getBalance(account))
                        : await readProvider.getBalance(account);
                    nativeBalance = ethers.formatEther(nativeBalanceWei);
                } catch (error) {
                    throw error;
                }

                // Fetch ERC20 public balances. On Fuji, serialize + never mask RPC
                // failures as "0" (that hid rate-limits from the UI).
                const publicBalances: string[] = [];
                for (const token of publicTokenConfigs) {
                    if (!token.addressKey || token.isNative) {
                        publicBalances.push(nativeBalance);
                        continue;
                    }
                    const tokenAddress = addresses?.[token.addressKey];
                    if (!tokenAddress) {
                        publicBalances.push('0');
                        continue;
                    }
                    try {
                        const bal = useFujiRpcFallback
                            ? await withRpcFallback(currentChainId, async (provider) => {
                                const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
                                return contract.balanceOf(account);
                            })
                            : await new ethers.Contract(tokenAddress, ERC20_ABI, readProvider).balanceOf(account);
                        publicBalances.push(ethers.formatUnits(bal, token.decimals));
                    } catch (error) {
                        // Never mask Fuji RPC failures as a real "0" balance.
                        if (useFujiRpcFallback) {
                            if (
                                hasCotiErrorCode(error, CotiErrorCode.RPC_RATE_LIMITED)
                                || isRateLimitedRpcError(error)
                            ) {
                                raiseFujiRateLimited();
                            }
                            throw error;
                        }
                        if (
                            hasCotiErrorCode(error, CotiErrorCode.RPC_RATE_LIMITED)
                            || isRateLimitedRpcError(error)
                        ) {
                            raiseFujiRateLimited();
                        }
                        publicBalances.push('0');
                    }
                }

                if (isStale()) return accountStateFailed('stale');

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
                }
                // ─── Private Balances (dynamic) ─────────────────────────────────
                if (addresses && fetchPrivate) {
                    try {
                        let aesKey: string | null = restoredAesKey;
                        let markValidatedAfterSuccess = false;

                        if (needsAesKeyFetch && !aesKey) {
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
                            if (isStale()) return accountStateFailed('stale');
                            if (!aesKey) {
                                logger.log('ℹ️ AES key required for unlock but unavailable (cancelled or failed).');
                                return accountStateFailed('no_aes_key');
                            }
                        }

        if (
                            aesKey
                            && validateOnUnlock
                            && validateMetaMaskAesKeyOnUnlock
                            && !options?.forceContractOnboarding
                            && !isAesKeyValidatedForUnlock(account, aesKey)
                        ) {
                            await validateMetaMaskAesKeyOnUnlock(aesKey, account, currentChainId);
                            if (isStale()) return accountStateFailed('stale');
                            markValidatedAfterSuccess = true;
                        }

                        if (aesKey && options?.forceContractOnboarding) {
                            markValidatedAfterSuccess = true;
                        }

                        if (allowSnapOperations) {
                            if (isStale()) return accountStateFailed('stale');
                            setHasSnap(true);
                        }

                        const privateTokenConfigs = getPrivateTokensForChain(currentChainId);
                        const publicTokenConfigs = getPublicTokensForChain(currentChainId);
                        // Private tokens backed by a native public asset (p.ETH, p.AVAX, p.COTI)
                        // store a plain uint256 balance; ERC-20-style pTokens use flat ctUint256.
                        const hasPlainPrivateTokens = privateTokenConfigs.some(token => {
                            const publicSymbol = token.symbol.replace(/^p\./, '');
                            return !!publicTokenConfigs.find(t => t.symbol === publicSymbol)?.isNative;
                        });

                        if (!aesKey && !allowSnapOperations && !hasPlainPrivateTokens) {
                            logger.log('ℹ️ Snap available but keys missing/rejected.');
                            return accountStateFailed('keys_unavailable');
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
                                const isPlainBalance = !!pubCfg?.isNative;
                                logger.log(`[BalanceUpdater] ${token.symbol} balance route`, {
                                    tokenAddress,
                                    decimals: token.decimals,
                                    publicSymbol,
                                    publicIsNative: pubCfg?.isNative ?? false,
                                    isPlainBalance,
                                    chainId: currentChainId,
                                });
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
                                        (e instanceof CotiPluginError && (
                                            e.code === CotiErrorCode.AES_KEY_MISMATCH
                                            || e.code === CotiErrorCode.ACCOUNT_NOT_ONBOARDED
                                        ))
                                        || msg.includes('AES key mismatch')
                                        || msg.includes('Invalid encrypted payload')
                                        || msg.includes('onboarding')
                                        || msg.includes('ACCOUNT_NOT_ONBOARDED')
                                        || msg.includes('implausible decrypted balance');
                                    if (isMismatch) {
                                        logger.warn(`⚠️ Private token decrypt mismatch for ${tokenAddress}. Falling back to 0.`);
                                        return { symbol: token.symbol, value: '0', isMismatch: true };
                                    }
                                    throw e;
                                }
                            }));

                            if (isStale()) return accountStateFailed('stale');

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
                                if (isStale()) return accountStateFailed('stale');
                                if (markValidatedAfterSuccess) {
                                    markAesKeyValidatedForUnlock(account, aesKey);
                                }
                                setSessionAesKey(aesKey, account);
                            }
                            return ACCOUNT_STATE_OK;
                        }
                    } catch (privateError: any) {
                        if (isStale()) return accountStateFailed('stale');
                        logger.warn('⚠️ Could not fetch/decrypt private balance on load:', privateError);
                        if (privateError instanceof CotiPluginError) {
                            throw privateError;
                        }
                        return accountStateFailed('failed');
                    }
                }
            }
            return ACCOUNT_STATE_OK;
        } catch (error: any) {
            if (isStale()) return accountStateFailed('stale');
            logger.error('Error updating account state:', error);
            if (error instanceof CotiPluginError) {
                if (error.code === CotiErrorCode.RPC_RATE_LIMITED) {
                    reportPluginError(error);
                }
                throw error;
            }
            if (
                typeof chainOverride === 'number'
                && chainOverride === AVALANCHE_FUJI_CHAIN_ID
                && isRateLimitedRpcError(error)
            ) {
                raiseFujiRateLimited();
            }
            return accountStateFailed('failed');
        }
    }, [setWalletAddress, setHasSnap, setIsConnected, setPublicTokens, checkNetwork, getAESKeyFromSnap, fetchPrivateBalance, canUseSnapOperations, setPrivateTokens, sessionAesKey, setSessionAesKey, autoInitTokens, validateMetaMaskAesKeyOnUnlock]);

    const bindAccount = useCallback(
        (account: string) => runAccountState({ account, fetchPrivate: false }),
        [runAccountState],
    );

    const refreshPublicBalances = useCallback(
        ({ account, chainId }: RefreshPublicBalancesParams) =>
            runAccountState({ account, chainId, fetchPrivate: false }),
        [runAccountState],
    );

    const refreshPrivateBalances = useCallback(
        ({ account, chainId, aesKey, checkSnap, options }: RefreshPrivateBalancesParams) =>
            runAccountState({
                account,
                chainId,
                aesKey,
                checkSnap,
                fetchPrivate: true,
                options,
            }),
        [runAccountState],
    );

    return { bindAccount, refreshPublicBalances, refreshPrivateBalances } satisfies AccountStateOperations;
};
