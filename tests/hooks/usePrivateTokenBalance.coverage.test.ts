import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePrivateTokenBalance } from '../../src/hooks/usePrivateTokenBalance';
import { CotiErrorCode } from '../../src/errors';
import { configureCotiPlugin } from '../../src/config/plugin';

const h = vi.hoisted(() => ({
  getNetwork: vi.fn(),
  getSigner: vi.fn(),
  balanceOf: vi.fn(),
  balanceOf64: vi.fn(),
  formatUnits: vi.fn(),
}));

vi.mock('ethers', () => {
  class BrowserProvider {
    constructor(_provider: unknown) {}
    getNetwork = h.getNetwork;
    getSigner = h.getSigner;
  }
  class Contract {
    balanceOf = h.balanceOf;
    'balanceOf(address)' = h.balanceOf64;
    constructor(_address: unknown, _abi: unknown, _runner: unknown) {}
  }
  return {
    ethers: { BrowserProvider, Contract, formatUnits: h.formatUnits },
  };
});

vi.mock('../../src/crypto/decryption', () => ({
  decryptCtUint64: vi.fn(),
  decryptCtUint256: vi.fn(),
}));

import { decryptCtUint256 } from '../../src/crypto/decryption';

const USER = '0x1234567890abcdef1234567890abcdef12345678';
const CONTRACT = '0xabcabcabcabcabcabcabcabcabcabcabcabcabca';

const dec256 = decryptCtUint256 as any;

describe('usePrivateTokenBalance (ciphertext shape coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getNetwork.mockResolvedValue({ chainId: 7082400n });
    h.getSigner.mockResolvedValue({});
    h.formatUnits.mockImplementation((v: bigint) => `formatted:${v}`);
  });

  afterEach(() => {
    configureCotiPlugin({ defaultNetworkId: undefined });
  });

  it('decrypts a tuple-array flat ciphertext', async () => {
    h.balanceOf.mockResolvedValue([1n, 2n]);
    dec256.mockReturnValue(5000000000000000000n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);

    expect(bal).toBe('formatted:5000000000000000000');
    expect(dec256).toHaveBeenCalledWith(
      { ciphertextHigh: 1n, ciphertextLow: 2n },
      'a'.repeat(32),
      { decimals: 18 },
    );
  });

  it('returns "0.00" for an all-zero flat ciphertext tuple', async () => {
    h.balanceOf.mockResolvedValue([0n, 0n]);
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
    expect(dec256).not.toHaveBeenCalled();
  });

  it('throws AES_KEY_MISMATCH when flat decryption returns null', async () => {
    h.balanceOf.mockResolvedValue({ ciphertextHigh: 1n, ciphertextLow: 2n });
    dec256.mockReturnValue(null);

    const { result } = renderHook(() => usePrivateTokenBalance());
    await expect(
      result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18),
    ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
  });

  it('proceeds when the enforced network matches (defaultNetworkId === chainId)', async () => {
    configureCotiPlugin({ defaultNetworkId: '7082400' });
    h.getNetwork.mockResolvedValue({ chainId: 7082400n });
    h.balanceOf.mockResolvedValue({ ciphertextHigh: 1n, ciphertextLow: 2n });
    dec256.mockReturnValue(42n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);

    expect(bal).toBe('formatted:42');
    expect(h.getSigner).toHaveBeenCalled();
  });

  it('treats a null flat ciphertext response as zero balance', async () => {
    h.balanceOf.mockResolvedValue(null);
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
  });
});
