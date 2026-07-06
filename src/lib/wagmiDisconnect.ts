import { disconnect, type Config } from '@wagmi/core';
import type { Connector } from '@wagmi/core';
import { logger } from './logger';

/**
 * Fully tears down the wagmi session so a page refresh does not auto-reconnect.
 * Falls back to clearing persisted storage when connector.disconnect() fails.
 */
export async function forceWagmiSessionClear(
  config: Config,
  connector?: Connector | null,
): Promise<void> {
  try {
    await disconnect(config);
  } catch (err) {
    logger.warn('[forceWagmiSessionClear] disconnect() failed:', err);
  }

  const connectorId = connector?.id;
  if (connectorId && config.storage) {
    try {
      await config.storage.setItem(`${connectorId}.disconnected`, true);
    } catch (err) {
      logger.warn('[forceWagmiSessionClear] failed to set disconnected shim:', err);
    }
  }

  try {
    await config.storage?.removeItem('recentConnectorId');
  } catch {
    /* non-fatal */
  }

  config.setState((state) => ({
    ...state,
    connections: new Map(),
    current: null,
    status: 'disconnected',
  }));

  if (!connector?.getProvider) {
    return;
  }

  try {
    const provider = (await connector.getProvider()) as {
      request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
    await provider?.request?.({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    });
  } catch {
    /* wallet_revokePermissions is optional */
  }
}
