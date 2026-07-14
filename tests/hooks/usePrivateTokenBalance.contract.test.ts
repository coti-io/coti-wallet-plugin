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
  providerCall: vi.fn(),
  encodeFunctionData: vi.fn(() => '0xencoded'),
  decodeFunctionResult: vi.fn(),
  abiDecode: vi.fn(),
}));

vi.mock('../../src/lib/rpcProvider', () => ({
  withRpcFallback: vi.fn((_chainId: number, fn: (provider: unknown) => Promise<unknown>) =>
    fn({ provider: { call: h.providerCall } })),
}));

vi.mock('ethers', () => {
  class BrowserProvider {
    constructor(_provider: unknown) {}
    getNetwork = h.getNetwork;
    getSigner = h.getSigner;
    call = h.providerCall;
    // ethers v6 providers return themselves from `.provider`
    get provider() { return this; }
  }
  class JsonRpcProvider {
    constructor(_url: unknown, _chainId?: unknown) {}
  }
  class Contract {
    balanceOf = h.balanceOf;
    'balanceOf(address)' = h.balanceOf64;
    constructor(_address: unknown, _abi: unknown, _runner: unknown) {}
  }
  class Interface {
    constructor(_abi: unknown) {}
    encodeFunctionData = h.encodeFunctionData;
    decodeFunctionResult = h.decodeFunctionResult;
  }
  const AbiCoder = { defaultAbiCoder: () => ({ decode: h.abiDecode }) };
  return {
    ethers: { BrowserProvider, JsonRpcProvider, Contract, Interface, AbiCoder, formatUnits: h.formatUnits },
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
    h.getSigner.mockResolvedValue({ provider: { call: h.providerCall } });
    h.formatUnits.mockImplementation((v: bigint) => `formatted:${v}`);
    h.encodeFunctionData.mockReturnValue('0xencoded');
  });

  afterEach(() => {
    configureCotiPlugin({ defaultNetworkId: undefined });
  });

  it('decrypts a 64-bit balance', async () => {
    h.balanceOf64.mockResolvedValue(12345n);
    (decryptCtUint64 as any).mockReturnValue(100n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 64, 18);

    expect(bal).toBe('formatted:100');
    expect(decryptCtUint64).toHaveBeenCalled();
  });

  it('returns "0.00" for a zero 64-bit balance', async () => {
    h.balanceOf64.mockResolvedValue(0n);
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 64, 18);
    expect(bal).toBe('0.00');
  });

  it('throws AES_KEY_MISMATCH when 64-bit decryption fails', async () => {
    h.balanceOf64.mockResolvedValue(12345n);
    (decryptCtUint64 as any).mockReturnValue(null);

    const { result } = renderHook(() => usePrivateTokenBalance());
    await expect(
      result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 64, 18),
    ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
  });

  it('returns a plain uint256 balance for native PoD pTokens (32-byte return)', async () => {
    h.providerCall.mockResolvedValueOnce('0x' + '00'.repeat(32));
    h.decodeFunctionResult.mockReturnValueOnce([2500000000000000000n]);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(
      USER,
      '',
      CONTRACT,
      256,
      18,
      undefined,
      true,
    );

    expect(bal).toBe('formatted:2500000000000000000');
    expect(decryptCtUint256).not.toHaveBeenCalled();
  });

  it('decrypts when a plain-configured token actually returns ctUint256 (64-byte return)', async () => {
    h.providerCall.mockResolvedValueOnce('0x' + '11'.repeat(64));
    h.abiDecode.mockReturnValueOnce([1n, 2n]);
    (decryptCtUint256 as any).mockReturnValue(3000000000000000000n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(
      USER,
      'a'.repeat(32),
      CONTRACT,
      256,
      18,
      undefined,
      true,
    );

    expect(bal).toBe('formatted:3000000000000000000');
    expect(decryptCtUint256).toHaveBeenCalledWith(
      { ciphertextHigh: 1n, ciphertextLow: 2n },
      'a'.repeat(32),
      { decimals: 18 },
    );
  });

  it('returns "0.00" for an encrypted plain-configured token when no AES key is available', async () => {
    h.providerCall.mockResolvedValueOnce('0x' + '11'.repeat(64));

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(
      USER,
      '',
      CONTRACT,
      256,
      18,
      undefined,
      true,
    );

    expect(bal).toBe('0.00');
    expect(decryptCtUint256).not.toHaveBeenCalled();
  });

  it('decrypts a flat ctUint256 balance', async () => {
    h.balanceOf.mockResolvedValue({ ciphertextHigh: 1n, ciphertextLow: 2n });
    (decryptCtUint256 as any).mockReturnValue(1000000000000000000n);

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);

    expect(bal).toBe('formatted:1000000000000000000');
    expect(decryptCtUint256).toHaveBeenCalled();
    expect(h.balanceOf).toHaveBeenCalledTimes(1);
  });

  it('returns "0.00" for an all-zero flat ciphertext', async () => {
    h.balanceOf.mockResolvedValue({ ciphertextHigh: 0n, ciphertextLow: 0n });
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
  });

  it('throws AES_KEY_MISMATCH when flat decryption fails', async () => {
    h.balanceOf.mockResolvedValue({ ciphertextHigh: 5n, ciphertextLow: 6n });
    (decryptCtUint256 as any).mockReturnValue(null);

    const { result } = renderHook(() => usePrivateTokenBalance());
    await expect(
      result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18),
    ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
  });

  it('reads a plain balance via RPC when readChainId is provided', async () => {
    h.providerCall.mockResolvedValueOnce('0x' + '00'.repeat(32));
    h.decodeFunctionResult.mockReturnValueOnce([1000000000000000000n]);
    (window as any).ethereum = undefined;

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(
      USER,
      '',
      CONTRACT,
      256,
      18,
      11155111,
      true,
    );

    expect(bal).toBe('formatted:1000000000000000000');
    expect(h.getSigner).not.toHaveBeenCalled();
  });

  it('skips and returns "0.00" when connected to the wrong enforced network', async () => {
    configureCotiPlugin({ defaultNetworkId: '7082400' });
    h.getNetwork.mockResolvedValue({ chainId: 1n });

    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);

    expect(bal).toBe('0.00');
    expect(h.getSigner).not.toHaveBeenCalled();
  });

  it('returns "0.00" on an unexpected (non-Coti) error', async () => {
    (window as any).ethereum = {};
    h.balanceOf.mockRejectedValue(new Error('provider unavailable'));
    const { result } = renderHook(() => usePrivateTokenBalance());
    const bal = await result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18);
    expect(bal).toBe('0.00');
  });

  it('throws AES_KEY_MISMATCH on Invalid encrypted payload Snap errors', async () => {
    (window as any).ethereum = {};
    const snapError = Object.assign(
      new Error('Invalid encrypted payload. Expected JSON with ciphertext and r byte maps.'),
      { code: -32603 },
    );
    h.balanceOf.mockRejectedValue(snapError);

    const { result } = renderHook(() => usePrivateTokenBalance());
    await expect(
      result.current.fetchPrivateBalance(USER, 'a'.repeat(32), CONTRACT, 256, 18),
    ).rejects.toMatchObject({
      code: CotiErrorCode.AES_KEY_MISMATCH,
      message: expect.stringContaining('Could not decrypt private balances'),
    });
  });

  it('throws AES_KEY_MISMATCH when Snap-side decrypt fails', async () => {
    (window as any).ethereum = {};
    h.balanceOf.mockResolvedValue({ ciphertextHigh: 1n, ciphertextLow: 2n });
    const decryptCtUint256 = vi.fn().mockRejectedValue(
      Object.assign(new Error('MetaMask - RPC Error'), { code: -32603 }),
    );

    const { result } = renderHook(() => usePrivateTokenBalance());
    await expect(
      result.current.fetchPrivateBalance(
        USER,
        '',
        CONTRACT,
        256,
        18,
        undefined,
        false,
        { decryptCtUint256 },
      ),
    ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
  });
});
