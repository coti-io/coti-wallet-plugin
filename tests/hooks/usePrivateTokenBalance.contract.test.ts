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
  class JsonRpcProvider {
    constructor(_url: unknown, _chainId?: unknown) {}
  }
  class Contract {
    balanceOf = h.balanceOf;
    'balanceOf(address)' = h.balanceOf64;
    constructor(_address: unknown, _abi: unknown, _runner: unknown) {}
  }
  return {
    ethers: { BrowserProvider, JsonRpcProvider, Contract, formatUnits: h.formatUnits },
  };
});

vi.mock('../../src/crypto/decryption', () => ({
  decryptCtUint64: vi.fn(),
  decryptCtUint256: vi.fn(),
}));

import { decryptCtUint64, decryptCtUint256 } from '../../src/crypto/decryption';

const USER = '0x1234567890abcdef1234567890abcdef12345678';
const CONTRACT = '0xabcabcabcabcabcabcabcabcabcabcabcabcabca';

describe('usePrivateTokenBalance (contract paths)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getNetwork.mockResolvedValue({ chainId: 7082400n });
    h.getSigner.mockResolvedValue({});
    h.formatUnits.mockImplementation((v: bigint) => `formatted:${v}`);
  });

  afterEach(() => {
    configureCotiPlugin({ defaultNetworkId: undefined });
  });

  it('decrypts a 64-bit balance', async () => {
    h.balanceOf64.mockResolvedValue(12345n);
    (decryptCtUint64 as any).mockReturnValue(100n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, 64, 18);

    expect(bal).toBe('formatted:100');
    expect(decryptCtUint64).toHaveBeenCalled();
  });

  it('returns "0.00" for a zero 64-bit balance', async () => {
    h.balanceOf64.mockResolvedValue(0n);
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, 64, 18);
    expect(bal).toBe('0.00');
  });

  it('throws AES_KEY_MISMATCH when 64-bit decryption fails', async () => {
    h.balanceOf64.mockResolvedValue(12345n);
    (decryptCtUint64 as any).mockReturnValue(null);

    const { result } = renderHook(() => usePrivateTokenBalance());
    await expect(
      result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, 64, 18),
    ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
  });

  it('decrypts a flat ctUint256 balance when nested shape is unavailable', async () => {
    h.balanceOf
      .mockRejectedValueOnce(new Error('Not nested format'))
      .mockResolvedValueOnce({ ciphertextHigh: 5n, ciphertextLow: 6n });
    (decryptCtUint256 as any).mockReturnValue(2500000000000000000n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(
      USER,
      'a'.repeat(64),
      CONTRACT,
      256,
      18,
    );

    expect(bal).toBe('formatted:2500000000000000000');
    expect(decryptCtUint256).toHaveBeenCalled();
  });

  it('decrypts a 256-bit nested ciphertext', async () => {
    h.balanceOf.mockResolvedValue({ high: { high: 1n, low: 2n }, low: { high: 3n, low: 4n } });
    (decryptCtUint256 as any).mockReturnValue(1000000000000000000n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, 256, 18);

    expect(bal).toBe('formatted:1000000000000000000');
    expect(decryptCtUint256).toHaveBeenCalled();
  });

  it('returns "0.00" for an all-zero nested ciphertext', async () => {
    h.balanceOf.mockResolvedValue({ high: { high: 0n, low: 0n }, low: { high: 0n, low: 0n } });
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
  });

  it('falls back to the flat 2-part ABI when the response is not nested', async () => {
    // First (nested) call returns a non-nested shape -> triggers fallback; flat call returns flat shape
    h.balanceOf
      .mockResolvedValueOnce({ notNested: true })
      .mockResolvedValueOnce({ ciphertextHigh: 5n, ciphertextLow: 6n });
    (decryptCtUint256 as any).mockReturnValue(2000000000000000000n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, 256, 18);

    expect(bal).toBe('formatted:2000000000000000000');
    expect(h.balanceOf).toHaveBeenCalledTimes(2);
  });

  it('returns "0.00" for an all-zero flat ciphertext', async () => {
    h.balanceOf
      .mockResolvedValueOnce({ notNested: true })
      .mockResolvedValueOnce({ ciphertextHigh: 0n, ciphertextLow: 0n });
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
  });

  it('throws AES_KEY_MISMATCH when flat decryption fails', async () => {
    h.balanceOf
      .mockResolvedValueOnce({ notNested: true })
      .mockResolvedValueOnce({ ciphertextHigh: 5n, ciphertextLow: 6n });
    (decryptCtUint256 as any).mockReturnValue(null);

    const { result } = renderHook(() => usePrivateTokenBalance());
    await expect(
      result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, 256, 18),
    ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
  });

  it('reads a flat balance via RPC when readChainId is provided', async () => {
    h.balanceOf
      .mockRejectedValueOnce(new Error('Not nested format'))
      .mockResolvedValueOnce({ ciphertextHigh: 0n, ciphertextLow: 0n });
    (window as any).ethereum = undefined;

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(
      USER,
      'a'.repeat(64),
      CONTRACT,
      256,
      18,
      11155111,
    );

    expect(bal).toBe('0.00');
    expect(h.getSigner).not.toHaveBeenCalled();
  });

  it('skips and returns "0.00" when connected to the wrong enforced network', async () => {
    configureCotiPlugin({ defaultNetworkId: '7082400' });
    h.getNetwork.mockResolvedValue({ chainId: 1n });

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, 256, 18);

    expect(bal).toBe('0.00');
    expect(h.getSigner).not.toHaveBeenCalled();
  });

  it('returns "0.00" on an unexpected (non-Coti) error', async () => {
    h.getSigner.mockRejectedValue(new Error('signer unavailable'));
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
  });
});
