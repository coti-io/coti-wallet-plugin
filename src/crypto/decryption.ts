/**
 * Decryption utilities for COTI confidential token balances.
 *
 * Ported from coti-snap/packages/snap/src/utils/token.ts (decryptBalance)
 * Uses @coti-io/coti-sdk-typescript for the underlying AES decryption.
 */

import { decryptUint, decryptUint256 } from '@coti-io/coti-sdk-typescript';
import type { CtUint64, CtUint256 } from '../types/ciphertext';
import { isCtUint256, isZeroCtUint256 } from '../types/ciphertext';
import { normalizeAesKey } from './aesKey';
import { logger } from '../lib/logger';

/** Options for decryption behavior. */
export interface DecryptionOptions {
  /** Decimal places for formatting (0-18). Default: 18 */
  decimals?: number;
  /** Threshold multiplier for sanity check. Default: 1_000_000_000_000n (1e12) */
  insaneThresholdBase?: bigint;
}

const DEFAULT_INSANE_THRESHOLD_BASE = 1_000_000_000_000n;

/**
 * Normalizes a decimals value to a safe integer in range [0, 36].
 */
function normalizeDecimals(decimals?: number | null): number {
  if (decimals === undefined || decimals === null) {
    return 18;
  }
  if (!Number.isFinite(decimals)) {
    return 18;
  }
  if (decimals < 0) {
    return 0;
  }
  if (decimals > 36) {
    return 36;
  }
  return Math.floor(decimals);
}

/**
 * Sanity check: returns true if the value exceeds plausible bounds.
 * A decrypted value is considered "insane" if it exceeds
 * `thresholdBase * 10^decimals`.
 *
 * @param value - The decrypted bigint value to check.
 * @param decimals - Token decimal places (0-36). Default: 18.
 * @param thresholdBase - Base threshold multiplier. Default: 1e12.
 * @returns True if the value exceeds the sanity threshold.
 */
export function isInsaneDecryptedValue(
  value: bigint,
  decimals?: number,
  thresholdBase?: bigint,
): boolean {
  const safeDecimals = normalizeDecimals(decimals);
  const base = thresholdBase ?? DEFAULT_INSANE_THRESHOLD_BASE;
  const threshold = base * 10n ** BigInt(safeDecimals);
  return value > threshold;
}

/**
 * Checks if a value is zero (bigint, number, or string "0").
 */
function isZeroValue(value: unknown): boolean {
  if (typeof value === 'bigint') {
    return value === 0n;
  }
  if (typeof value === 'number') {
    return value === 0;
  }
  if (typeof value === 'string') {
    return value === '0';
  }
  return false;
}

/**
 * Decrypts a 64-bit ciphertext value.
 * Returns the plaintext bigint, or null if AES key is missing/mismatched
 * or the decrypted value exceeds the sanity threshold.
 *
 * @param ciphertext - The 64-bit ciphertext (a single bigint).
 * @param aesKey - The user's AES key (hex string, with or without 0x prefix).
 * @param options - Optional decryption configuration.
 * @returns The decrypted plaintext bigint, or null on failure.
 */
