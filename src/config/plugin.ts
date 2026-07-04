import type { BigNumberish } from 'ethers';

export interface EncryptedAesBackup {
  version: 1;
  address: string;
  chainId: number;
  signatureKind: 'eip712';
  iv: string;
  ciphertext: string;
  createdAt: string;
}

export interface GrantResult {
  txHash?: string;
  amountWei?: string;
  status?: 'submitted' | 'funded' | 'skipped';
}

export interface OnboardingServiceRequest {
  address: string;
  chainId: number;
}

export interface OnboardingServices {
  /**
   * Disabled: no grant feature. Custom: use provided grant callback.
   * Official is reserved for stable COTI-hosted APIs.
   */
  mode?: 'disabled' | 'custom' | 'official';
  grantNativeCoti?: (request: OnboardingServiceRequest) => Promise<GrantResult>;
}

/**
 * Plugin configuration — replaces Vite environment variables.
 * Consumers can override these via `configureCotiPlugin()` before using hooks.
 */
export interface CotiPluginConfig {
  /** The Snap ID for the COTI MetaMask Snap. Default: 'npm:@coti-io/coti-snap' */
  snapId: string;
  /**
   * Optional Snap version to request on install (`wallet_requestSnaps`).
   * When unset, MetaMask installs the latest published version.
   */
  snapVersion?: string;
  /** If set, enforces a specific network chain ID (decimal string or hex). */
  defaultNetworkId?: string;
  /** Sepolia RPC URL for PoD portal operations. */
  sepoliaRpcUrl?: string;
  /** COTI testnet RPC URL for PoD SDK tracking. */
  cotiTestnetRpcUrl?: string;
  /** WalletConnect Cloud project ID for RainbowKit / WalletConnect wallets. */
  walletConnectProjectId?: string;
  /**
   * Enables verbose internal logging via the plugin logger.
   * Disabled by default — the library is silent unless a consumer opts in.
   * Even when enabled, secret material (AES keys, ciphertext, signatures) is never logged.
   */
  debug?: boolean;
  /**
   * When true, clears the in-memory session AES key (and Snap cache) on implicit
   * wagmi/RainbowKit disconnect. Default false preserves the key so reconnecting
   * the same wallet can skip Snap re-fetch; use true for stricter shared-browser security.
   */
  clearSessionKeyOnWagmiDisconnect?: boolean;
  /** Optional onboarding service hooks for native COTI grants. */
  onboardingServices?: OnboardingServices;
  /**
   * CREATE2 `AesKeyBackupVault` address (same on COTI testnet and mainnet).
   * When omitted, encrypted backup restore/save is skipped and onboarding stays local/session-only.
   */
  aesKeyBackupVaultAddress?: string;
  /** Native COTI threshold required before contract onboarding. Defaults to 0. */
  onboardingGrantMinBalanceWei?: BigNumberish;
  /** Polling interval after grant callback. Defaults to 2000ms. */
  onboardingGrantPollIntervalMs?: number;
  /** Max time to wait after grant callback. Defaults to 30000ms. */
  onboardingGrantTimeoutMs?: number;
  /**
   * Additional origins allowed to call wallet_invokeSnap set-aes-key.
   * Use this to whitelist dApp domains that are not the published COTI portals.
   * Each entry must be an exact origin string (e.g. 'https://portal.example.com').
   * The Snap manifest's allowedOrigins must also include these domains — see PL-3.
   */
  additionalSnapAesWriteOrigins?: string[];
}

let _config: CotiPluginConfig = {
  snapId: 'npm:@coti-io/coti-snap',
  defaultNetworkId: undefined,
  debug: false,
  clearSessionKeyOnWagmiDisconnect: false,
  onboardingServices: { mode: 'disabled' },
  onboardingGrantMinBalanceWei: 0,
  onboardingGrantPollIntervalMs: 2000,
  onboardingGrantTimeoutMs: 30000,
  additionalSnapAesWriteOrigins: [],
};

/**
 * Configure the COTI Wallet Plugin at initialization time.
 * Call this before rendering any hooks.
 */
export function configureCotiPlugin(config: Partial<CotiPluginConfig>): void {
  _config = {
    ..._config,
    ...config,
    onboardingServices: {
      ..._config.onboardingServices,
      ...config.onboardingServices,
    },
  };
}

/**
 * Returns the params object for `wallet_requestSnaps`.
 * Omits version when unset so MetaMask installs the latest Snap.
 */
export function getSnapRequestParams(
  snapId: string = _config.snapId,
  snapVersion?: string,
): Record<string, Record<string, never> | { version: string }> {
  const version = (snapVersion ?? _config.snapVersion)?.trim();
  return version ? { [snapId]: { version } } : { [snapId]: {} };
}

/**
 * Returns the current plugin configuration.
 */
export function getPluginConfig(): Readonly<CotiPluginConfig> {
  return _config;
}
