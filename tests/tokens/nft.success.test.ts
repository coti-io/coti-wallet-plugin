import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getERC721Metadata,
  verifyERC721Ownership,
  getPrivateTokenURI,
  getPublicTokenURI,
} from '../../src/tokens/nft';
import { decryptString } from '@coti-io/coti-sdk-typescript';

const h = vi.hoisted(() => ({
  name: vi.fn(),
  symbol: vi.fn(),
  ownerOf: vi.fn(),
  tokenURI: vi.fn(),
}));

vi.mock('ethers', () => {
  class Contract {
    name = h.name;
    symbol = h.symbol;
    ownerOf = h.ownerOf;
    tokenURI = h.tokenURI;
    constructor(_address: unknown, _abi: unknown, _provider: unknown) {}
  }
  return { ethers: { Contract } };
});

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const OWNER = '0xAbCdEf0000000000000000000000000000000001';
const KEY = 'a'.repeat(64);
const provider = {} as any;

describe('NFT operations (success paths)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getERC721Metadata', () => {
    it('returns name and symbol', async () => {
      h.name.mockResolvedValue('Cool Cats');
      h.symbol.mockResolvedValue('COOL');
      const r = await getERC721Metadata(ADDR, provider);
      expect(r).toEqual({ name: 'Cool Cats', symbol: 'COOL' });
    });

    it('returns partial metadata when symbol reverts', async () => {
      h.name.mockResolvedValue('Cool Cats');
      h.symbol.mockRejectedValue(new Error('no symbol'));
      const r = await getERC721Metadata(ADDR, provider);
      expect(r).toEqual({ name: 'Cool Cats', symbol: null });
    });

    it('returns null when both name and symbol revert', async () => {
      h.name.mockRejectedValue(new Error('x'));
      h.symbol.mockRejectedValue(new Error('x'));
      const r = await getERC721Metadata(ADDR, provider);
      expect(r).toBeNull();
    });
  });

  describe('verifyERC721Ownership', () => {
    it('returns true when ownerOf matches (case-insensitive)', async () => {
      h.ownerOf.mockResolvedValue(OWNER.toLowerCase());
      const r = await verifyERC721Ownership(ADDR, '7', OWNER, provider);
      expect(r).toBe(true);
      expect(h.ownerOf).toHaveBeenCalledWith(7n);
    });

    it('returns false when ownerOf does not match', async () => {
      h.ownerOf.mockResolvedValue('0x9999999999999999999999999999999999999999');
      const r = await verifyERC721Ownership(ADDR, '7', OWNER, provider);
      expect(r).toBe(false);
    });

    it('returns false when ownerOf reverts (e.g., nonexistent token)', async () => {
      h.ownerOf.mockRejectedValue(new Error('ERC721: invalid token ID'));
      const r = await verifyERC721Ownership(ADDR, '7', OWNER, provider);
      expect(r).toBe(false);
    });
  });

  describe('getPrivateTokenURI', () => {
    it('decrypts and trims the on-chain encrypted URI', async () => {
      h.tokenURI.mockResolvedValue({ value: [1n, 2n] });
      (decryptString as any).mockReturnValue('ipfs://QmTest123\u0000\u0000');
      const r = await getPrivateTokenURI(ADDR, '1', KEY, provider);
      expect(r).toBe('ipfs://QmTest123');
    });

    it('returns null when the decrypted URI is empty', async () => {
      h.tokenURI.mockResolvedValue({ value: [0n] });
      (decryptString as any).mockReturnValue('\u0000  \u0000');
      const r = await getPrivateTokenURI(ADDR, '1', KEY, provider);
      expect(r).toBeNull();
    });

    it('returns null when tokenURI reverts', async () => {
      h.tokenURI.mockRejectedValue(new Error('revert'));
      const r = await getPrivateTokenURI(ADDR, '1', KEY, provider);
      expect(r).toBeNull();
    });
  });

  describe('getPublicTokenURI', () => {
    it('resolves ipfs:// URIs through the gateway', async () => {
      h.tokenURI.mockResolvedValue('ipfs://QmPublic');
      const r = await getPublicTokenURI(ADDR, '1', provider);
      expect(r).toBe('https://ipfs.io/ipfs/QmPublic');
    });

    it('returns http(s) URIs unchanged', async () => {
      h.tokenURI.mockResolvedValue('https://example.com/1.json');
      const r = await getPublicTokenURI(ADDR, '1', provider);
      expect(r).toBe('https://example.com/1.json');
    });

    it('returns null when tokenURI is empty', async () => {
      h.tokenURI.mockResolvedValue('');
      const r = await getPublicTokenURI(ADDR, '1', provider);
      expect(r).toBeNull();
    });
  });

  describe('timeout handling (fake timers)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('getERC721Metadata returns null on timeout', async () => {
      h.name.mockImplementation(() => new Promise(() => {}));
      h.symbol.mockImplementation(() => new Promise(() => {}));
      const promise = getERC721Metadata(ADDR, provider);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await promise).toBeNull();
    });

    it('verifyERC721Ownership returns false on timeout', async () => {
      h.ownerOf.mockImplementation(() => new Promise(() => {}));
      const promise = verifyERC721Ownership(ADDR, '7', OWNER, provider);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await promise).toBe(false);
    });
  });
});
