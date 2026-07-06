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
  const connectorId = connector?.id;
  let disconnectSucceeded = false;

  try {
    await disconnect(config);
    disconnectSucceeded = true;
  } catch (err) {
    logger.warn('[forceWagmiSessionClear] disconnect() failed:', err);
  }

  if (connectorId && config.storage && !disconnectSucceeded) {
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

  // Do not call wallet_revokePermissions — it breaks immediate reconnect without refresh.
}
