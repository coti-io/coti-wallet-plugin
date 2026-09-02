import type { Dispatch, SetStateAction } from 'react';
import type { ethers } from 'ethers';
import type { Token } from '../usePluginBridge';
import type { AesKeyProviderOptions } from '../useAesKeyProvider';
import type { PrivateBalanceDecryptOptions } from '../usePrivateTokenBalance';
import type { UpdateAccountStateOptions } from '../../context/plugin/sessionShared';

export type AccountStateOptions = UpdateAccountStateOptions & AesKeyProviderOptions;

export type GetAesKeyFromSnap = (
    accountAddress: string,
    options?: { skipCache?: boolean } & AesKeyProviderOptions,
) => Promise<string | null>;

export type FetchPrivateBalance = (
    userAddress: string,
    aesKey: string,
    contractAddress: string,
    version: 64 | 256,
    decimals?: number,
    readChainId?: number,
    isPlainBalance?: boolean,
    decryptOptions?: PrivateBalanceDecryptOptions,
) => Promise<string>;

export type ValidateMetaMaskAesKeyOnUnlock = (
    snapKey: string,
    accountAddress: string,
    connectedChainId?: number | null,
) => Promise<void>;

export interface BalanceUpdaterDeps {
    setWalletAddress: (address: string) => void;
    setIsConnected: (connected: boolean) => void;
    setHasSnap: (hasSnap: boolean) => void;
    setPublicTokens: Dispatch<SetStateAction<Token[]>>;
    setPrivateTokens: Dispatch<SetStateAction<Token[]>>;
    checkNetwork: (provider: ethers.BrowserProvider) => Promise<void>;
    getAESKeyFromSnap: GetAesKeyFromSnap;
    fetchPrivateBalance: FetchPrivateBalance;
    canUseSnapOperations: boolean;
    snapDecryptOptions?: PrivateBalanceDecryptOptions;
    sessionAesKey?: string | null;
    setSessionAesKey: (key: string | null, keyWallet?: string) => void;
    autoInitTokens: boolean;
    validateMetaMaskAesKeyOnUnlock?: ValidateMetaMaskAesKeyOnUnlock;
}

export interface RunAccountStateParams {
    account: string;
    checkSnap?: boolean;
    aesKey?: string | null;
    chainId?: number;
    options?: AccountStateOptions;
}

export type IsStale = () => boolean;
