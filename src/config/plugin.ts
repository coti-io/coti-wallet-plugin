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
  /** Native COTI threshold required before contract onboarding. Defaults to 0. */
  onboardingGrantMinBalanceWei?: BigNumberish;
  /** Polling interval after grant callback. Defaults to 2000ms. */
  onboardingGrantPollIntervalMs?: number;
  /** Max time to wait after grant callback. Defaults to 30000ms. */
  onboardingGrantTimeoutMs?: number;
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
 * Returns the current plugin configuration.
 */
export function getPluginConfig(): Readonly<CotiPluginConfig> {
  return _config;
}
