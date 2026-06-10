import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFetchPrivateBalance } from '../../src/hooks/useFetchPrivateBalance';
import { CotiErrorCode } from '../../src/errors';
import { configureCotiPlugin } from '../../src/config/plugin';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';

const h = vi.hoisted(() => ({
  getNetwork: vi.fn(),
  balanceOf: vi.fn(),
  formatUnits: vi.fn(),
}));

vi.mock('ethers', () => {
  class BrowserProvider {
    constructor(_provider: unknown) {}
    getNetwork = h.getNetwork;
  }
  class JsonRpcProvider {
    constructor(_url: unknown, _chainId: unknown) {}
  }
  class Contract {
    balanceOf = h.balanceOf;
    constructor(_address: unknown, _abi: unknown, _runner: unknown) {}
  }
  return {
    ethers: { BrowserProvider, JsonRpcProvider, Contract, formatUnits: h.formatUnits },
  };
});

const USER = '0x1234567890abcdef1234567890abcdef12345678';
const CONTRACT = '0xabcabcabcabcabcabcabcabcabcabcabcabcabca';

describe('useFetchPrivateBalance (contract paths)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getNetwork.mockResolvedValue({ chainId: 7082400n });
    h.formatUnits.mockImplementation((v: bigint) => `formatted:${v}`);
    (CotiSDK.decryptUint as any).mockReset();
    (CotiSDK.decryptUint256 as any).mockReset();
    (CotiSDK.decryptUint as any).mockReturnValue(0n);
    (CotiSDK.decryptUint256 as any).mockReturnValue(1000n);
  });

  afterEach(() => {
    configureCotiPlugin({ defaultNetworkId: undefined });
  });

  it('decrypts a nested (4-word) ciphertext', async () => {
    h.balanceOf.mockResolvedValue({ high: { high: 11n, low: 12n }, low: { high: 13n, low: 14n } });
    // high words decrypt to 0, last word small => small final value, below thresholds
    (CotiSDK.decryptUint as any)
      .mockReturnValueOnce(0n)
      .mockReturnValueOnce(0n)
      .mockReturnValueOnce(0n)
      .mockReturnValueOnce(5n);

    const { result } = renderHook(() => useFetchPrivateBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, true, 18);

    expect(bal).toBe('formatted:5');
    expect(CotiSDK.decryptUint).toHaveBeenCalledTimes(4);
  });

  it('falls back to the flat 2-word ABI when the nested call reverts', async () => {
    h.balanceOf
      .mockRejectedValueOnce(new Error('nested revert'))
      .mockResolvedValueOnce({ ciphertextHigh: 7n, ciphertextLow: 8n });
    (CotiSDK.decryptUint256 as any).mockReturnValue(2500n);

    const { result } = renderHook(() => useFetchPrivateBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, true, 18);

    expect(bal).toBe('formatted:2500');
    expect(CotiSDK.decryptUint256).toHaveBeenCalledWith(
      { ciphertextHigh: 7n, ciphertextLow: 8n },
      'a'.repeat(64),
    );
  });

  it('returns "0.00" for an all-zero ciphertext', async () => {
    h.balanceOf.mockResolvedValue({ ciphertextHigh: 0n, ciphertextLow: 0n });
    const { result } = renderHook(() => useFetchPrivateBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, true, 18);
    expect(bal).toBe('0.00');
  });

  it('returns "0.00" on an unexpected (single-word) ciphertext format', async () => {
    h.balanceOf.mockResolvedValue(42n);
    const { result } = renderHook(() => useFetchPrivateBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, true, 18);
    expect(bal).toBe('0.00');
  });

  it('throws AES_KEY_MISMATCH when the decrypted value is astronomically large', async () => {
    h.balanceOf.mockResolvedValue({ high: { high: 11n, low: 12n }, low: { high: 13n, low: 14n } });
    // Large decrypts => final value far above the hard mismatch threshold
    (CotiSDK.decryptUint as any).mockReturnValue(999999999999999999n);

    const { result } = renderHook(() => useFetchPrivateBalance());
    await expect(
      result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, true, 18),
    ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
  });

  it('uses a dedicated read provider (and bypasses the network guard) when readChainId is given', async () => {
    configureCotiPlugin({ defaultNetworkId: '7082400' });
    h.balanceOf.mockResolvedValue({ ciphertextHigh: 7n, ciphertextLow: 8n });
    (CotiSDK.decryptUint256 as any).mockReturnValue(99n);

    const { result } = renderHook(() => useFetchPrivateBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, true, 18, 7082400);

    expect(bal).toBe('formatted:99');
    // readChainId bypasses the network check entirely
    expect(h.getNetwork).not.toHaveBeenCalled();
  });

  it('skips and returns "0.00" when on the wrong enforced network (no readChainId)', async () => {
    configureCotiPlugin({ defaultNetworkId: '7082400' });
    h.getNetwork.mockResolvedValue({ chainId: 1n });

    const { result } = renderHook(() => useFetchPrivateBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, true, 18);

    expect(bal).toBe('0.00');
    expect(h.balanceOf).not.toHaveBeenCalled();
  });

  it('returns "0.00" on a generic contract error (both ABIs revert)', async () => {
    h.balanceOf.mockRejectedValue(new Error('revert'));
    const { result } = renderHook(() => useFetchPrivateBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(64), CONTRACT, true, 18);
    expect(bal).toBe('0.00');
  });
});
