import { describe, it, expect } from 'vitest';
import {
  cotiMainnet,
  cotiTestnet,
  sepolia,
  ethereumMainnet,
  COTI_MAINNET_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  COTI_MAINNET_RPC,
  COTI_TESTNET_RPC,
  ETHEREUM_MAINNET_RPC,
  getRpcUrlForChainId,
} from '../../src/config/chains';

describe('Chain Definitions (README: Supported Networks)', () => {
  describe('Chain IDs', () => {
    it('COTI Mainnet chain ID is 2632500', () => {
      expect(COTI_MAINNET_CHAIN_ID).toBe(2632500);
      expect(cotiMainnet.id).toBe(2632500);
    });

    it('COTI Testnet chain ID is 7082400', () => {
      expect(COTI_TESTNET_CHAIN_ID).toBe(7082400);
      expect(cotiTestnet.id).toBe(7082400);
    });

    it('Sepolia chain ID is 11155111', () => {
      expect(SEPOLIA_CHAIN_ID).toBe(11155111);
      expect(sepolia.id).toBe(11155111);
    });

    it('Ethereum Mainnet chain ID is 1', () => {
      expect(ETHEREUM_MAINNET_CHAIN_ID).toBe(1);
      expect(ethereumMainnet.id).toBe(1);
    });
  });

  describe('RPC URLs', () => {
    it('COTI Mainnet RPC is https://mainnet.coti.io/rpc', () => {
      expect(COTI_MAINNET_RPC).toBe('https://mainnet.coti.io/rpc');
    });

    it('COTI Testnet RPC is https://testnet.coti.io/rpc', () => {
      expect(COTI_TESTNET_RPC).toBe('https://testnet.coti.io/rpc');
    });

    it('Ethereum Mainnet RPC is https://eth.llamarpc.com', () => {
      expect(ETHEREUM_MAINNET_RPC).toBe('https://eth.llamarpc.com');
    });
  });

  describe('Chain Definitions (viem)', () => {
    it('cotiMainnet has correct native currency', () => {
      expect(cotiMainnet.nativeCurrency.symbol).toBe('COTI');
      expect(cotiMainnet.nativeCurrency.decimals).toBe(18);
    });

    it('cotiTestnet has correct native currency', () => {
      expect(cotiTestnet.nativeCurrency.symbol).toBe('COTI');
      expect(cotiTestnet.nativeCurrency.decimals).toBe(18);
    });

    it('ethereumMainnet has correct native currency', () => {
      expect(ethereumMainnet.nativeCurrency.symbol).toBe('ETH');
      expect(ethereumMainnet.nativeCurrency.decimals).toBe(18);
    });

    it('cotiMainnet has correct name', () => {
      expect(cotiMainnet.name).toBe('COTI Mainnet');
    });

    it('cotiTestnet has correct name', () => {
      expect(cotiTestnet.name).toBe('COTI Testnet');
    });

    it('ethereumMainnet has correct name', () => {
      expect(ethereumMainnet.name).toBe('Ethereum Mainnet');
    });
  });

  describe('getRpcUrlForChainId', () => {
    it('returns mainnet RPC for mainnet chain ID', () => {
      expect(getRpcUrlForChainId(2632500)).toBe('https://mainnet.coti.io/rpc');
    });

    it('returns testnet RPC for testnet chain ID', () => {
      expect(getRpcUrlForChainId(7082400)).toBe('https://testnet.coti.io/rpc');
    });

    it('returns Sepolia primary RPC for Sepolia chain ID', () => {
      expect(getRpcUrlForChainId(11155111)).toBe(
        'https://sepolia.infura.io/v3/ed65559ebd384beabfee7a97c266d6bf',
      );
    });

    it('returns Ethereum Mainnet RPC for chain ID 1', () => {
      expect(getRpcUrlForChainId(1)).toBe('https://eth.llamarpc.com');
    });

    it('defaults to testnet RPC for unknown chain IDs', () => {
      expect(getRpcUrlForChainId(999)).toBe('https://testnet.coti.io/rpc');
    });
  });
});
