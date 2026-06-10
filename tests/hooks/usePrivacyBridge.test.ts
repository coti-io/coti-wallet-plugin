import { describe, it, expect, vi } from 'vitest';

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ connector: undefined, address: undefined, isConnected: false })),
  useConnectorClient: vi.fn(() => ({ data: undefined })),
  useSwitchChain: vi.fn(() => ({ switchChain: vi.fn() })),
}));

import { getInitialPublicTokens, getInitialPrivateTokens } from '../../src/hooks/usePrivacyBridge';

const DEFAULT_CHAIN = 7082400; // COTI Testnet

describe('usePrivacyBridge Token Initialization (README: Privacy Bridge)', () => {
  describe('getInitialPublicTokens', () => {
    it('returns an array of public tokens', () => {
      const tokens = getInitialPublicTokens(DEFAULT_CHAIN);
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('all tokens have isPrivate = false', () => {
      const tokens = getInitialPublicTokens(DEFAULT_CHAIN);
      expect(tokens.every(t => t.isPrivate === false)).toBe(true);
    });

    it('all tokens have balance "0.00"', () => {
      const tokens = getInitialPublicTokens(DEFAULT_CHAIN);
      expect(tokens.every(t => t.balance === '0.00')).toBe(true);
    });

    it('includes COTI token', () => {
      const tokens = getInitialPublicTokens(DEFAULT_CHAIN);
      expect(tokens.some(t => t.symbol === 'COTI')).toBe(true);
    });

    it('includes WETH token', () => {
      const tokens = getInitialPublicTokens(DEFAULT_CHAIN);
      expect(tokens.some(t => t.symbol === 'WETH')).toBe(true);
    });

    it('includes WBTC token', () => {
      const tokens = getInitialPublicTokens(DEFAULT_CHAIN);
      expect(tokens.some(t => t.symbol === 'WBTC')).toBe(true);
    });

    it('includes USDT token', () => {
      const tokens = getInitialPublicTokens(DEFAULT_CHAIN);
      expect(tokens.some(t => t.symbol === 'USDT')).toBe(true);
    });

    it('tokens have symbol, name, and icon', () => {
      const tokens = getInitialPublicTokens(DEFAULT_CHAIN);
      for (const token of tokens) {
        expect(token.symbol).toBeDefined();
        expect(token.name).toBeDefined();
        expect(token.icon).toBeDefined();
      }
    });
  });

  describe('getInitialPrivateTokens', () => {
    it('returns an array of private tokens', () => {
      const tokens = getInitialPrivateTokens(DEFAULT_CHAIN);
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('all tokens have isPrivate = true', () => {
      const tokens = getInitialPrivateTokens(DEFAULT_CHAIN);
      expect(tokens.every(t => t.isPrivate === true)).toBe(true);
    });

    it('all tokens have balance "0.00"', () => {
      const tokens = getInitialPrivateTokens(DEFAULT_CHAIN);
      expect(tokens.every(t => t.balance === '0.00')).toBe(true);
    });

    it('includes p.COTI token', () => {
      const tokens = getInitialPrivateTokens(DEFAULT_CHAIN);
      expect(tokens.some(t => t.symbol === 'p.COTI')).toBe(true);
    });

    it('includes p.WETH token', () => {
      const tokens = getInitialPrivateTokens(DEFAULT_CHAIN);
      expect(tokens.some(t => t.symbol === 'p.WETH')).toBe(true);
    });

    it('private tokens have bridgeAddressKey', () => {
      const tokens = getInitialPrivateTokens(DEFAULT_CHAIN);
      for (const token of tokens) {
        expect(token.bridgeAddressKey).toBeDefined();
      }
    });
  });
});
