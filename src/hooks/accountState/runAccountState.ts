import { ethers } from 'ethers';
import { AVALANCHE_FUJI_CHAIN_ID } from '../../chains/avalancheFuji';
import { CONTRACT_ADDRESSES } from '../../contracts/config';
import {
    createJsonRpcProvider,
    createResilientJsonRpcProvider,
    isRateLimitedRpcError,
    isTransientRpcError,
    markPrimaryRateLimited,
    resolveRpcUrlsForChain,
} from '../../lib/rpcProvider';
import {
    CotiPluginError,
    CotiErrorCode,
    createRpcRateLimitedError,
    reportPluginError,
} from '../../errors';
import { logger } from '../../lib/logger';
import {
    ACCOUNT_STATE_OK,
    accountStateFailed,
    type AccountStateFailureReason,
    type AccountStateResult,
    type AesSessionResult,
} from '../../context/plugin/sessionShared';
import {
    allowSnapOperations,
    initialAesKey,
    loadAesKeyFromSnap,
    loadAesKeyFromSnapForRestore,
    shouldFetchAesKey,
    validateAesKeyOnUnlock,
} from './aesSession';
import { writePrivateBalances, writePublicBalances } from './tokenBalances';
import type { BalanceUpdaterDeps, RunAccountStateParams } from './types';
import {
    isAesKeyValidatedForUnlock,
    markAesKeyValidatedForUnlock,
} from '../../crypto/aesKeyValidation';

const raiseFujiRateLimited = (): never => {
    const err = createRpcRateLimitedError('Avalanche Fuji');
    reportPluginError(err);
    throw err;
};

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

const bindConnectedAccount = (
    deps: BalanceUpdaterDeps,
    account: string,
): void => {
    deps.setWalletAddress(account);
    deps.setIsConnected(true);
};

const wrapAccountStateError = (
    error: any,
    chainOverride: number | undefined,
    isStale: () => boolean,
): { ok: false; reason: AccountStateFailureReason } => {
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
};

type BalanceReadContext = {
    currentChainId: number;
    addresses: Record<string, string> | undefined;
    readProvider: ethers.Provider;
    useFujiRpcFallback: boolean;
};

const openBalanceRead = async (
    deps: BalanceUpdaterDeps,
    account: string,
    chainOverride: number | undefined,
    isStale: () => boolean,
): Promise<{ ok: true; ctx: BalanceReadContext } | { ok: false; reason: AccountStateFailureReason }> => {
    const hasChainOverride = typeof chainOverride === 'number';
    if (!(window.ethereum || hasChainOverride)) {
        logger.warn('Cannot fetch balances without wallet provider or chain override');
        return accountStateFailed('no_provider');
    }

    const browserProvider = window.ethereum && !hasChainOverride
        ? new ethers.BrowserProvider(window.ethereum)
        : null;

    if (browserProvider) {
        await deps.checkNetwork(browserProvider);
        if (isStale()) return accountStateFailed('stale');
    }

    const currentChainId = hasChainOverride
        ? chainOverride
        : Number((await browserProvider!.getNetwork()).chainId);
    if (isStale()) return accountStateFailed('stale');

    const addresses = CONTRACT_ADDRESSES[currentChainId];

    let readProvider: ethers.Provider;
    if (hasChainOverride && currentChainId === AVALANCHE_FUJI_CHAIN_ID) {
        readProvider = await createFujiBalanceReadProvider();
    } else if (hasChainOverride) {
        readProvider = await createResilientJsonRpcProvider(currentChainId);
    } else {
        readProvider = browserProvider!;
    }

    return {
        ok: true,
        ctx: {
            currentChainId,
            addresses,
            readProvider,
            useFujiRpcFallback: hasChainOverride && currentChainId === AVALANCHE_FUJI_CHAIN_ID,
        },
    };
};

export const runBindAccount = async (
    deps: BalanceUpdaterDeps,
    account: string,
    isStale: () => boolean,
): Promise<AccountStateResult> => {
    try {
        bindConnectedAccount(deps, account);
        if (isStale()) return accountStateFailed('stale');
        return ACCOUNT_STATE_OK;
    } catch (error: any) {
        return wrapAccountStateError(error, undefined, isStale);
    }
};

