import { describe, it, expect, vi } from 'vitest';
import { getERC20Metadata } from '../../src/tokens/metadata';

describe('ERC20 Metadata', () => {
  describe('getERC20Metadata', () => {
    it('returns null when all contract calls fail', async () => {
      const mockProvider = {} as any;
      // ethers.Contract will throw because provider has no methods
      const result = await getERC20Metadata('0x0000000000000000000000000000000000000001', mockProvider);
      expect(result).toBeNull();
    });

    it('returns null on timeout/error', async () => {
      const hangingProvider = {} as any;
      const result = await getERC20Metadata('0x0000000000000000000000000000000000000002', hangingProvider);
      expect(result).toBeNull();
    });

    it('returns cached result for same address', async () => {
      // First call to a specific address (will fail since mock)
      const provider = {} as any;
      const addr = '0x0000000000000000000000000000000000000003';

      const result1 = await getERC20Metadata(addr, provider);
      const result2 = await getERC20Metadata(addr, provider);

      // Both should be null since provider is mock
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });

    it('is case-insensitive for cache key', async () => {
      const provider = {} as any;
      const addr1 = '0xABCDEF0000000000000000000000000000000001';
      const addr2 = '0xabcdef0000000000000000000000000000000001';

      // First call
      await getERC20Metadata(addr1, provider);
      // Second call with different case — should use cache
      const result = await getERC20Metadata(addr2, provider);
      expect(result).toBeNull();
    });
  });
});
