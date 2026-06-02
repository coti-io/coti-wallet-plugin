import { describe, it, expect } from 'vitest';
import {
  formatTokenAmount,
  parseTokenAmount,
  truncateDecimals,
  CHAIN_PAIRS,
  getActiveChains,
  isValidChain,
  getActiveChainById,
  getActiveNetworks,
} from '../../src/lib/crossChainUtils';

describe('Cross-Chain Token Amount Utilities', () => {
  describe('formatTokenAmount', () => {
    it('formats bigint with 6 decimals removing trailing zeros', () => {
      expect(formatTokenAmount(1500000n, 6)).toBe('1.5');
    });

    it('formats bigint with 18 decimals to whole number', () => {
      expect(formatTokenAmount(1000000000000000000n, 18)).toBe('1');
    });

    it('formats zero correctly', () => {
      expect(formatTokenAmount(0n, 18)).toBe('0');
    });

    it('formats value smaller than one unit', () => {
      expect(formatTokenAmount(500000n, 6)).toBe('0.5');
    });

    it('formats with 0 decimals', () => {
      expect(formatTokenAmount(42n, 0)).toBe('42');
    });

    it('formats large values without thousands separators', () => {
      expect(formatTokenAmount(1000000000000n, 6)).toBe('1000000');
    });

    it('preserves significant decimals', () => {
      expect(formatTokenAmount(1234567n, 6)).toBe('1.234567');
    });

    it('formats value with leading zeros in decimal part', () => {
      expect(formatTokenAmount(1001n, 6)).toBe('0.001001');
    });
  });

  describe('parseTokenAmount', () => {
    it('parses decimal string to bigint', () => {
      expect(parseTokenAmount('1.5', 6)).toBe(1500000n);
    });

    it('parses whole number string', () => {
      expect(parseTokenAmount('100', 18)).toBe(100000000000000000000n);
    });

    it('parses zero', () => {
      expect(parseTokenAmount('0', 18)).toBe(0n);
    });

    it('parses string with fewer decimals than token allows', () => {
      expect(parseTokenAmount('1.5', 18)).toBe(1500000000000000000n);
    });

    it('parses integer with 0 decimals', () => {
      expect(parseTokenAmount('42', 0)).toBe(42n);
    });

    it('throws on empty string', () => {
      expect(() => parseTokenAmount('', 6)).toThrow('input must not be empty');
    });

    it('throws on negative value', () => {
      expect(() => parseTokenAmount('-1.5', 6)).toThrow('negative values are not allowed');
    });

    it('throws on string with non-numeric characters', () => {
      expect(() => parseTokenAmount('1.5abc', 6)).toThrow('only digits and at most one decimal point');
    });

    it('throws on string with multiple decimal points', () => {
      expect(() => parseTokenAmount('1.5.3', 6)).toThrow('only digits and at most one decimal point');
    });

    it('throws when decimal places exceed token decimals', () => {
      expect(() => parseTokenAmount('1.1234567', 6)).toThrow('decimal places exceed token decimals');
    });

    it('throws on decimal input with 0 decimals', () => {
      expect(() => parseTokenAmount('1.5', 0)).toThrow('decimal places exceed token decimals');
    });
  });

  describe('truncateDecimals', () => {
    it('truncates to specified max decimals', () => {
      expect(truncateDecimals('1.123456', 3)).toBe('1.123');
    });

    it('returns unchanged if fewer decimals than max', () => {
      expect(truncateDecimals('1.5', 6)).toBe('1.5');
    });

    it('returns unchanged if no decimal point', () => {
      expect(truncateDecimals('100', 4)).toBe('100');
    });

    it('truncates to 0 decimals removes decimal part', () => {
      expect(truncateDecimals('1.999', 0)).toBe('1');
    });

    it('does not round up', () => {
      expect(truncateDecimals('1.999', 2)).toBe('1.99');
    });

    it('handles empty decimal part after dot', () => {
      expect(truncateDecimals('5.', 3)).toBe('5');
    });
  });

  describe('round-trip property (formatTokenAmount → parseTokenAmount)', () => {
    it('round-trips with 6 decimals', () => {
      const value = 1500000n;
      expect(parseTokenAmount(formatTokenAmount(value, 6), 6)).toBe(value);
    });

    it('round-trips with 18 decimals', () => {
      const value = 1234567890123456789n;
      expect(parseTokenAmount(formatTokenAmount(value, 18), 18)).toBe(value);
    });

    it('round-trips with 0 decimals', () => {
      const value = 42n;
      expect(parseTokenAmount(formatTokenAmount(value, 0), 0)).toBe(value);
    });

    it('round-trips with zero value', () => {
      expect(parseTokenAmount(formatTokenAmount(0n, 18), 18)).toBe(0n);
    });

    it('round-trips with value smaller than one unit', () => {
      const value = 1n;
      expect(parseTokenAmount(formatTokenAmount(value, 18), 18)).toBe(value);
    });
  });
});

