/**
 * AES key normalization and validation utilities for COTI confidential operations.
 */

import { normalizeAesKey as normalizeSdkAesKey } from '@coti-io/coti-sdk-typescript';

/**
 * Strips "0x" prefix and converts to lowercase.
 * Accepts the canonical 32-char (128-bit) hex string used by COTI crypto.
 *
 * @param aesKey - The AES key string, optionally prefixed with "0x".
 * @returns The normalized lowercase 32-character hex string.
 * @throws Error if the key contains non-hex characters or has incorrect length.
 */
export function normalizeAesKey(aesKey: string): string {
  return normalizeSdkAesKey(aesKey);
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
  return normalizeSdkAesKey(aesKey);
}
