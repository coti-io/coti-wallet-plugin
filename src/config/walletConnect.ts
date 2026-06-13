import { CotiPluginError, CotiErrorCode } from '../errors';
import { getPluginConfig } from '../config/plugin';

const MISSING_WC_MESSAGE =
  'WalletConnect project ID is required. Pass walletConnectProjectId to WagmiRainbowKitProvider, ' +
  'set configureCotiPlugin({ walletConnectProjectId }), or define VITE_WALLETCONNECT_PROJECT_ID.';

/**
 * Resolves the WalletConnect Cloud project ID from prop, plugin config, or Vite env.
 * @throws {CotiPluginError} when no project ID is configured
 */
export function resolveWalletConnectProjectId(override?: string): string {
  const fromProp = override?.trim();
  if (fromProp) return fromProp;

  const fromPlugin = getPluginConfig().walletConnectProjectId?.trim();
  if (fromPlugin) return fromPlugin;

  const fromEnv = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
  if (fromEnv) return fromEnv;

  throw new CotiPluginError(CotiErrorCode.WALLETCONNECT_PROJECT_ID_MISSING, MISSING_WC_MESSAGE);
}
