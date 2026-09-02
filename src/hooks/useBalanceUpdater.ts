import { useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ethers } from 'ethers';
import type { Token } from './usePluginBridge';
import type { PrivateBalanceDecryptOptions } from './usePrivateTokenBalance';
import type {
    AccountStateOperations,
    EstablishAesSessionParams,
    RefreshPrivateBalancesParams,
    RefreshPublicBalancesParams,
} from '../context/plugin/sessionShared';
import {
    runBindAccount,
    runEstablishAesSession,
    runRefreshPrivateBalances,
    runRefreshPublicBalances,
} from './accountState/runAccountState';
import type { BalanceUpdaterDeps } from './accountState/types';

interface UseBalanceUpdaterProps {
    setWalletAddress: (address: string) => void;
    setIsConnected: (connected: boolean) => void;
    setHasSnap: (hasSnap: boolean) => void;
    setPublicTokens: Dispatch<SetStateAction<Token[]>>;
    setPrivateTokens: Dispatch<SetStateAction<Token[]>>;
    checkNetwork: (provider: ethers.BrowserProvider) => Promise<void>;
    getAESKeyFromSnap: BalanceUpdaterDeps['getAESKeyFromSnap'];
    fetchPrivateBalance: BalanceUpdaterDeps['fetchPrivateBalance'];
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
    validateMetaMaskAesKeyOnUnlock?: BalanceUpdaterDeps['validateMetaMaskAesKeyOnUnlock'];
}

/**
 * Account bind, AES session, and public/private token catalog writes.
 * AES session restore is not mixed into catalog refresh.
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

    const deps: BalanceUpdaterDeps = {
        setWalletAddress,
        setIsConnected,
        setHasSnap,
        setPublicTokens,
        setPrivateTokens,
        checkNetwork,
        getAESKeyFromSnap,
        fetchPrivateBalance,
        canUseSnapOperations,
        snapDecryptOptions,
        sessionAesKey,
        setSessionAesKey,
        autoInitTokens,
        validateMetaMaskAesKeyOnUnlock,
    };

    const bindAccount = useCallback(
        (account: string) => {
            const generation = ++updateGenerationRef.current;
            return runBindAccount(deps, account, () => generation !== updateGenerationRef.current);
        },
        [
            setWalletAddress,
            setIsConnected,
            setHasSnap,
            setPublicTokens,
            setPrivateTokens,
            checkNetwork,
            getAESKeyFromSnap,
            fetchPrivateBalance,
            canUseSnapOperations,
            snapDecryptOptions,
            sessionAesKey,
            setSessionAesKey,
            autoInitTokens,
            validateMetaMaskAesKeyOnUnlock,
        ],
    );

    const establishAesSession = useCallback(
        (params: EstablishAesSessionParams) => {
            const generation = ++updateGenerationRef.current;
            return runEstablishAesSession(deps, params, () => generation !== updateGenerationRef.current);
        },
        [
            setWalletAddress,
            setIsConnected,
            setHasSnap,
            setPublicTokens,
            setPrivateTokens,
            checkNetwork,
            getAESKeyFromSnap,
            fetchPrivateBalance,
            canUseSnapOperations,
            snapDecryptOptions,
            sessionAesKey,
            setSessionAesKey,
            autoInitTokens,
            validateMetaMaskAesKeyOnUnlock,
        ],
    );

    const refreshPublicBalances = useCallback(
        (params: RefreshPublicBalancesParams) => {
            const generation = ++updateGenerationRef.current;
            return runRefreshPublicBalances(deps, params, () => generation !== updateGenerationRef.current);
        },
        [
            setWalletAddress,
            setIsConnected,
            setHasSnap,
            setPublicTokens,
            setPrivateTokens,
            checkNetwork,
            getAESKeyFromSnap,
            fetchPrivateBalance,
            canUseSnapOperations,
            snapDecryptOptions,
            sessionAesKey,
            setSessionAesKey,
            autoInitTokens,
            validateMetaMaskAesKeyOnUnlock,
        ],
    );

    const refreshPrivateBalances = useCallback(
        (params: RefreshPrivateBalancesParams) => {
            const generation = ++updateGenerationRef.current;
            return runRefreshPrivateBalances(deps, params, () => generation !== updateGenerationRef.current);
        },
        [
            setWalletAddress,
            setIsConnected,
            setHasSnap,
            setPublicTokens,
            setPrivateTokens,
            checkNetwork,
            getAESKeyFromSnap,
            fetchPrivateBalance,
            canUseSnapOperations,
            snapDecryptOptions,
            sessionAesKey,
            setSessionAesKey,
            autoInitTokens,
            validateMetaMaskAesKeyOnUnlock,
        ],
    );

    return {
        bindAccount,
        establishAesSession,
        refreshPublicBalances,
        refreshPrivateBalances,
    } satisfies AccountStateOperations;
};
