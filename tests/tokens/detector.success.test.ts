import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectTokenType,
  probePrivateVersion256,
  TokenClassification,
} from '../../src/tokens/detector';

const h = vi.hoisted(() => ({
  supportsInterface: vi.fn(),
  decimals: vi.fn(),
  symbol: vi.fn(),
  accountEncryptionAddress: vi.fn(),
  balanceOf: vi.fn(),
  getCode: vi.fn(),
}));

vi.mock('ethers', () => {
  class Contract {
    supportsInterface = h.supportsInterface;
    decimals = h.decimals;
    symbol = h.symbol;
    accountEncryptionAddress = h.accountEncryptionAddress;
    balanceOf = h.balanceOf;
    getFunction = (fn: string) => (h as any)[fn];
    constructor(_address: unknown, _abi: unknown, _provider: unknown) {}
  }
  return {
    ethers: {
      Contract,
      isAddress: (a: unknown) =>
        typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a),
      ZeroAddress: '0x0000000000000000000000000000000000000000',
      id: (s: string) =>
        s === 'transfer(address,((uint256,uint256),bytes))'
          ? '0x25625625' + '0'.repeat(56)
          : s === 'transfer(address,(uint256,bytes))'
            ? '0x64646464' + '0'.repeat(56)
            : '0x' + '0'.repeat(64),
    },
  };
});

const ID_721 = '0x80ac58cd';
const ID_1155 = '0xd9b67a26';
const ID_256 = '0xdfeb393e';
const ID_64 = '0x8409a9cf';

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const provider = { getCode: h.getCode } as any;

/** supportsInterface that returns true only for the listed interface IDs. */
function supportsOnly(...ids: string[]) {
  h.supportsInterface.mockImplementation((id: string) => Promise.resolve(ids.includes(id)));
}

describe('detectTokenType (classification paths)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.supportsInterface.mockResolvedValue(false);
    h.getCode.mockResolvedValue('0x');
    h.decimals.mockResolvedValue(18n);
    h.symbol.mockResolvedValue('TKN');
    h.accountEncryptionAddress.mockRejectedValue(new Error('not confidential'));
    h.balanceOf.mockResolvedValue(0n);
  });

  it('classifies ERC721', async () => {
    supportsOnly(ID_721);
    const r = await detectTokenType(ADDR, provider);
    expect(r).toEqual({ classification: TokenClassification.ERC721, confidential: false });
  });

  it('classifies ERC1155', async () => {
    supportsOnly(ID_1155);
    const r = await detectTokenType(ADDR, provider);
    expect(r).toEqual({ classification: TokenClassification.ERC1155, confidential: false });
  });

  it('classifies confidential ERC20 (256) via ERC165', async () => {
    supportsOnly(ID_256);
    const r = await detectTokenType(ADDR, provider);
    expect(r).toEqual({
      classification: TokenClassification.PrivateERC20_256,
      confidential: true,
      confidentialVersion: 256,
    });
  });

  it('classifies confidential ERC20 (64) via ERC165', async () => {
    supportsOnly(ID_64);
    const r = await detectTokenType(ADDR, provider);
    expect(r).toEqual({
      classification: TokenClassification.PrivateERC20_64,
      confidential: true,
      confidentialVersion: 64,
    });
  });

  it('classifies a standard ERC20', async () => {
    // no interfaces, no bytecode markers, accountEncryptionAddress reverts
    const r = await detectTokenType(ADDR, provider);
    expect(r).toEqual({ classification: TokenClassification.ERC20, confidential: false });
  });

  it('classifies confidential ERC20 (256) via accountEncryptionAddress + probe', async () => {
    h.accountEncryptionAddress.mockResolvedValue('0xenc');
    h.balanceOf.mockResolvedValue({ high: { high: 1n, low: 2n }, low: { high: 3n, low: 4n } });
    const r = await detectTokenType(ADDR, provider);
    expect(r).toEqual({
      classification: TokenClassification.PrivateERC20_256,
      confidential: true,
      confidentialVersion: 256,
    });
  });

  it('classifies confidential ERC20 (64) via accountEncryptionAddress when probe fails', async () => {
    h.accountEncryptionAddress.mockResolvedValue('0xenc');
    h.balanceOf.mockResolvedValue(0n); // not a ctUint256 shape
    const r = await detectTokenType(ADDR, provider);
    expect(r).toEqual({
      classification: TokenClassification.PrivateERC20_64,
      confidential: true,
      confidentialVersion: 64,
    });
  });

  it('returns Unknown when ERC165 reverts and ERC20 calls revert', async () => {
    h.supportsInterface.mockRejectedValue(new Error('no erc165'));
    h.decimals.mockRejectedValue(new Error('no decimals'));
    const r = await detectTokenType(ADDR, provider);
    expect(r).toEqual({ classification: TokenClassification.Unknown, confidential: false });
  });

  it('falls back to bytecode analysis for the 256-bit selector', async () => {
    h.supportsInterface.mockRejectedValue(new Error('no erc165'));
    h.getCode.mockResolvedValue('0x60806040' + '25625625' + 'deadbeef');
    const r = await detectTokenType(ADDR, provider);
    expect(r.confidentialVersion).toBe(256);
  });

  it('falls back to bytecode analysis for the 64-bit selector', async () => {
    h.supportsInterface.mockRejectedValue(new Error('no erc165'));
    h.getCode.mockResolvedValue('0x60806040' + '64646464' + 'deadbeef');
    const r = await detectTokenType(ADDR, provider);
    expect(r.confidentialVersion).toBe(64);
  });
});

