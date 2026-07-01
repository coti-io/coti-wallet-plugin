import { vi } from 'vitest';

export const encodeUint = vi.fn((value: bigint) => new Uint8Array(16));
export const encodeKey = vi.fn((key: string) => new Uint8Array(16));
export const encrypt = vi.fn(() => ({
  ciphertext: new Uint8Array(16),
  r: new Uint8Array(16),
}));
export const decodeUint = vi.fn(() => 12345n);
export const decryptUint = vi.fn((ct: bigint, key: string) => 100n);
export const decryptUint256 = vi.fn(() => 1000000000000000000n);
export const decryptCtUint256 = vi.fn(() => 1000000000000000000n);
export const decryptString = vi.fn(() => 'ipfs://QmTest123');
export const generateRSAKeyPair = vi.fn();
export const decryptRSA = vi.fn();
export const normalizeAesKey = vi.fn((key: string | null | undefined) => {
  if (!key) throw new Error('AES key is required');
  const trimmed = key.startsWith('0x') ? key.slice(2) : key;
  const lowered = trimmed.toLowerCase();
  if (!/^[0-9a-f]+$/.test(lowered)) {
    throw new Error('Invalid AES key: contains non-hexadecimal characters');
  }
  if (lowered.length !== 32) {
    throw new Error(`Invalid AES key: expected 32 hex characters (128-bit), got ${lowered.length}`);
  }
  return lowered;
});
export const encryptUint = vi.fn(() => 12345n);
export const buildItSignature = vi.fn(() => `0x${'ab'.repeat(64)}00`);
export const buildItUint256WithSigner = vi.fn(async ({
  signMessage,
}: {
  signMessage: (message: Uint8Array) => string | Promise<string>;
}) => ({
  ciphertext: { ciphertextHigh: 123n, ciphertextLow: 456n },
  signature: await signMessage(new Uint8Array([1, 2, 3])),
}));
export const isCtUint256Shape = vi.fn((value: unknown) => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown> & Record<number, unknown>;
  const high = record.high as Record<string, unknown> | undefined;
  const low = record.low as Record<string, unknown> | undefined;
  return Boolean(
    (high?.high !== undefined &&
      high?.low !== undefined &&
      low?.high !== undefined &&
      low?.low !== undefined) ||
      (record.ciphertextHigh !== undefined && record.ciphertextLow !== undefined) ||
      (Array.isArray(value) && value.length === 2),
  );
});
export const isZeroCtUint256 = vi.fn((value: unknown) => {
  const isZero = (v: unknown) => {
    try {
      return BigInt(v as string | number | bigint | boolean) === 0n;
    } catch {
      return false;
    }
  };
  if (isZero(value)) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown> & Record<number, unknown>;
  const highObj = record.high as Record<string, unknown> | undefined;
  const lowObj = record.low as Record<string, unknown> | undefined;
  if (
    highObj?.high !== undefined &&
    highObj?.low !== undefined &&
    lowObj?.high !== undefined &&
    lowObj?.low !== undefined
  ) {
    return isZero(highObj.high) && isZero(highObj.low) && isZero(lowObj.high) && isZero(lowObj.low);
  }
  const flat = Array.isArray(value)
    ? { high: value[0], low: value[1] }
    : { high: record.ciphertextHigh, low: record.ciphertextLow };
  const { high, low } = flat;
  return high !== undefined && low !== undefined && isZero(high) && isZero(low);
});
