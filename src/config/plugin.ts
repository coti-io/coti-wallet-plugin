/**
 * Plugin configuration — replaces Vite environment variables.
 * Consumers can override these via `configureCotiPlugin()` before using hooks.
 */
export interface CotiPluginConfig {
  /** The Snap ID for the COTI MetaMask Snap. Default: 'npm:@coti-io/coti-snap' */
  snapId: string;
  /** If set, enforces a specific network chain ID (decimal string or hex). */
  defaultNetworkId?: string;
}

let _config: CotiPluginConfig = {
  snapId: 'npm:@coti-io/coti-snap',
  defaultNetworkId: undefined,
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
