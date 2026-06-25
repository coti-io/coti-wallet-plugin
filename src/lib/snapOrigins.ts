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
 * Other origins should skip persist — contract onboarding + session unlock still work.
 */
export function canPersistAesKeyToSnap(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return PUBLISHED_SNAP_AES_WRITE_ORIGINS.has(window.location.origin);
}
