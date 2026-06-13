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
}

let _config: CotiPluginConfig = {
  snapId: 'npm:@coti-io/coti-snap',
  defaultNetworkId: undefined,
  debug: false,
  clearSessionKeyOnWagmiDisconnect: false,
};

/**
 * Configure the COTI Wallet Plugin at initialization time.
 * Call this before rendering any hooks.
 */
export function configureCotiPlugin(config: Partial<CotiPluginConfig>): void {
  _config = { ..._config, ...config };
}

/**
 * Returns the current plugin configuration.
 */
export function getPluginConfig(): Readonly<CotiPluginConfig> {
  return _config;
}
