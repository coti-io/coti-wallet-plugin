import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
import { CotiErrorCode } from '../../src/errors';
import { COTI_TESTNET_CHAIN_ID } from '../../src/chains/coti';

const ROUND_TRIP_TEST_VALUE = 0x0123456789abcdefn;

const h = vi.hoisted(() => ({
  balanceOf: vi.fn(),
  decryptCtUint256: vi.fn(),
  withRpcFallback: vi.fn(async (_chainId: number, fn: (provider: unknown) => Promise<unknown>) => fn({})),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class Contract {
    balanceOf = h.balanceOf;
  }
  return { ...actual, ethers: { ...actual.ethers, Contract } };
});

vi.mock('../../src/crypto/decryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/crypto/decryption')>();
  return {
    ...actual,
    decryptCtUint256: (...args: unknown[]) => h.decryptCtUint256(...args),
  };
});

vi.mock('../../src/lib/rpcProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/rpcProvider')>();
  return {
    ...actual,
    withRpcFallback: h.withRpcFallback,
  };
});

describe('aesKeyValidation', () => {
  let validateAesKeyRoundTrip: (aesKey: string) => boolean;
  let aesKeysEquivalent: (a: string, b: string) => boolean;
  let assertMetaMaskActiveAccount: (
    provider: { request: (args: { method: string }) => Promise<unknown> },
    expectedAddress: string,
  ) => Promise<void>;

  beforeAll(async () => {
    const mod = await import('../../src/crypto/aesKeyValidation');
    validateAesKeyRoundTrip = mod.validateAesKeyRoundTrip;
    aesKeysEquivalent = mod.aesKeysEquivalent;
    assertMetaMaskActiveAccount = mod.assertMetaMaskActiveAccount;
  });

  beforeEach(() => {
    vi.mocked(CotiSDK.encodeKey).mockImplementation((key: string) => new Uint8Array(16));
    vi.mocked(CotiSDK.encodeUint).mockImplementation(() => new Uint8Array(16));
    vi.mocked(CotiSDK.encrypt).mockReturnValue({
      ciphertext: new Uint8Array(16),
      r: new Uint8Array(16),
    });
    vi.mocked(CotiSDK.decodeUint).mockReturnValue(999n);
    vi.mocked(CotiSDK.decryptUint).mockReturnValue(ROUND_TRIP_TEST_VALUE);
  });

  describe('validateAesKeyRoundTrip', () => {
    it('returns true when SDK round-trip matches the test plaintext', () => {
      const key = '0123456789abcdef0123456789abcdef';
      expect(validateAesKeyRoundTrip(key)).toBe(true);
    });

    it('returns true for a 64-char key using 128-bit SDK material', () => {
      const key32 = '0123456789abcdef0123456789abcdef';
      expect(validateAesKeyRoundTrip(key32 + key32)).toBe(true);
    });

    it('returns false when decrypt output does not match', () => {
      vi.mocked(CotiSDK.decryptUint).mockReturnValue(0n);
      expect(validateAesKeyRoundTrip('0123456789abcdef0123456789abcdef')).toBe(false);
    });

    it('returns false for invalid hex', () => {
      expect(validateAesKeyRoundTrip('not-a-valid-key')).toBe(false);
    });
  });

  describe('aesKeysEquivalent', () => {
    it('matches identical keys', () => {
      const key = 'a'.repeat(32);
      expect(aesKeysEquivalent(key, key)).toBe(true);
    });

    it('matches 64-char key with its 32-char prefix', () => {
      const short = 'a'.repeat(32);
      const long = short + 'b'.repeat(32);
      expect(aesKeysEquivalent(long, short)).toBe(true);
      expect(aesKeysEquivalent(short, long)).toBe(true);
    });

    it('returns false for different keys', () => {
      expect(aesKeysEquivalent('a'.repeat(32), 'b'.repeat(32))).toBe(false);
    });
  });

  describe('assertMetaMaskActiveAccount', () => {
    it('passes when active account matches', async () => {
      const provider = {
        request: vi.fn().mockResolvedValue(['0xAbC']),
      };
      await expect(
        assertMetaMaskActiveAccount(provider, '0xabc'),
      ).resolves.toBeUndefined();
    });

    it('throws AES_KEY_MISMATCH when accounts differ', async () => {
      const provider = {
        request: vi.fn().mockResolvedValue(['0xother']),
      };
      await expect(
        assertMetaMaskActiveAccount(provider, '0xabc'),
      ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
    });
  });

  describe('unlock validation registry', () => {
    let markAesKeyValidatedForUnlock: (address: string, aesKey: string) => void;
    let clearAesKeyValidatedForUnlock: (address?: string) => void;
    let isAesKeyValidatedForUnlock: (address: string, aesKey: string) => boolean;
    let getValidatedAesKeyForUnlock: (address: string) => string | null;

    beforeAll(async () => {
      const mod = await import('../../src/crypto/aesKeyValidation');
      markAesKeyValidatedForUnlock = mod.markAesKeyValidatedForUnlock;
      clearAesKeyValidatedForUnlock = mod.clearAesKeyValidatedForUnlock;
      isAesKeyValidatedForUnlock = mod.isAesKeyValidatedForUnlock;
      getValidatedAesKeyForUnlock = mod.getValidatedAesKeyForUnlock;
    });

    beforeEach(() => {
      clearAesKeyValidatedForUnlock();
    });

    it('tracks validated keys per wallet', () => {
      const key = 'a'.repeat(64);
      expect(isAesKeyValidatedForUnlock('0xAbC', key)).toBe(false);
      markAesKeyValidatedForUnlock('0xabc', key);
      expect(isAesKeyValidatedForUnlock('0xABC', key)).toBe(true);
      expect(getValidatedAesKeyForUnlock('0xABC')).toBe(key.toLowerCase().slice(0, 32));
      clearAesKeyValidatedForUnlock('0xabc');
      expect(isAesKeyValidatedForUnlock('0xabc', key)).toBe(false);
    });
  });

  describe('on-chain ciphertext validation', () => {
    let validateAesKeyAgainstOnChainCiphertext: (
      aesKey: string,
      account: string,
      chainId: number,
    ) => Promise<void>;
    let validateMetaMaskAesKeyOnUnlock: (
      snapKey: string,
      address: string,
      walletProvider: { request: (args: { method: string }) => Promise<unknown> },
      chainId?: number | null,
    ) => Promise<void>;

    beforeAll(async () => {
      const mod = await import('../../src/crypto/aesKeyValidation');
      validateAesKeyAgainstOnChainCiphertext = mod.validateAesKeyAgainstOnChainCiphertext;
      validateMetaMaskAesKeyOnUnlock = mod.validateMetaMaskAesKeyOnUnlock;
    });

    const account = '0x' + '1'.repeat(40);
    const key = 'a'.repeat(32);

    beforeEach(() => {
      h.balanceOf.mockReset();
      h.decryptCtUint256.mockReset();
      h.withRpcFallback.mockClear();
      h.withRpcFallback.mockImplementation(async (_chainId, fn) => fn({}));
    });

    it('no-ops when the chain has no contract addresses', async () => {
      await expect(validateAesKeyAgainstOnChainCiphertext(key, account, 1)).resolves.toBeUndefined();
      expect(h.balanceOf).not.toHaveBeenCalled();
    });

    it('skips a failed balanceOf read and a zero ciphertext', async () => {
      h.balanceOf
        .mockRejectedValueOnce(new Error('revert'))
        .mockResolvedValueOnce({ ciphertextHigh: 0n, ciphertextLow: 0n })
        .mockResolvedValue({ ciphertextHigh: 5n, ciphertextLow: 6n });
      h.decryptCtUint256.mockReturnValue(1n);

      await expect(
        validateAesKeyAgainstOnChainCiphertext(key, account, COTI_TESTNET_CHAIN_ID),
      ).resolves.toBeUndefined();
      expect(h.decryptCtUint256).toHaveBeenCalled();
    });

    it('throws when every non-zero ciphertext fails to decrypt', async () => {
      h.balanceOf.mockResolvedValue({ ciphertextHigh: 9n, ciphertextLow: 8n });
      h.decryptCtUint256.mockReturnValue(null);

      await expect(
        validateAesKeyAgainstOnChainCiphertext(key, account, COTI_TESTNET_CHAIN_ID),
      ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
    });

    it('accepts a tuple-shaped encrypted balance', async () => {
      h.balanceOf.mockResolvedValue([11n, 12n]);
      h.decryptCtUint256.mockReturnValue(1n);

      await expect(
        validateAesKeyAgainstOnChainCiphertext(key, account, COTI_TESTNET_CHAIN_ID),
      ).resolves.toBeUndefined();
    });

    it('rejects a Snap key that fails local round-trip', async () => {
      vi.mocked(CotiSDK.decryptUint).mockReturnValue(0n);
      const provider = { request: vi.fn().mockResolvedValue([account]) };
      await expect(
        validateMetaMaskAesKeyOnUnlock(key, account, provider, COTI_TESTNET_CHAIN_ID),
      ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
    });

    it('validates a Snap key with matching account and on-chain ciphertext', async () => {
      const provider = { request: vi.fn().mockResolvedValue([account]) };
      h.balanceOf.mockResolvedValue({ ciphertextHigh: 1n, ciphertextLow: 2n });
      h.decryptCtUint256.mockReturnValue(1n);

      await expect(
        validateMetaMaskAesKeyOnUnlock(key, account, provider, COTI_TESTNET_CHAIN_ID),
      ).resolves.toBeUndefined();
    });

    it('skips on-chain probe when no chainId is provided', async () => {
      const provider = { request: vi.fn().mockResolvedValue([account]) };
      await expect(validateMetaMaskAesKeyOnUnlock(key, account, provider)).resolves.toBeUndefined();
      expect(h.withRpcFallback).not.toHaveBeenCalled();
    });
  });
});
