import { describe, it, expect } from 'vitest';
import { sepoliaChain, SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';

describe('chains/sepolia', () => {
  it('exposes the Sepolia chain ID', () => {
    expect(SEPOLIA_CHAIN_ID).toBe(11155111);
    expect(sepoliaChain.id).toBe(SEPOLIA_CHAIN_ID);
  });

  describe('getBridgeDataOverride', () => {
    it('builds the MTT PoD portal bridge entry from the provided addresses', () => {
      expect(sepoliaChain.getBridgeDataOverride).toBeDefined();
      const result = sepoliaChain.getBridgeDataOverride!(sepoliaChain.addresses);

      expect(result).toHaveLength(1);
      const [bridge] = result;
      expect(bridge.bridgeName).toBe('MTT PoD Portal');
      expect(bridge.bridgeAddress).toBe(sepoliaChain.addresses.PrivacyPortalMTT);
      expect(bridge.publicToken).toBe('MTT');
      expect(bridge.privateToken).toBe('p.MTT');
      expect(bridge.isPaused).toBe(false);
      expect(bridge.isLoading).toBe(false);
      expect(bridge.error).toBeNull();
      expect(bridge.tokenDecimals).toBe(18);
    });

    it('uses whatever PrivacyPortalMTT address is passed in', () => {
      const custom = { ...sepoliaChain.addresses, PrivacyPortalMTT: '0xdeadbeef' };
      const [bridge] = sepoliaChain.getBridgeDataOverride!(custom);
      expect(bridge.bridgeAddress).toBe('0xdeadbeef');
    });
  });
});
