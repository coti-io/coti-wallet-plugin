/**
 * AES key normalization and validation utilities for COTI confidential operations.
 *
 * NOTE: This module is intentionally self-contained and does NOT import
 * normalizeAesKey from @coti-io/coti-sdk-typescript. The SDK is an external peer
 * dependency resolved at runtime from the consumer app's node_modules, and older
 * SDK releases (< 1.0.8) do not export normalizeAesKey. Inlining the logic here
 * removes the version-skew dependency and prevents the runtime crash:
 *   "normalizeSdkAesKey is not a function"
 */

/**
 * Strips "0x" prefix and converts to lowercase.
 * Accepts the canonical 32-char (128-bit) hex string used by COTI crypto.
 *
 * @param aesKey - The AES key string, optionally prefixed with "0x".
 * @returns The normalized lowercase 32-character hex string.
 * @throws Error if the key contains non-hex characters or has incorrect length.
 */
export function normalizeAesKey(aesKey: string | null | undefined): string {
  if (!aesKey) {
    throw new Error('AES key is required');
  }

  const trimmed = aesKey.startsWith('0x') ? aesKey.slice(2) : aesKey;
  const lowered = trimmed.toLowerCase();

  if (!/^[0-9a-f]+$/.test(lowered)) {
    throw new Error('Invalid AES key: contains non-hexadecimal characters');
  }

  if (lowered.length !== 32) {
    throw new Error(
      `Invalid AES key: expected 32 hex characters (128-bit), got ${lowered.length}`,
    );
  }

  return lowered;
}

/**
 * Validates that a string is a valid AES key (32 hex chars after normalization).
 * Returns the normalized key or throws with a descriptive error.
 *
 * @param aesKey - The AES key to validate. May be null or undefined.
 * @returns The normalized lowercase 32-character hex string.
 * @throws Error if the key is null, undefined, empty, or invalid.
 */
export function validateAesKey(aesKey: string | null | undefined): string {
  return normalizeAesKey(aesKey);
}
