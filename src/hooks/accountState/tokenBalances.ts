import type { Dispatch, SetStateAction } from 'react';
import { ethers } from 'ethers';
import { ERC20_ABI, getPublicTokensForChain, getPrivateTokensForChain } from '../../contracts/config';
import { getNetworkNameForChain } from '../../chains';
import {
    isRateLimitedRpcError,
    withRpcFallback,
} from '../../lib/rpcProvider';
import { formatTokenBalanceDisplay } from '../../lib/utils';
import {
    CotiPluginError,
    CotiErrorCode,
    createRpcRateLimitedError,
    hasCotiErrorCode,
} from '../../errors';
import { logger } from '../../lib/logger';
import {
    ACCOUNT_STATE_OK,
    accountStateFailed,
    type AccountStateResult,
} from '../../context/plugin/sessionShared';
import type { Token } from '../usePluginBridge';
import type { PrivateBalanceDecryptOptions } from '../usePrivateTokenBalance';
import type { FetchPrivateBalance, IsStale } from './types';

type RaiseFujiRateLimited = () => never;

export const writePublicBalances = async ({
    account,
    currentChainId,
    addresses,
    readProvider,
    useFujiRpcFallback,
    isStale,
    setPublicTokens,
    raiseFujiRateLimited,
}: {
    account: string;
    currentChainId: number;
    addresses: Record<string, string> | undefined;
    readProvider: ethers.Provider;
    useFujiRpcFallback: boolean;
    isStale: IsStale;
    setPublicTokens: Dispatch<SetStateAction<Token[]>>;
    raiseFujiRateLimited: RaiseFujiRateLimited;
}): Promise<AccountStateResult> => {
    const publicTokenConfigs = getPublicTokensForChain(currentChainId);

    const nativeBalanceWei = useFujiRpcFallback
        ? await withRpcFallback(currentChainId, (provider) => provider.getBalance(account))
        : await readProvider.getBalance(account);
    const nativeBalance = ethers.formatEther(nativeBalanceWei);

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
            const isRateLimited =
                hasCotiErrorCode(error, CotiErrorCode.RPC_RATE_LIMITED)
                || isRateLimitedRpcError(error);
            if (useFujiRpcFallback) {
                if (isRateLimited) {
                    raiseFujiRateLimited();
                }
                throw error;
            }
            if (isRateLimited) {
                throw hasCotiErrorCode(error, CotiErrorCode.RPC_RATE_LIMITED)
                    ? error
                    : createRpcRateLimitedError(getNetworkNameForChain(currentChainId));
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
    return ACCOUNT_STATE_OK;
};

export const writePrivateBalances = async ({
    account,
    aesKey,
    currentChainId,
    addresses,
    allowSnap,
    snapDecryptOptions,
    isStale,
    fetchPrivateBalance,
    setPrivateTokens,
}: {
    account: string;
    aesKey: string | null;
    currentChainId: number;
    addresses: Record<string, string>;
    allowSnap: boolean;
    snapDecryptOptions?: PrivateBalanceDecryptOptions;
    isStale: IsStale;
    fetchPrivateBalance: FetchPrivateBalance;
    setPrivateTokens: Dispatch<SetStateAction<Token[]>>;
}): Promise<AccountStateResult> => {
    const privateTokenConfigs = getPrivateTokensForChain(currentChainId);
    const publicTokenConfigs = getPublicTokensForChain(currentChainId);
    const hasPlainPrivateTokens = privateTokenConfigs.some(token => {
        const publicSymbol = token.symbol.replace(/^p\./, '');
        return !!publicTokenConfigs.find(t => t.symbol === publicSymbol)?.isNative;
    });

    if (!aesKey && !allowSnap && !hasPlainPrivateTokens) {
        logger.log('Private catalog refresh skipped: no AES key, Snap, or plain private tokens.');
        return accountStateFailed('keys_unavailable');
    }

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
        if (!aesKey && !allowSnap && !isPlainBalance) {
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
                allowSnap ? snapDecryptOptions : undefined,
            );
            return { symbol: token.symbol, value, isMismatch: false };
        } catch (e: unknown) {
            const isMismatch =
                hasCotiErrorCode(e, CotiErrorCode.AES_KEY_MISMATCH)
                || hasCotiErrorCode(e, CotiErrorCode.ACCOUNT_NOT_ONBOARDED)
                || hasCotiErrorCode(e, CotiErrorCode.ONBOARDING_INCOMPLETE);
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
    return ACCOUNT_STATE_OK;
};
