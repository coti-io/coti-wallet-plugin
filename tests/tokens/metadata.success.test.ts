import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getERC20Metadata } from '../../src/tokens/metadata';

const h = vi.hoisted(() => ({
  name: vi.fn(),
  symbol: vi.fn(),
  decimals: vi.fn(),
}));

vi.mock('ethers', () => {
  class Contract {
    name = h.name;
    symbol = h.symbol;
    decimals = h.decimals;
    constructor(_address: unknown, _abi: unknown, _provider: unknown) {}
  }
  return { ethers: { Contract } };
});

const provider = {} as any;

describe('getERC20Metadata (success paths)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.name.mockResolvedValue('Wrapped Ether');
    h.symbol.mockResolvedValue('WETH');
    h.decimals.mockResolvedValue(18n);
  });

  it('returns full metadata and converts bigint decimals to a number', async () => {
    const result = await getERC20Metadata('0x00000000000000000000000000000000000000a1', provider);
    expect(result).toEqual({ name: 'Wrapped Ether', symbol: 'WETH', decimals: 18 });
    expect(typeof result!.decimals).toBe('number');
  });

  it('handles numeric (non-bigint) decimals', async () => {
    h.decimals.mockResolvedValue(6);
    const result = await getERC20Metadata('0x00000000000000000000000000000000000000a2', provider);
    expect(result).toEqual({ name: 'Wrapped Ether', symbol: 'WETH', decimals: 6 });
  });

  it('returns partial metadata when some calls reject (allSettled)', async () => {
    h.symbol.mockRejectedValue(new Error('no symbol'));
    h.decimals.mockRejectedValue(new Error('no decimals'));
    const result = await getERC20Metadata('0x00000000000000000000000000000000000000a3', provider);
    expect(result).toEqual({ name: 'Wrapped Ether', symbol: null, decimals: null });
  });

  it('returns null when every call rejects (not an ERC20)', async () => {
    h.name.mockRejectedValue(new Error('x'));
    h.symbol.mockRejectedValue(new Error('x'));
    h.decimals.mockRejectedValue(new Error('x'));
    const result = await getERC20Metadata('0x00000000000000000000000000000000000000a4', provider);
    expect(result).toBeNull();
  });

  it('caches a successful result per (lowercased) address', async () => {
    const addr = '0x00000000000000000000000000000000000000A5';
    const first = await getERC20Metadata(addr, provider);
    const second = await getERC20Metadata(addr.toLowerCase(), provider);

    expect(first).toEqual(second);
    // Second call served from cache — underlying contract methods not called again
    expect(h.name).toHaveBeenCalledTimes(1);
  });

  describe('timeout', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('returns null when the metadata calls time out', async () => {
      h.name.mockImplementation(() => new Promise(() => {}));
      h.symbol.mockImplementation(() => new Promise(() => {}));
      h.decimals.mockImplementation(() => new Promise(() => {}));

      const promise = getERC20Metadata('0x00000000000000000000000000000000000000b9', provider);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await promise).toBeNull();
    });
  });
});
