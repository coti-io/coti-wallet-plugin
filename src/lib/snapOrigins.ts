import { getPluginConfig } from '../config/plugin';

/**
 * Origins allowed by published @coti-io/coti-snap to invoke set-aes-key.
 * Must stay in sync with the snap's internal whitelist (security audit).
 */
const PUBLISHED_SNAP_AES_WRITE_ORIGINS = new Set([
  'https://metamask.coti.io',
  'https://dev.metamask.coti.io',
]);

/**
 * Returns true when the current page may call wallet_invokeSnap set-aes-key.
 *
 * Checks both the hard-coded published origins and any additional origins
 * declared via configureCotiPlugin({ additionalSnapAesWriteOrigins }).
 *
 * The Snap manifest's allowedOrigins for set-aes-key must also include any
 * additional origin for the persist to actually succeed — a plugin-only change
 * is not sufficient.
 */
export function canPersistAesKeyToSnap(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const extra = getPluginConfig().additionalSnapAesWriteOrigins ?? [];
  const allowed = extra.length > 0
    ? new Set([...PUBLISHED_SNAP_AES_WRITE_ORIGINS, ...extra])
    : PUBLISHED_SNAP_AES_WRITE_ORIGINS;
  return allowed.has(window.location.origin);
}
