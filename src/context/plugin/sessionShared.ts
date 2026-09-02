import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { AesKeyProviderOptions, OnboardingProgressCallback } from '../../hooks/useAesKeyProvider';
import type { Token } from '../../hooks/usePluginBridge';
import type { CotiModalsContextValue } from './types';
import type { PrivateBalanceDecryptOptions } from '../../hooks/usePrivateTokenBalance';
import type { BuildItUint256ViaSnapParams, SnapItUint256 } from '../../hooks/useSnap';
import type { OnboardModalWarnings } from '../../lib/onboardModalWarnings';

export type UpdateAccountStateOptions = {
  /** When true, validate MetaMask Snap keys on unlock (reuses session key when present). */
  validateOnUnlock?: boolean;
};

export type RefreshPublicBalancesParams = {
  account: string;
  chainId?: number;
};

export type RefreshPrivateBalancesParams = {
  account: string;
  chainId?: number;
  aesKey?: string | null;
  checkSnap?: boolean;
  options?: UpdateAccountStateOptions & AesKeyProviderOptions;
};

/** Named account-state operations. Replaces the old positional updateAccountState flags. */
export type AccountStateOperations = {
  bindAccount: (account: string) => Promise<boolean>;
  refreshPublicBalances: (params: RefreshPublicBalancesParams) => Promise<boolean>;
  refreshPrivateBalances: (params: RefreshPrivateBalancesParams) => Promise<boolean>;
};

/** Wallet, Snap, and AES-session state. Always mounted (core). */
export interface PluginSessionState {
  modals: CotiModalsContextValue;
  isConnected: boolean;
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  walletAddress: string;
  setWalletAddress: Dispatch<SetStateAction<string>>;
  hasSnap: boolean;
  setHasSnap: Dispatch<SetStateAction<boolean>>;
  snapError: string | null;
  setSnapError: Dispatch<SetStateAction<string | null>>;
  publicTokens: Token[];
  setPublicTokens: Dispatch<SetStateAction<Token[]>>;
  privateTokens: Token[];
  setPrivateTokens: Dispatch<SetStateAction<Token[]>>;
  showSnapMissingModal: boolean;
  setShowSnapMissingModal: Dispatch<SetStateAction<boolean>>;
  showCotiWalletAesKeyModal: boolean;
  setShowCotiWalletAesKeyModal: Dispatch<SetStateAction<boolean>>;
  metamaskDetected: boolean;
  setMetamaskDetected: Dispatch<SetStateAction<boolean>>;
  ethereumListenerRegistered: MutableRefObject<boolean>;
  wagmiSyncRef: MutableRefObject<boolean>;
  disconnectingRef: MutableRefObject<boolean>;
  metamaskExplicitConnect: MutableRefObject<boolean>;
  sessionAesKey: string | null;
  setSessionAesKey: (key: string | null, keyWallet?: string) => void;
  aesKeyChainId: number | undefined;
  setAesKeyChainId: (chainId: number | undefined) => void;
  arePrivateBalancesHidden: boolean;
  setArePrivateBalancesHidden: Dispatch<SetStateAction<boolean>>;
  executeSnapCheck: (onSnapFound: () => Promise<boolean>) => Promise<void>;
  /** Probes Snap via wallet_getSnaps and updates hasSnap. Dedupes concurrent calls. */
  checkSnapStatus: () => Promise<boolean>;
  getAESKeyFromSnap: (accountAddress: string, options?: { skipCache?: boolean }) => Promise<string | null>;
  hasAesKeyInSnap: (accountAddress?: string) => Promise<boolean | null>;
  connectToSnap: () => Promise<boolean>;
  requestSnapConnection: () => Promise<boolean>;
  handleManualOnboarding: () => Promise<string | null>;
  handleKeyVerification: () => Promise<void>;
  clearSnapCache: () => void;
  fetchPrivateBalance: (
    userAddress: string,
    aesKey: string,
    contractAddress: string,
    version: 64 | 256,
    decimals?: number,
    readChainId?: number,
    isPlainBalance?: boolean,
    decryptOptions?: PrivateBalanceDecryptOptions,
  ) => Promise<string>;
  decryptCtUint64ViaSnap: NonNullable<PrivateBalanceDecryptOptions['decryptCtUint64']>;
  decryptCtUint256ViaSnap: NonNullable<PrivateBalanceDecryptOptions['decryptCtUint256']>;
  encryptUint256ViaSnap: (
    value: bigint | string,
    chainId?: number | string,
    accountAddress?: string,
  ) => Promise<{ ciphertextHigh: bigint; ciphertextLow: bigint } | null>;
  buildItUint256ViaSnap: (params: BuildItUint256ViaSnapParams) => Promise<SnapItUint256 | null>;
  getAesKeyFromProvider: (
    accountAddress: string,
    onProgress?: OnboardingProgressCallback,
    options?: AesKeyProviderOptions,
  ) => Promise<string | null>;
  onboardingError: string | null;
  onboardingWarnings: OnboardModalWarnings;
}

export type UpdateAccountStateRef = MutableRefObject<AccountStateOperations | null>;
