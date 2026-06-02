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
export const decryptString = vi.fn(() => 'ipfs://QmTest123');
export const generateRSAKeyPair = vi.fn();
export const decryptRSA = vi.fn();
