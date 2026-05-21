/**
 * AES key normalization and validation utilities for COTI confidential operations.
 *
 * Ported from coti-snap/packages/snap/src/utils/token.ts (normalizeAesKey)
 */

/**
 * Strips "0x" prefix and converts to lowercase.
 * Throws if the result is not a valid 32-character hex string.
 *
 * @param aesKey - The AES key string, optionally prefixed with "0x".
 * @returns The normalized 32-character lowercase hex string.
 * @throws Error if the key contains non-hex characters or has incorrect length.
 */
export function normalizeAesKey(aesKey: string): string {
  const trimmed = aesKey.startsWith('0x') ? aesKey.slice(2) : aesKey;
  const lowered = trimmed.toLowerCase();

  if (!/^[0-9a-f]+$/.test(lowered)) {
    throw new Error(
      'Invalid AES key: contains non-hexadecimal characters',
    );
  }

  if (lowered.length !== 32) {
    throw new Error(
      `Invalid AES key: expected 32 hex characters, got ${lowered.length}`,
    );
  }

  return lowered;
}

/**
 * Validates that a string is a valid AES key (32 hex chars after normalization).
 * Returns the normalized key or throws with a descriptive error.
 *
 * @param aesKey - The AES key to validate. May be null or undefined.
 * @returns The normalized 32-character lowercase hex string.
 * @throws Error if the key is null, undefined, empty, or invalid.
 */
export function validateAesKey(aesKey: string | null | undefined): string {
  if (aesKey === null || aesKey === undefined || aesKey === '') {
    throw new Error('AES key is required');
  }

  return normalizeAesKey(aesKey);
}
