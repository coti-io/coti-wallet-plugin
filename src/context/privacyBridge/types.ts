import type { SwapProgressStage, Token } from '../../hooks/usePrivacyBridge';
import type { AesKeyProviderOptions } from '../../hooks/useAesKeyProvider';
import type { PodPortalRequest } from '../../contracts/pod';

/** Wallet connection slice — connect/disconnect and address. */
export interface PrivacyBridgeWalletContextValue {
  isConnected: boolean;
  walletAddress: string;
  handleConnect: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
  metamaskDetected: boolean;
}

/** Network slice — chain id, switching, and enforcer state. */
export interface PrivacyBridgeNetworkContextValue {
  chainId: string | null;
  switchNetwork: (chainId: string) => Promise<boolean>;
  networkName: string;
  isUnsupportedNetwork: boolean;
  isOffTargetNetwork: boolean;
  /** @deprecated Use isUnsupportedNetwork */
  isWrongNetwork: boolean;
  networkMismatchWarning: string | null;
  enforceNetwork: () => Promise<void>;
  COTI_MAINNET_ID: string;
  COTI_TESTNET_ID: string;
  SEPOLIA_ID: string;
}

/** Snap / AES unlock slice. */
export interface PrivacyBridgeUnlockContextValue {
  hasSnap: boolean;
  snapError: string | null;
  /** True/false when check succeeds; null when Snap is unavailable. */
  hasAesKeyInSnap: (accountAddress?: string) => Promise<boolean | null>;
  connectToSnap: () => Promise<boolean>;
  requestSnapConnection: () => Promise<boolean>;
  /** Probes Snap via wallet_getSnaps, updates hasSnap, and returns the result. */
  checkSnapStatus: () => Promise<boolean>;
  /** Session-bound AES key when unlocked (null when locked or disconnected). */
  sessionAesKey: string | null;
  isPrivateUnlocked: boolean;
  /** Re-unlock after lock without page refresh (uses in-memory session key internally). */
  unlockCachedAesKey: () => Promise<void>;
  sendPrivateToken: (params: {
    symbol: string;
    recipient: string;
    amount: string;
  }) => Promise<{ txHash: string }>;
  /** Encrypt a human-readable amount into ctUint256 JSON without exposing the AES key. */
  encryptPrivateValue: (params: {
    amount: string;
    decimals?: number;
  }) => Promise<{ ciphertext: string }>;
  /** Decrypt ctUint256 JSON back to a human-readable amount without exposing the AES key. */
  decryptPrivateValue: (params: {
    ciphertext: string;
    decimals?: number;
  }) => Promise<{ amount: string }>;
  refreshPrivateBalances: (options?: AesKeyProviderOptions) => Promise<boolean>;
  lockPrivateBalances: () => void;
  handleOnboard: () => Promise<string | null>;
  saveManualAesKey: (aesKey: string) => Promise<void>;
  handleVerifyKeys: () => Promise<void>;
  showSnapMissingModal: boolean;
  setShowSnapMissingModal: (show: boolean) => void;
  showCotiWalletAesKeyModal: boolean;
  setShowCotiWalletAesKeyModal: (show: boolean) => void;
}

/** Token balances exposed to the UI. */
export interface PrivacyBridgeTokensContextValue {
  publicTokens: Token[];
  privateTokens: Token[];
}

/** Bridge / swap form and transaction slice. */
export interface PrivacyBridgeSwapContextValue {
  amount: string;
  direction: 'to-private' | 'to-public';
  selectedTokenIndex: number;
  setAmount: (amount: string) => void;
  setDirection: (direction: 'to-private' | 'to-public') => void;
  setSelectedTokenIndex: (index: number) => void;
  handleSwap: (
    amount?: string,
    direction?: 'to-private' | 'to-public',
    tokenIndex?: number,
    onProgress?: (stage: SwapProgressStage, txHash?: string) => void
  ) => Promise<void>;
  isBridgingLoading: boolean;
  isApprovalNeeded: boolean;
  isApproving: boolean;
  handleApprove: () => Promise<void>;
  estimatedGasFee: string | null;
  updateGasFee: () => Promise<void>;
  isGasEstimating: boolean;
  portalFeeCoti: string | null;
  feeDebugInfo: { cotiLastUpdated: string; tokenLastUpdated: string; blockTimestamp: string } | null;
}

/** PoD portal request tracking (Sepolia). */
export interface PrivacyBridgePodContextValue {
  podRequests: PodPortalRequest[];
  refreshPodRequest: (request: PodPortalRequest) => Promise<void>;
}

/** Install / conflict modals not tied to unlock flow. */
export interface PrivacyBridgeModalsContextValue {
  showInstallModal: boolean;
  setShowInstallModal: (show: boolean) => void;
  showMultipleWalletsModal: boolean;
  setShowMultipleWalletsModal: (show: boolean) => void;
}

/**
 * Legacy flat context — union of all slices.
 * Existing consumers should keep using {@link usePrivacyBridgeContext}.
 */
export type PrivacyBridgeContextType = PrivacyBridgeWalletContextValue &
  PrivacyBridgeNetworkContextValue &
  PrivacyBridgeUnlockContextValue &
  PrivacyBridgeTokensContextValue &
  PrivacyBridgeSwapContextValue &
  PrivacyBridgePodContextValue &
  PrivacyBridgeModalsContextValue;

export interface PrivacyBridgeContextSlices {
  wallet: PrivacyBridgeWalletContextValue;
  network: PrivacyBridgeNetworkContextValue;
  unlock: PrivacyBridgeUnlockContextValue;
  tokens: PrivacyBridgeTokensContextValue;
  swap: PrivacyBridgeSwapContextValue;
  pod: PrivacyBridgePodContextValue;
  modals: PrivacyBridgeModalsContextValue;
}

/** Merges bounded slices into the legacy flat context shape. */
export const mergePrivacyBridgeSlices = (
  slices: PrivacyBridgeContextSlices,
): PrivacyBridgeContextType => ({
  ...slices.wallet,
  ...slices.network,
  ...slices.unlock,
  ...slices.tokens,
  ...slices.swap,
  ...slices.pod,
  ...slices.modals,
});
