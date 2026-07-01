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

  it('decrypts an array-form nested ciphertext (exercises the [0]/[1] index fallbacks)', async () => {
    h.balanceOf.mockResolvedValue([[1n, 2n], [3n, 4n]]);
    dec256.mockReturnValue(5000000000000000000n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);

    expect(bal).toBe('formatted:5000000000000000000');
    expect(dec256).toHaveBeenCalledWith(
      { high: { high: 1n, low: 2n }, low: { high: 3n, low: 4n } },
      'a'.repeat(32),
      { decimals: 18 },
    );
  });

  it('returns "0.00" for an array-form all-zero nested ciphertext', async () => {
    h.balanceOf.mockResolvedValue([[0n, 0n], [0n, 0n]]);
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
    expect(dec256).not.toHaveBeenCalled();
  });

  it('treats a nested ciphertext with a missing low half as zero (low parts undefined)', async () => {
    // hasNestedShape passes via high.high/high.low; .low is absent → lh/ll undefined.
    h.balanceOf.mockResolvedValue({ high: { high: 0n, low: 0n } });
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
  });

  it('normalizes a nested ciphertext with a missing low half via the 0n fallback', async () => {
    // Non-zero high so it is NOT treated as zero, missing .low → normalize uses `?? 0n`.
    h.balanceOf.mockResolvedValue({ high: { high: 1n, low: 2n } });
    dec256.mockReturnValue(7n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);

    expect(bal).toBe('formatted:7');
    expect(dec256).toHaveBeenCalledWith(
      { high: { high: 1n, low: 2n }, low: { high: 0n, low: 0n } },
      'a'.repeat(32),
      { decimals: 18 },
    );
  });

  it('throws AES_KEY_MISMATCH when nested decryption returns null', async () => {
    h.balanceOf.mockResolvedValue({ high: { high: 1n, low: 2n }, low: { high: 3n, low: 4n } });
    dec256.mockReturnValue(null);

    const { result } = renderHook(() => usePrivateTokenBalance());
    await expect(
      result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18),
    ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
  });

  it('returns "0.00" when the flat fallback resolves a falsy balance', async () => {
    // Nested call throws → catch → flat call resolves null → `!encryptedBalance` guard.
    h.balanceOf
      .mockRejectedValueOnce(new Error('no nested ABI'))
      .mockResolvedValueOnce(null);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
    expect(h.balanceOf).toHaveBeenCalledTimes(2);
  });

  it('proceeds when the enforced network matches (defaultNetworkId === chainId)', async () => {
    configureCotiPlugin({ defaultNetworkId: '7082400' });
    h.getNetwork.mockResolvedValue({ chainId: 7082400n });
    h.balanceOf.mockResolvedValue({ high: { high: 1n, low: 2n }, low: { high: 3n, low: 4n } });
    dec256.mockReturnValue(42n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);

    expect(bal).toBe('formatted:42');
    expect(h.getSigner).toHaveBeenCalled();
  });

  it('treats a null nested ciphertext response as zero balance', async () => {
    h.balanceOf.mockResolvedValue(null);
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
  });

  it('treats sparse nested limbs with undefined values as zero', async () => {
    h.balanceOf
      .mockResolvedValueOnce({ high: { high: 0n, low: 0n } })
      .mockResolvedValueOnce(null);
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
  });
});
