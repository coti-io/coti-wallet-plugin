/** Ciphertext type definitions and SDK-backed type guards. */

import {
  isCtUint256Shape,
  isZeroCtUint256 as isSdkZeroCtUint256,
} from '@coti-io/coti-sdk-typescript';

/** A single 64-bit encrypted value (uint256 containing ciphertext + randomness) */
export type CtUint64 = bigint;

/**
 * A 256-bit encrypted value composed of four 64-bit segments.
 * Supports two on-chain representations:
 * - Flat: { ciphertextHigh, ciphertextLow } (two uint256 values)
 * - Nested: { high: { high, low }, low: { high, low } } (four uint256 values)
 */
export type CtUint256 =
  | { ciphertextHigh: bigint; ciphertextLow: bigint }
  | { high: { high: bigint; low: bigint }; low: { high: bigint; low: bigint } };

/**
 * Type guard: checks if a value conforms to the CtUint256 shape.
 *
 * Recognizes three representations:
 * - Nested: { high: { high, low }, low: { high, low } }
 * - Flat: { ciphertextHigh, ciphertextLow }
 * - Tuple/array: [ciphertextHigh, ciphertextLow] (ethers.js Result tuples)
 */
export function isCtUint256(value: unknown): value is CtUint256 {
  return isCtUint256Shape(value);
}

/**
 * Type guard: checks if a CtUint256 value is all zeros.
 *
 * Returns true when:
 * - The value itself is zero (0n, 0, or "0")
 * - All fields in the nested structure are zero
 * - Both fields in the flat/tuple structure are zero
 *
 * Returns false for null/undefined values.
 */
export function isZeroCtUint256(value: unknown): boolean {
  return isSdkZeroCtUint256(value);
}
