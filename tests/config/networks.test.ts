import { describe, it, expect } from 'vitest';
import { NETWORK_CONFIGS, getNetworkConfig } from '../../src/config/networks';

describe('Network Configuration (README: Supported Networks)', () => {
  it('has COTI Mainnet configuration', () => {
    const config = NETWORK_CONFIGS[2632500];
    expect(config).toBeDefined();
    expect(config.chainId).toBe(2632500);
    expect(config.networkName).toBe('COTI Mainnet');
    expect(config.rpcUrl).toBe('https://mainnet.coti.io/rpc');
    expect(config.isTestnet).toBe(false);
  });

  it('has COTI Testnet configuration', () => {
    const config = NETWORK_CONFIGS[7082400];
    expect(config).toBeDefined();
    expect(config.chainId).toBe(7082400);
    expect(config.networkName).toBe('COTI Testnet');
    expect(config.rpcUrl).toBe('https://testnet.coti.io/rpc');
    expect(config.isTestnet).toBe(true);
  });

  it('has Ethereum Mainnet configuration', () => {
    const config = NETWORK_CONFIGS[1];
    expect(config).toBeDefined();
    expect(config.chainId).toBe(1);
    expect(config.networkName).toBe('Ethereum Mainnet');
    expect(config.rpcUrl).toBe('https://eth.llamarpc.com');
    expect(config.explorerUrl).toBe('https://etherscan.io');
    expect(config.isTestnet).toBe(false);
  });

  it('has Sepolia configuration', () => {
    const config = NETWORK_CONFIGS[11155111];
    expect(config).toBeDefined();
    expect(config.chainId).toBe(11155111);
    expect(config.networkName).toBe('Sepolia');
    expect(config.rpcUrl).toBe('https://ethereum-sepolia-rpc.publicnode.com');
    expect(config.explorerUrl).toBe('https://sepolia.etherscan.io');
    expect(config.isTestnet).toBe(true);
  });

  describe('getNetworkConfig', () => {
    it('returns mainnet config for chain ID 2632500', () => {
      const config = getNetworkConfig(2632500);
      expect(config.networkName).toBe('COTI Mainnet');
    });

    it('returns testnet config for chain ID 7082400', () => {
      const config = getNetworkConfig(7082400);
      expect(config.networkName).toBe('COTI Testnet');
    });

    it('returns Ethereum Mainnet config for chain ID 1', () => {
      const config = getNetworkConfig(1);
      expect(config.networkName).toBe('Ethereum Mainnet');
      expect(config.chainId).toBe(1);
    });

    it('returns Sepolia config for chain ID 11155111', () => {
      const config = getNetworkConfig(11155111);
      expect(config.networkName).toBe('Sepolia');
      expect(config.chainId).toBe(11155111);
    });

    it('throws for unsupported chain ID', () => {
      expect(() => getNetworkConfig(999)).toThrow('Unsupported chain ID: 999');
    });

    it('throws for chain ID 0', () => {
      expect(() => getNetworkConfig(0)).toThrow('Unsupported chain ID: 0');
    });
  });
});
