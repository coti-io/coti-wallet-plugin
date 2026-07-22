import type { BigNumberish } from 'ethers';
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from '../chains';

/** Default COTI Testnet gas-grant endpoint. */
export const DEFAULT_GRANT_API_URL_TESTNET =
  'https://testnet-apps-1-gw.coti.io/cms-coti-2bb8/api/v1/gas-grant';

/** Default onboarding min-balance in wei (0.2 COTI). Hardcoded so module init does not depend on ethers. */
export const DEFAULT_ONBOARDING_GRANT_MIN_BALANCE_WEI = '200000000000000000';

export type AesKeyChainId = typeof COTI_TESTNET_CHAIN_ID | typeof COTI_MAINNET_CHAIN_ID;

export interface EncryptedAesBackup {
  version: 2;
  address: string;
  chainId: number;
  signatureKind: 'eip712';
  /** Key-derivation used to wrap the AES key from the EIP-712 signature. */
  kdf: 'hkdf-sha256';
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
   *
   * Remote storage must authenticate fetch/save/replace/delete with a challenge
   * distinct from the AES backup wrap signature — see
   * https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/aes-backup-remote-storage
   * Do not reuse the wrap EIP-712 signature as an API bearer token.
   */
  mode?: 'disabled' | 'custom' | 'official';
  grantNativeCoti?: (request: OnboardingServiceRequest) => Promise<GrantResult>;
  fetchEncryptedAesBackup?: (request: OnboardingServiceRequest) => Promise<EncryptedAesBackup | null>;
  saveEncryptedAesBackup?: (request: SaveEncryptedAesBackupRequest) => Promise<void>;
  replaceEncryptedAesBackup?: (request: SaveEncryptedAesBackupRequest) => Promise<void>;
  /**
   * Remove a stored encrypted backup (e.g. after an outdated v1 blob is rejected).
   * Best-effort; unlock/onboarding continues even if delete fails.
   */
  deleteEncryptedAesBackup?: (request: OnboardingServiceRequest) => Promise<void>;
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
   * When false, Snap is fully disabled for this app: no install/connect,
   * no AES key probe/retrieval, and strategy routing ignores an already-installed
   * Snap. Unlock continues via encrypted backup restore and/or contract
   * onboarding. Default: true.
   */
  snapEnabled?: boolean;
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
  /**
   * When true, private token transfers await `refreshPrivateBalances` before
   * returning (confirmation UI stays open until balances decrypt). Default false
   * refreshes in the background so success can show immediately.
   */
  waitForBalanceRefreshAfterTransfer?: boolean;
  /** Optional onboarding service hooks for grant and encrypted AES backup flows. */
  onboardingServices?: OnboardingServices;
  /**
   * COTI chain that owns AES onboarding state for this app/session.
   * Only COTI Testnet and COTI Mainnet can hold AES keys.
   */
  aesKeyChainId?: AesKeyChainId;
  /**
   * When false, skips native COTI grant requests during onboarding.
   * Default: true. Uses built-in grant API when no custom grantNativeCoti is set.
   */
  onboardingGrantEnabled?: boolean;
  /** COTI Testnet gas-grant endpoint. Default: official COTI Testnet grant API. */
  grantApiUrlTestnet?: string;
  /** COTI Mainnet gas-grant endpoint. No default — grant is skipped on mainnet until set. */
  grantApiUrlMainnet?: string;
  /** Native COTI threshold required before contract onboarding. Defaults to 0.2 COTI. */
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
  /**
   * **Unsafe escape hatch.** When true, skips the second-signature restore test
   * before persisting an encrypted AES backup. A nondeterministic wallet can then
   * save a blob that can never be restored. Default: false (determinism check on).
   * Prefer leaving this unset — see
   * https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/aes-backup-security
   */
  unsafeSkipBackupDeterminismCheck?: boolean;
}

let _config: CotiPluginConfig = {
  snapId: 'npm:@coti-io/coti-snap',
  snapEnabled: true,
  defaultNetworkId: undefined,
  debug: false,
  clearSessionKeyOnWagmiDisconnect: false,
  waitForBalanceRefreshAfterTransfer: false,
  onboardingServices: { mode: 'disabled' },
  onboardingGrantEnabled: true,
  grantApiUrlTestnet: DEFAULT_GRANT_API_URL_TESTNET,
  onboardingGrantMinBalanceWei: DEFAULT_ONBOARDING_GRANT_MIN_BALANCE_WEI,
  onboardingGrantPollIntervalMs: 2000,
  onboardingGrantTimeoutMs: 60000,
  additionalSnapAesWriteOrigins: [],
  unsafeSkipBackupDeterminismCheck: false,
};

/** Whether native COTI grants are enabled. Default: true. */
export function isOnboardingGrantEnabled(): boolean {
  return getPluginConfig().onboardingGrantEnabled !== false;
}

function resolveGrantApiUrl(chainId: number): string | undefined {
  const config = getPluginConfig();
  if (chainId === COTI_TESTNET_CHAIN_ID) {
    return config.grantApiUrlTestnet?.replace(/\/$/, '') || DEFAULT_GRANT_API_URL_TESTNET;
  }
  if (chainId === COTI_MAINNET_CHAIN_ID) {
    return config.grantApiUrlMainnet?.replace(/\/$/, '') || undefined;
  }
  return undefined;
}

/** POST to the configured grant API URL for the request chain (config override or baked-in fallback). */
async function requestGrantNativeCoti(
  request: OnboardingServiceRequest,
): Promise<GrantResult> {
  const grantApiUrl = resolveGrantApiUrl(request.chainId);
  if (!grantApiUrl) return { status: 'skipped' };

  const response = await fetch(grantApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: request.address, chainId: request.chainId }),
  });
  if (!response.ok) return { status: 'skipped' };

  try {
    return (await response.json()) as GrantResult;
  } catch {
    // Treat non-JSON 200s like a failed grant — do not start waiting-for-funds polling.
    return { status: 'skipped' };
  }
}

/**
 * Custom grantNativeCoti when set; otherwise built-in grant when enabled and a URL exists for chainId.
 * Pass chainId so mainnet (no default URL) does not open the grant UI for an instant skip.
 */
export function resolveGrantNativeCoti(chainId?: number):
  | ((request: OnboardingServiceRequest) => Promise<GrantResult>)
  | undefined {
  if (!isOnboardingGrantEnabled()) return undefined;

  const custom = getPluginConfig().onboardingServices?.grantNativeCoti;
  if (custom) return custom;

  if (chainId !== undefined && !resolveGrantApiUrl(chainId)) return undefined;

  return requestGrantNativeCoti;
}

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
  if ('snapEnabled' in config && _config.debug) {
    console.log('[CotiPlugin] snapEnabled:', {
      snapEnabled: config.snapEnabled,
      effective: isSnapEnabled(),
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

/** Whether Snap usage (install, probe, AES key retrieve/save) is allowed for this app. */
export function isSnapEnabled(): boolean {
  return getPluginConfig().snapEnabled !== false;
}
