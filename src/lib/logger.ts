/**
 * Internal logger for the COTI Wallet Plugin.
 *
 * As a library, this plugin must stay silent by default — it should never write
 * to a consuming application's console unless explicitly opted in. All output is
 * gated behind the `debug` flag in the plugin config (see `configureCotiPlugin`).
 *
 * SECURITY: Never pass secret material (AES keys, plaintext balances, ciphertext,
 * or signatures) to this logger, even at debug level. Log opaque identifiers or
 * lengths instead of raw values.
 */

import { configureCotiPlugin, getPluginConfig } from '../config/plugin';

type LogMethod = (...args: unknown[]) => void;

function isDebugEnabled(): boolean {
  try {
    return getPluginConfig().debug === true;
  } catch {
    return false;
  }
}

export interface Logger {
  log: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
}

export const logger: Logger = {
  log: (...args) => {
    if (isDebugEnabled()) console.log(...args);
  },
  info: (...args) => {
    if (isDebugEnabled()) console.info(...args);
  },
  warn: (...args) => {
    if (isDebugEnabled()) console.warn(...args);
  },
  error: (...args) => {
    if (isDebugEnabled()) console.error(...args);
  },
  debug: (...args) => {
    if (isDebugEnabled()) console.debug(...args);
  },
};

/**
 * Convenience toggle for the plugin's verbose logging.
 * Equivalent to `configureCotiPlugin({ debug: enabled })`.
 */
export function setDebugLogging(enabled: boolean): void {
  configureCotiPlugin({ debug: enabled });
}
