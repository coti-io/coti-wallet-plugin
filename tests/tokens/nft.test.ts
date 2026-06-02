import { describe, it, expect, vi } from 'vitest';
import {
  getERC721Metadata,
  verifyERC721Ownership,
  getPrivateTokenURI,
  getPublicTokenURI,
  resolveIpfsUri,
} from '../../src/tokens/nft';

describe('NFT Operations', () => {
  describe('resolveIpfsUri', () => {
    it('converts ipfs:// URIs to default gateway URL', () => {
      const result = resolveIpfsUri('ipfs://QmTestHash123');
      expect(result).toBe('https://ipfs.io/ipfs/QmTestHash123');
    });

    it('uses custom gateway when provided', () => {
      const result = resolveIpfsUri('ipfs://QmTestHash123', 'https://cloudflare-ipfs.com/ipfs/');
      expect(result).toBe('https://cloudflare-ipfs.com/ipfs/QmTestHash123');
    });

    it('returns http(s) URIs unchanged', () => {
      const httpUri = 'https://example.com/metadata/1.json';
      expect(resolveIpfsUri(httpUri)).toBe(httpUri);
    });

    it('returns non-ipfs URIs unchanged', () => {
      const arUri = 'ar://someArweaveHash';
      expect(resolveIpfsUri(arUri)).toBe(arUri);
    });

    it('handles ipfs:// with path components', () => {
      const result = resolveIpfsUri('ipfs://QmHash/metadata/1.json');
      expect(result).toBe('https://ipfs.io/ipfs/QmHash/metadata/1.json');
    });
  });

  describe('getERC721Metadata', () => {
    it('returns null when provider calls fail', async () => {
      const mockProvider = {} as any;
      const result = await getERC721Metadata('0x0000000000000000000000000000000000000001', mockProvider);
      expect(result).toBeNull();
    });
  });

  describe('verifyERC721Ownership', () => {
    it('returns false on provider error', async () => {
      const mockProvider = {} as any;
      const result = await verifyERC721Ownership(
        '0x0000000000000000000000000000000000000001',
        '1',
        '0xowner',
        mockProvider,
      );
      expect(result).toBe(false);
    });
  });

  describe('getPrivateTokenURI', () => {
    it('returns null on provider error', async () => {
      const mockProvider = {} as any;
      const result = await getPrivateTokenURI(
        '0x0000000000000000000000000000000000000001',
        '1',
        'a'.repeat(64),
        mockProvider,
      );
      expect(result).toBeNull();
    });
  });

  describe('getPublicTokenURI', () => {
    it('returns null on provider error', async () => {
      const mockProvider = {} as any;
      const result = await getPublicTokenURI(
        '0x0000000000000000000000000000000000000001',
        '1',
        mockProvider,
      );
      expect(result).toBeNull();
    });
  });
});