describe('probePrivateVersion256 (shape detection)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for a nested ctUint256 shape', async () => {
    h.balanceOf.mockResolvedValue({ high: { high: 1n, low: 2n }, low: { high: 3n, low: 4n } });
    expect(await probePrivateVersion256(ADDR, provider, ADDR)).toBe(true);
  });

  it('returns true for a flat ctUint256 shape', async () => {
    h.balanceOf.mockResolvedValue({ ciphertextHigh: 1n, ciphertextLow: 2n });
    expect(await probePrivateVersion256(ADDR, provider, ADDR)).toBe(true);
  });

  it('returns true for a positional ctUint256 shape', async () => {
    h.balanceOf.mockResolvedValue({ 0: 1n, 1: 2n });
    expect(await probePrivateVersion256(ADDR, provider, ADDR)).toBe(true);
  });

  it('returns false for a non-object balance', async () => {
    h.balanceOf.mockResolvedValue(123n);
    expect(await probePrivateVersion256(ADDR, provider, ADDR)).toBe(false);
  });

  it('returns false for null balance', async () => {
    h.balanceOf.mockResolvedValue(null);
    expect(await probePrivateVersion256(ADDR, provider, ADDR)).toBe(false);
  });

  it('returns false for an object missing the expected keys', async () => {
    h.balanceOf.mockResolvedValue({ foo: 1n });
    expect(await probePrivateVersion256(ADDR, provider, ADDR)).toBe(false);
  });

  it('falls back to ZeroAddress when accountAddress is invalid', async () => {
    h.balanceOf.mockResolvedValue({ ciphertextHigh: 1n, ciphertextLow: 2n });
    const ok = await probePrivateVersion256(ADDR, provider, 'not-an-address');
    expect(ok).toBe(true);
    expect(h.balanceOf).toHaveBeenCalledWith('0x0000000000000000000000000000000000000000');
  });

  it('returns false when balanceOf reverts', async () => {
    h.balanceOf.mockRejectedValue(new Error('revert'));
    expect(await probePrivateVersion256(ADDR, provider, ADDR)).toBe(false);
  });
});

describe('detector timeout handling (fake timers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('detectTokenType returns Unknown when the internal probe times out', async () => {
    // ERC165 call never settles -> the 10s withTimeout fires
    h.supportsInterface.mockImplementation(() => new Promise(() => {}));
    const promise = detectTokenType(ADDR, provider);
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await promise;
    expect(r).toEqual({ classification: TokenClassification.Unknown, confidential: false });
  });

  it('probePrivateVersion256 returns false on timeout', async () => {
    h.balanceOf.mockImplementation(() => new Promise(() => {}));
    const promise = probePrivateVersion256(ADDR, provider, ADDR);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await promise).toBe(false);
  });
});