export function decryptCtUint64(
  ciphertext: CtUint64,
  aesKey: string,
  options?: DecryptionOptions,
): bigint | null {
  try {
    if (isZeroValue(ciphertext)) {
      return 0n;
    }

    const normalizedKey = normalizeAesKey(aesKey);
    const rawDecrypted = decryptUint(ciphertext, normalizedKey);
    const decrypted =
      typeof rawDecrypted === 'bigint' ? rawDecrypted : BigInt(rawDecrypted);

    if (
      isInsaneDecryptedValue(
        decrypted,
        options?.decimals,
        options?.insaneThresholdBase,
      )
    ) {
      return null;
    }

    return decrypted;
  } catch (error) {
    logger.error(
      '[decryptCtUint64] failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Decrypts a 256-bit ciphertext value (four 64-bit segments).
 * Returns the reconstructed 256-bit plaintext bigint, or null on failure.
 *
 * Supports two on-chain representations:
 * - Nested: `{ high: { high, low }, low: { high, low } }`
 * - Flat: `{ ciphertextHigh, ciphertextLow }`
 *
 * @param ciphertext - The 256-bit ciphertext structure.
 * @param aesKey - The user's AES key (hex string, with or without 0x prefix).
 * @param options - Optional decryption configuration.
 * @returns The decrypted 256-bit plaintext bigint, or null on failure.
 */
export function decryptCtUint256(
  ciphertext: CtUint256,
  aesKey: string,
  options?: DecryptionOptions,
): bigint | null {
  try {
    if (isZeroCtUint256(ciphertext)) {
      return 0n;
    }

    const normalizedKey = normalizeAesKey(aesKey);

    // Try nested structure: { high: { high, low }, low: { high, low } }
    const nested = ciphertext as {
      high?: { high?: bigint; low?: bigint };
      low?: { high?: bigint; low?: bigint };
    };

    if (
      nested?.high?.high !== undefined &&
      nested?.high?.low !== undefined &&
      nested?.low?.high !== undefined &&
      nested?.low?.low !== undefined
    ) {
      const d1 = decryptUint(nested.high.high, normalizedKey);
      const d2 = decryptUint(nested.high.low, normalizedKey);
      const d3 = decryptUint(nested.low.high, normalizedKey);
      const d4 = decryptUint(nested.low.low, normalizedKey);
      const decrypted = (d1 << 192n) + (d2 << 128n) + (d3 << 64n) + d4;

      if (
        isInsaneDecryptedValue(
          decrypted,
          options?.decimals,
          options?.insaneThresholdBase,
        )
      ) {
        return null;
      }

      return decrypted;
    }

    // Flat structure: { ciphertextHigh, ciphertextLow }
    const flat = ciphertext as {
      ciphertextHigh?: bigint;
      ciphertextLow?: bigint;
    };

    if (flat.ciphertextHigh !== undefined && flat.ciphertextLow !== undefined) {
      const decrypted = decryptUint256(
        {
          ciphertextHigh:
            typeof flat.ciphertextHigh === 'bigint'
              ? flat.ciphertextHigh
              : BigInt(flat.ciphertextHigh),
          ciphertextLow:
            typeof flat.ciphertextLow === 'bigint'
              ? flat.ciphertextLow
              : BigInt(flat.ciphertextLow),
        },
        normalizedKey,
      );

      if (
        isInsaneDecryptedValue(
          decrypted,
          options?.decimals,
          options?.insaneThresholdBase,
        )
      ) {
        return null;
      }

      return decrypted;
    }

    return null;
  } catch (error) {
    logger.error(
      '[decryptCtUint256] failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Unified decryption entry point that auto-detects the ciphertext variant.
 * If `variant` is not specified, uses `isCtUint256` to determine the type.
 *
 * @param balance - The ciphertext value (64-bit or 256-bit).
 * @param aesKey - The user's AES key (hex string, with or without 0x prefix).
 * @param variant - Explicit variant override (64 or 256). Auto-detected if omitted.
 * @param options - Optional decryption configuration.
 * @returns The decrypted plaintext bigint, or null on failure.
 */
export function decryptBalance(
  balance: CtUint64 | CtUint256,
  aesKey: string,
  variant?: 64 | 256,
  options?: DecryptionOptions,
): bigint | null {
  const resolvedVariant =
    variant ?? (isCtUint256(balance) ? 256 : 64);

  if (resolvedVariant === 256) {
    return decryptCtUint256(balance as CtUint256, aesKey, options);
  }

  return decryptCtUint64(balance as CtUint64, aesKey, options);
}

/**
 * Formats a decrypted bigint into a human-readable decimal string.
 * Divides by 10^decimals and removes trailing zeros.
 *
 * @param value - The decrypted plaintext bigint.
 * @param decimals - The number of decimal places for the token.
 * @returns A formatted decimal string (e.g., "1.5" for value=1500000000000000000n, decimals=18).
 */
export function formatDecryptedBalance(
  value: bigint,
  decimals: number,
): string {
  if (value === 0n) {
    return '0';
  }

  const safeDecimals = normalizeDecimals(decimals);

  if (safeDecimals === 0) {
    return value.toString();
  }

  const divisor = 10n ** BigInt(safeDecimals);
  const integerPart = value / divisor;
  const remainder = value % divisor;

  if (remainder === 0n) {
    return integerPart.toString();
  }

  const remainderStr = remainder.toString().padStart(safeDecimals, '0');
  const trimmed = remainderStr.replace(/0+$/, '');

  return `${integerPart}.${trimmed}`;
}
