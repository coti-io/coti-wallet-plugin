/**
 * Ciphertext type definitions and type guards.
 *
 * NOTE: isCtUint256Shape and isZeroCtUint256 were added to @coti-io/coti-sdk-typescript
 * in v1.0.8. They are inlined here so the plugin works with older SDK versions
 * installed in consumer apps.
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

/**
 * Type guard: checks if a value conforms to any supported CtUint256 shape.
 *
 * Recognizes three representations:
 * - Nested: { high: { high, low }, low: { high, low } }
 * - Flat: { ciphertextHigh, ciphertextLow }
 * - Tuple/array: [ciphertextHigh, ciphertextLow] (ethers.js Result tuples)
 */
export function isCtUint256(value: unknown): value is CtUint256 {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const arr = value as ArrayLike<unknown>;

  // Nested: { high: { high, low }, low: { high, low } }
  if (
    r.high !== null && typeof r.high === 'object' &&
    r.low !== null && typeof r.low === 'object'
  ) {
    const h = r.high as Record<string, unknown>;
    const l = r.low as Record<string, unknown>;
    if (
      'high' in h && 'low' in h &&
      'high' in l && 'low' in l
    ) return true;
  }

  // Flat: { ciphertextHigh, ciphertextLow }
  if ('ciphertextHigh' in r && 'ciphertextLow' in r) return true;

  // Tuple/array with at least 2 elements
  if (typeof (arr as { length?: unknown }).length === 'number' && (arr as { length: number }).length >= 2) {
    return true;
  }

  return false;
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
  if (value === null || value === undefined) return false;

  const isZero = (v: unknown) => v === 0n || v === 0 || v === '0';

  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') {
    return isZero(value);
  }

  if (typeof value !== 'object') return false;

  const r = value as Record<string, unknown>;
  const arr = value as ArrayLike<unknown>;

  // Nested: { high: { high, low }, low: { high, low } }
  if (
    r.high !== null && typeof r.high === 'object' &&
    r.low !== null && typeof r.low === 'object'
  ) {
    const h = r.high as Record<string, unknown>;
    const l = r.low as Record<string, unknown>;
    if ('high' in h && 'low' in h && 'high' in l && 'low' in l) {
      return isZero(h.high) && isZero(h.low) && isZero(l.high) && isZero(l.low);
    }
  }

  // Flat: { ciphertextHigh, ciphertextLow }
  if ('ciphertextHigh' in r && 'ciphertextLow' in r) {
    return isZero(r.ciphertextHigh) && isZero(r.ciphertextLow);
  }

  // Tuple/array: [ciphertextHigh, ciphertextLow]
  const len = typeof (arr as { length?: unknown }).length === 'number'
    ? (arr as { length: number }).length
    : -1;
  if (len >= 2) {
    return isZero(arr[0]) && isZero(arr[1]);
  }

  return false;
}
