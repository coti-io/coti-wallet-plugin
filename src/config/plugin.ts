import type { BigNumberish } from 'ethers';
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from '../chains';

export type AesKeyChainId = typeof COTI_TESTNET_CHAIN_ID | typeof COTI_MAINNET_CHAIN_ID;

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

export interface SaveEncryptedAesBackupRequest extends OnboardingServiceRequest {
  backup: EncryptedAesBackup;
}

export interface OnboardingServices {
  /**
   * Disabled: no grant/backup features. Custom: use provided callbacks.
   * Official is reserved for stable COTI-hosted APIs.
   */
  mode?: 'disabled' | 'custom' | 'official';
  grantNativeCoti?: (request: OnboardingServiceRequest) => Promise<GrantResult>;
  fetchEncryptedAesBackup?: (request: OnboardingServiceRequest) => Promise<EncryptedAesBackup | null>;
  saveEncryptedAesBackup?: (request: SaveEncryptedAesBackupRequest) => Promise<void>;
  replaceEncryptedAesBackup?: (request: SaveEncryptedAesBackupRequest) => Promise<void>;
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
  /**
   * When false, the plugin will not call `wallet_requestSnaps` to install or
   * reconnect the Snap. An already-installed Snap can still be used for AES
   * key retrieval. Default: true.
   */
  snapInstallEnabled?: boolean;
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
  /** Optional onboarding service hooks for grant and encrypted AES backup flows. */
  onboardingServices?: OnboardingServices;
  /**
   * COTI chain that owns AES onboarding state for this app/session.
   * Only COTI Testnet and COTI Mainnet can hold AES keys.
   */
  aesKeyChainId?: AesKeyChainId;
  /** Native COTI threshold required before contract onboarding. Defaults to 0. */
  onboardingGrantMinBalanceWei?: BigNumberish;
  /** Polling interval after grant callback. Defaults to 2000ms. */
  onboardingGrantPollIntervalMs?: number;
  /** Max time to wait after grant callback. Defaults to 60000ms. */
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
  snapInstallEnabled: true,
  defaultNetworkId: undefined,
  debug: false,
  clearSessionKeyOnWagmiDisconnect: false,
  onboardingServices: { mode: 'disabled' },
  onboardingGrantMinBalanceWei: 0,
  onboardingGrantPollIntervalMs: 2000,
  onboardingGrantTimeoutMs: 60000,
  additionalSnapAesWriteOrigins: [],
};

export function isAesKeyChainId(chainId: unknown): chainId is AesKeyChainId {
  return chainId === COTI_TESTNET_CHAIN_ID || chainId === COTI_MAINNET_CHAIN_ID;
}

export function assertAesKeyChainId(chainId: unknown): asserts chainId is AesKeyChainId {
  if (chainId === undefined) return;
  if (!isAesKeyChainId(chainId)) {
    throw new Error(
      `Invalid aesKeyChainId: expected ${COTI_TESTNET_CHAIN_ID} or ${COTI_MAINNET_CHAIN_ID}, got ${String(chainId)}`,
    );
  }
}

/**
 * Configure the COTI Wallet Plugin at initialization time.
 * Call this before rendering any hooks.
 */
export function configureCotiPlugin(config: Partial<CotiPluginConfig>): void {
  assertAesKeyChainId(config.aesKeyChainId);
  _config = {
    ..._config,
    ...config,
    onboardingServices: {
      ..._config.onboardingServices,
      ...config.onboardingServices,
    },
  };
  if ('snapInstallEnabled' in config && _config.debug) {
    console.log('[CotiPlugin] snapInstallEnabled:', {
      snapInstallEnabled: config.snapInstallEnabled,
      effective: isSnapInstallEnabled(),
    });
  }
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

/** Whether `wallet_requestSnaps` install/connect is allowed for this app. */
export function isSnapInstallEnabled(): boolean {
  return getPluginConfig().snapInstallEnabled !== false;
}
