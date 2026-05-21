/**
 * Ciphertext type definitions and type guards for COTI confidential operations.
 *
 * Ported from coti-snap/packages/snap/src/utils/token.ts
 * (isCtUint256Shape, isZeroCtUint256)
 */

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

/** Encrypted input for 64-bit contract calls */
export interface ItUint64 {
  ciphertext: string;
  signature: string;
}

/** Encrypted input for 256-bit contract calls */
export interface ItUint256 {
  ciphertext: {
    high: { high: string; low: string };
    low: { high: string; low: string };
  };
  signature: [[string, string], [string, string]];
}

/**
 * Type guard: checks if a value conforms to the CtUint256 shape.
 *
 * Recognizes three representations:
 * - Nested: { high: { high, low }, low: { high, low } }
 * - Flat: { ciphertextHigh, ciphertextLow }
 * - Positional: { [0], [1] } (ethers.js Result tuples)
 */
export function isCtUint256(value: unknown): value is CtUint256 {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const v = value as Record<string, unknown> & Record<number, unknown>;

  // Check nested structure: { high: { high, low }, low: { high, low } }
  const hasNested =
    v.high !== undefined &&
    v.low !== undefined &&
    typeof v.high === 'object' &&
    v.high !== null &&
    typeof v.low === 'object' &&
    v.low !== null &&
    (v.high as Record<string, unknown>).high !== undefined &&
    (v.high as Record<string, unknown>).low !== undefined &&
    (v.low as Record<string, unknown>).high !== undefined &&
    (v.low as Record<string, unknown>).low !== undefined;

  // Check flat structure: { ciphertextHigh, ciphertextLow }
  const hasFlat =
    v.ciphertextHigh !== undefined && v.ciphertextLow !== undefined;

  // Check positional access: [0], [1] (ethers.js Result tuples)
  const hasPositional = v[0] !== undefined && v[1] !== undefined;

  return hasNested || hasFlat || hasPositional;
}

/**
 * Checks if a value is zero (bigint, number, or string representation).
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
 * Type guard: checks if a CtUint256 value is all zeros.
 *
 * Returns true when:
 * - The value itself is zero (0n, 0, or "0")
 * - All fields in the nested structure are zero
 * - Both fields in the flat/positional structure are zero
 *
 * Returns false for null/undefined values.
 */
export function isZeroCtUint256(value: unknown): boolean {
  if (!value) {
    return false;
  }

  if (isZeroValue(value)) {
    return true;
  }

  const c = value as Record<string, unknown> & Record<number, unknown>;

  // Check nested structure
  const highObj = c.high as Record<string, unknown> | undefined;
  const lowObj = c.low as Record<string, unknown> | undefined;

  if (
    highObj?.high !== undefined &&
    highObj?.low !== undefined &&
    lowObj?.high !== undefined &&
    lowObj?.low !== undefined
  ) {
    return (
      isZeroValue(highObj.high) &&
      isZeroValue(highObj.low) &&
      isZeroValue(lowObj.high) &&
      isZeroValue(lowObj.low)
    );
  }

  // Check flat or positional structure
  const high = c.ciphertextHigh ?? c[0];
  const low = c.ciphertextLow ?? c[1];

  if (high !== undefined && low !== undefined) {
    return isZeroValue(high) && isZeroValue(low);
  }

  return false;
}