export const runEstablishAesSession = async (
    deps: BalanceUpdaterDeps,
    params: RunAccountStateParams,
    isStale: () => boolean,
): Promise<AesSessionResult> => {
    const {
        getAESKeyFromSnap,
        sessionAesKey,
        setSessionAesKey,
        setHasSnap,
        canUseSnapOperations,
        validateMetaMaskAesKeyOnUnlock,
    } = deps;
    const account = params.account;
    const checkSnap = params.checkSnap === true;
    const options = params.options;
    const validateOnUnlock = options?.validateOnUnlock === true;
    const allowSnap = allowSnapOperations(canUseSnapOperations, options);
    const forceContractOnboarding = options?.forceContractOnboarding === true;

    try {
        bindConnectedAccount(deps, account);
        let aesKey = initialAesKey(params.aesKey, sessionAesKey, forceContractOnboarding);
        const needsAesKeyFetch = shouldFetchAesKey({
            aesKeyOverride: params.aesKey,
            sessionAesKey,
            forceContractOnboarding,
            checkSnap,
            allowSnap,
            snapSideDecrypt: options?.snapSideDecrypt,
        });

        if (needsAesKeyFetch && !aesKey) {
            if (options?.restoreOnly) {
                logger.log('⚡ Restore-only unlock: fetching AES key');
                aesKey = await loadAesKeyFromSnapForRestore(
                    account,
                    options,
                    validateOnUnlock,
                    getAESKeyFromSnap,
                );
            } else {
                aesKey = await loadAesKeyFromSnap(
                    account,
                    options,
                    validateOnUnlock,
                    getAESKeyFromSnap,
                );
            }
            if (isStale()) return accountStateFailed('stale');
            if (!aesKey) {
                logger.log('ℹ️ AES key required for unlock but unavailable (cancelled or failed).');
                return accountStateFailed('no_aes_key');
            }
        }

        const validated = await validateAesKeyOnUnlock({
            aesKey,
            account,
            chainId: params.chainId,
            options,
            validateOnUnlock,
            validateMetaMaskAesKeyOnUnlock,
            isStale,
        });
        if (!validated.ok) return validated;

        if (
            aesKey
            && validated.markValidatedAfterSuccess
            && !isAesKeyValidatedForUnlock(account, aesKey)
        ) {
            markAesKeyValidatedForUnlock(account, aesKey);
        }

        if (allowSnap) {
            if (isStale()) return accountStateFailed('stale');
            setHasSnap(true);
        }
        if (aesKey) {
            if (isStale()) return accountStateFailed('stale');
            setSessionAesKey(aesKey, account);
        }

        if (!aesKey && !allowSnap) {
            return accountStateFailed('no_aes_key');
        }
        return { ok: true, aesKey };
    } catch (error: any) {
        return wrapAccountStateError(error, params.chainId, isStale);
    }
};

export const runRefreshPublicBalances = async (
    deps: BalanceUpdaterDeps,
    params: { account: string; chainId?: number },
    isStale: () => boolean,
): Promise<AccountStateResult> => {
    if (!deps.autoInitTokens) {
        bindConnectedAccount(deps, params.account);
        return ACCOUNT_STATE_OK;
    }

    try {
        bindConnectedAccount(deps, params.account);
        const opened = await openBalanceRead(deps, params.account, params.chainId, isStale);
        if (!opened.ok) return opened;
        return writePublicBalances({
            account: params.account,
            currentChainId: opened.ctx.currentChainId,
            addresses: opened.ctx.addresses,
            readProvider: opened.ctx.readProvider,
            useFujiRpcFallback: opened.ctx.useFujiRpcFallback,
            isStale,
            setPublicTokens: deps.setPublicTokens,
            raiseFujiRateLimited,
        });
    } catch (error: any) {
        return wrapAccountStateError(error, params.chainId, isStale);
    }
};

export const runRefreshPrivateBalances = async (
    deps: BalanceUpdaterDeps,
    params: { account: string; chainId?: number; aesKey?: string | null; allowSnapDecrypt?: boolean },
    isStale: () => boolean,
): Promise<AccountStateResult> => {
    if (!deps.autoInitTokens) {
        bindConnectedAccount(deps, params.account);
        return ACCOUNT_STATE_OK;
    }

    const aesKey = params.aesKey ?? deps.sessionAesKey ?? null;
    const allowSnap = params.allowSnapDecrypt ?? deps.canUseSnapOperations;

    try {
        bindConnectedAccount(deps, params.account);
        const opened = await openBalanceRead(deps, params.account, params.chainId, isStale);
        if (!opened.ok) return opened;
        if (!opened.ctx.addresses) {
            logger.warn(`No contract addresses configured for chain ${opened.ctx.currentChainId}`);
            return accountStateFailed('unsupported_chain');
        }

        try {
            return await writePrivateBalances({
                account: params.account,
                aesKey,
                currentChainId: opened.ctx.currentChainId,
                addresses: opened.ctx.addresses,
                allowSnap,
                snapDecryptOptions: deps.snapDecryptOptions,
                isStale,
                fetchPrivateBalance: deps.fetchPrivateBalance,
                setPrivateTokens: deps.setPrivateTokens,
            });
        } catch (privateError: any) {
            if (isStale()) return accountStateFailed('stale');
            logger.warn('⚠️ Could not fetch/decrypt private balance on load:', privateError);
            if (privateError instanceof CotiPluginError) {
                throw privateError;
            }
            return accountStateFailed('failed');
        }
    } catch (error: any) {
        return wrapAccountStateError(error, params.chainId, isStale);
    }
};
