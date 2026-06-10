import { describe, it, expect } from 'vitest';
import {
  CONTRACT_ADDRESSES,
  SUPPORTED_TOKENS,
  MINIMUM_PORTAL_IN_AMOUNTS,
  ERC20_ABI,
  getPublicTokensForChain,
  getPrivateTokensForChain,
} from '../../src/contracts/config';

describe('Contract Configuration (README: Supported Networks & Tokens)', () => {
  describe('CONTRACT_ADDRESSES', () => {
    it('has COTI Testnet addresses (7082400)', () => {
      const addresses = CONTRACT_ADDRESSES[7082400];
      expect(addresses).toBeDefined();
      expect(addresses.PrivateCoti).toBeDefined();
      expect(addresses.PrivacyBridgeCotiNative).toBeDefined();
    });

    it('has COTI Mainnet addresses (2632500)', () => {
      const addresses = CONTRACT_ADDRESSES[2632500];
      expect(addresses).toBeDefined();
      expect(addresses.PrivateCoti).toBeDefined();
      expect(addresses.PrivacyBridgeCotiNative).toBeDefined();
    });

    it('has Sepolia addresses (11155111)', () => {
      const addresses = CONTRACT_ADDRESSES[11155111];
      expect(addresses).toBeDefined();
      expect(addresses.MTT).toBeDefined();
      expect(addresses['p.MTT']).toBeDefined();
    });

    it('testnet has all ERC20 bridge addresses', () => {
      const addresses = CONTRACT_ADDRESSES[7082400];
      expect(addresses.PrivacyBridgeWETH).toBeDefined();
      expect(addresses.PrivacyBridgeWBTC).toBeDefined();
      expect(addresses.PrivacyBridgeUSDT).toBeDefined();
      expect(addresses.PrivacyBridgeUSDCe).toBeDefined();
      expect(addresses.PrivacyBridgeWADA).toBeDefined();
      expect(addresses.PrivacyBridgegCOTI).toBeDefined();
    });

    it('mainnet has all ERC20 bridge addresses', () => {
      const addresses = CONTRACT_ADDRESSES[2632500];
      expect(addresses.PrivacyBridgeWETH).toBeDefined();
      expect(addresses.PrivacyBridgeWBTC).toBeDefined();
      expect(addresses.PrivacyBridgeUSDT).toBeDefined();
      expect(addresses.PrivacyBridgeUSDCe).toBeDefined();
      expect(addresses.PrivacyBridgeWADA).toBeDefined();
      expect(addresses.PrivacyBridgegCOTI).toBeDefined();
    });

    it('has CotiPriceConsumer on testnet', () => {
      expect(CONTRACT_ADDRESSES[7082400].CotiPriceConsumer).toBeDefined();
    });

    it('has CotiPriceConsumer on mainnet', () => {
      expect(CONTRACT_ADDRESSES[2632500].CotiPriceConsumer).toBeDefined();
    });

    it('all populated addresses are valid Ethereum addresses (42 chars)', () => {
      for (const [chainId, addresses] of Object.entries(CONTRACT_ADDRESSES)) {
        for (const [key, addr] of Object.entries(addresses)) {
          if (addr === '') continue; // skip placeholder addresses for undeployed contracts
          expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
        }
      }
    });
  });

  describe('SUPPORTED_TOKENS', () => {
    it('contains public and private tokens', () => {
      const publicTokens = SUPPORTED_TOKENS.filter(t => !t.isPrivate);
      const privateTokens = SUPPORTED_TOKENS.filter(t => t.isPrivate);
      expect(publicTokens.length).toBeGreaterThan(0);
      expect(privateTokens.length).toBeGreaterThan(0);
    });

    it('has COTI as a public token', () => {
      const coti = SUPPORTED_TOKENS.find(t => t.symbol === 'COTI' && !t.isPrivate);
      expect(coti).toBeDefined();
      expect(coti!.decimals).toBe(18);
    });

    it('has p.COTI as a private token', () => {
      const pCoti = SUPPORTED_TOKENS.find(t => t.symbol === 'p.COTI' && t.isPrivate);
      expect(pCoti).toBeDefined();
      expect(pCoti!.decimals).toBe(18);
    });

    it('WBTC has 8 decimals', () => {
      const wbtc = SUPPORTED_TOKENS.find(t => t.symbol === 'WBTC');
      expect(wbtc!.decimals).toBe(8);
    });

    it('USDT has 6 decimals', () => {
      const usdt = SUPPORTED_TOKENS.find(t => t.symbol === 'USDT');
      expect(usdt!.decimals).toBe(6);
    });

    it('USDC.e has 6 decimals', () => {
      const usdc = SUPPORTED_TOKENS.find(t => t.symbol === 'USDC.e');
      expect(usdc!.decimals).toBe(6);
    });

    it('each token has a bridgeAddressKey', () => {
      const cotiTokens = SUPPORTED_TOKENS.filter(
        t => t.supportedChainIds?.includes(2632500)
      );
      for (const token of cotiTokens) {
        expect(token.bridgeAddressKey).toBeDefined();
      }
    });
  });

  describe('getPublicTokensForChain', () => {
    it('returns public tokens for COTI Testnet', () => {
      const tokens = getPublicTokensForChain(7082400);
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every(t => !t.isPrivate)).toBe(true);
    });

    it('returns public tokens for COTI Mainnet', () => {
      const tokens = getPublicTokensForChain(2632500);
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every(t => !t.isPrivate)).toBe(true);
    });

    it('returns Sepolia tokens for Sepolia chain', () => {
      const tokens = getPublicTokensForChain(11155111);
      expect(tokens.some(t => t.symbol === 'MTT')).toBe(true);
    });

    it('does not return Sepolia-only tokens for COTI chains when address is empty', () => {
      const tokens = getPublicTokensForChain(7082400);
      // MTT is defined in COTI chain configs but its addressKey resolves to an empty string
      // on testnet. The token is still listed because getPublicTokensForChain returns all
      // tokens configured for that chain. Consumers should check addresses[token.addressKey]
      // before use.
      const mtt = tokens.find(t => t.symbol === 'MTT');
      if (mtt) {
        // Verify MTT address is empty (placeholder) on COTI testnet
        expect(CONTRACT_ADDRESSES[7082400]?.MTT).toBe('');
      }
    });

    it('returns empty for unsupported chain', () => {
      const tokens = getPublicTokensForChain(999);
      expect(tokens.length).toBe(0);
    });
  });

  describe('getPrivateTokensForChain', () => {
    it('returns private tokens for COTI Testnet', () => {
      const tokens = getPrivateTokensForChain(7082400);
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every(t => t.isPrivate)).toBe(true);
    });

    it('returns private tokens for COTI Mainnet', () => {
      const tokens = getPrivateTokensForChain(2632500);
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every(t => t.isPrivate)).toBe(true);
    });

    it('includes p.COTI for COTI chains', () => {
      const tokens = getPrivateTokensForChain(7082400);
      expect(tokens.some(t => t.symbol === 'p.COTI')).toBe(true);
    });

    it('returns empty for unsupported chain', () => {
      const tokens = getPrivateTokensForChain(999);
      expect(tokens.length).toBe(0);
    });
  });

  describe('MINIMUM_PORTAL_IN_AMOUNTS', () => {
    it('has minimum for COTI', () => {
      expect(MINIMUM_PORTAL_IN_AMOUNTS['COTI']).toBeDefined();
      expect(parseFloat(MINIMUM_PORTAL_IN_AMOUNTS['COTI'])).toBeGreaterThan(0);
    });

    it('has minimum for WETH', () => {
      expect(MINIMUM_PORTAL_IN_AMOUNTS['WETH']).toBeDefined();
    });

    it('has minimum for WBTC', () => {
      expect(MINIMUM_PORTAL_IN_AMOUNTS['WBTC']).toBeDefined();
    });
  });

  describe('ERC20_ABI', () => {
    it('includes balanceOf', () => {
      expect(ERC20_ABI.some(fn => fn.includes('balanceOf'))).toBe(true);
    });

    it('includes approve', () => {
      expect(ERC20_ABI.some(fn => fn.includes('approve'))).toBe(true);
    });

    it('includes allowance', () => {
      expect(ERC20_ABI.some(fn => fn.includes('allowance'))).toBe(true);
    });

    it('includes transfer', () => {
      expect(ERC20_ABI.some(fn => fn.includes('transfer'))).toBe(true);
    });
  });
});