describe('Network Management Functions', () => {
  describe('CHAIN_PAIRS', () => {
    it('has testnet and mainnet entries', () => {
      expect(CHAIN_PAIRS.testnet).toBeDefined();
      expect(CHAIN_PAIRS.mainnet).toBeDefined();
    });

    it('testnet pair has correct chain IDs', () => {
      expect(CHAIN_PAIRS.testnet.coti.chainId).toBe(7082400);
      expect(CHAIN_PAIRS.testnet.ethereum.chainId).toBe(11155111);
    });

    it('mainnet pair has correct chain IDs', () => {
      expect(CHAIN_PAIRS.mainnet.coti.chainId).toBe(2632500);
      expect(CHAIN_PAIRS.mainnet.ethereum.chainId).toBe(1);
    });

    it('testnet chains are flagged as testnet', () => {
      expect(CHAIN_PAIRS.testnet.coti.isTestnet).toBe(true);
      expect(CHAIN_PAIRS.testnet.ethereum.isTestnet).toBe(true);
    });

    it('mainnet chains are flagged as not testnet', () => {
      expect(CHAIN_PAIRS.mainnet.coti.isTestnet).toBe(false);
      expect(CHAIN_PAIRS.mainnet.ethereum.isTestnet).toBe(false);
    });
  });

  describe('getActiveChains', () => {
    it('defaults to testnet when no chain ID provided', () => {
      const chains = getActiveChains();
      expect(chains).toHaveLength(1);
      expect(chains[0].coti.chainId).toBe(7082400);
      expect(chains[0].ethereum.chainId).toBe(11155111);
    });

    it('returns testnet pair when connected to COTI Testnet', () => {
      const chains = getActiveChains(7082400);
      expect(chains[0].coti.chainId).toBe(7082400);
      expect(chains[0].ethereum.chainId).toBe(11155111);
    });

    it('returns testnet pair when connected to Sepolia', () => {
      const chains = getActiveChains(11155111);
      expect(chains[0].coti.chainId).toBe(7082400);
      expect(chains[0].ethereum.chainId).toBe(11155111);
    });

    it('returns mainnet pair when connected to COTI Mainnet', () => {
      const chains = getActiveChains(2632500);
      expect(chains[0].coti.chainId).toBe(2632500);
      expect(chains[0].ethereum.chainId).toBe(1);
    });

    it('returns mainnet pair when connected to Ethereum Mainnet', () => {
      const chains = getActiveChains(1);
      expect(chains[0].coti.chainId).toBe(2632500);
      expect(chains[0].ethereum.chainId).toBe(1);
    });

    it('defaults to testnet for unrecognized chain ID', () => {
      const chains = getActiveChains(999);
      expect(chains[0].coti.chainId).toBe(7082400);
    });
  });

  describe('isValidChain', () => {
    it('returns true for COTI Testnet in testnet environment', () => {
      expect(isValidChain(7082400, 7082400)).toBe(true);
    });

    it('returns true for Sepolia in testnet environment', () => {
      expect(isValidChain(11155111, 7082400)).toBe(true);
    });

    it('returns false for mainnet chain in testnet environment', () => {
      expect(isValidChain(1, 7082400)).toBe(false);
    });

    it('returns false for COTI Mainnet in testnet environment', () => {
      expect(isValidChain(2632500, 7082400)).toBe(false);
    });

    it('returns true for COTI Mainnet in mainnet environment', () => {
      expect(isValidChain(2632500, 1)).toBe(true);
    });

    it('returns true for Ethereum Mainnet in mainnet environment', () => {
      expect(isValidChain(1, 2632500)).toBe(true);
    });

    it('returns false for testnet chain in mainnet environment', () => {
      expect(isValidChain(7082400, 1)).toBe(false);
    });

    it('defaults to testnet and validates testnet chains', () => {
      expect(isValidChain(7082400)).toBe(true);
      expect(isValidChain(11155111)).toBe(true);
    });

    it('defaults to testnet and rejects mainnet chains', () => {
      expect(isValidChain(1)).toBe(false);
      expect(isValidChain(2632500)).toBe(false);
    });

    it('returns false for unknown chain IDs', () => {
      expect(isValidChain(999)).toBe(false);
      expect(isValidChain(0)).toBe(false);
    });
  });

  describe('getActiveChainById', () => {
    it('returns COTI Testnet config in testnet environment', () => {
      const config = getActiveChainById(7082400);
      expect(config).toBeDefined();
      expect(config!.chainId).toBe(7082400);
      expect(config!.networkName).toBe('COTI Testnet');
      expect(config!.rpcUrl).toBe('https://testnet.coti.io/rpc');
      expect(config!.explorerUrl).toBe('https://testnet.cotiscan.io');
      expect(config!.isTestnet).toBe(true);
    });

    it('returns Sepolia config in testnet environment', () => {
      const config = getActiveChainById(11155111, 7082400);
      expect(config).toBeDefined();
      expect(config!.chainId).toBe(11155111);
      expect(config!.networkName).toBe('Sepolia');
    });

    it('returns COTI Mainnet config in mainnet environment', () => {
      const config = getActiveChainById(2632500, 1);
      expect(config).toBeDefined();
      expect(config!.chainId).toBe(2632500);
      expect(config!.networkName).toBe('COTI Mainnet');
      expect(config!.isTestnet).toBe(false);
    });

    it('returns Ethereum Mainnet config in mainnet environment', () => {
      const config = getActiveChainById(1, 2632500);
      expect(config).toBeDefined();
      expect(config!.chainId).toBe(1);
      expect(config!.networkName).toBe('Ethereum Mainnet');
    });

    it('returns undefined for chain not in active environment', () => {
      expect(getActiveChainById(1, 7082400)).toBeUndefined();
      expect(getActiveChainById(7082400, 1)).toBeUndefined();
    });

    it('returns undefined for unknown chain ID', () => {
      expect(getActiveChainById(999)).toBeUndefined();
    });
  });

  describe('getActiveNetworks', () => {
    it('returns two networks for testnet environment', () => {
      const networks = getActiveNetworks(7082400);
      expect(networks).toHaveLength(2);
    });

    it('returns COTI and Ethereum configs for testnet', () => {
      const networks = getActiveNetworks();
      const chainIds = networks.map((n) => n.chainId);
      expect(chainIds).toContain(7082400);
      expect(chainIds).toContain(11155111);
    });

    it('returns COTI and Ethereum configs for mainnet', () => {
      const networks = getActiveNetworks(1);
      const chainIds = networks.map((n) => n.chainId);
      expect(chainIds).toContain(2632500);
      expect(chainIds).toContain(1);
    });

    it('defaults to testnet networks when no chain ID provided', () => {
      const networks = getActiveNetworks();
      expect(networks.every((n) => n.isTestnet)).toBe(true);
    });

    it('mainnet networks are all flagged as not testnet', () => {
      const networks = getActiveNetworks(2632500);
      expect(networks.every((n) => !n.isTestnet)).toBe(true);
    });

    it('each network has required fields', () => {
      const networks = getActiveNetworks();
      for (const network of networks) {
        expect(network.chainId).toBeTypeOf('number');
        expect(network.networkName).toBeTypeOf('string');
        expect(network.rpcUrl).toBeTypeOf('string');
        expect(network.explorerUrl).toBeTypeOf('string');
        expect(network.isTestnet).toBeTypeOf('boolean');
      }
    });
  });
});
