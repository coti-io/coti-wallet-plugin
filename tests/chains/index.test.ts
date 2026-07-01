import { describe, it, expect } from 'vitest';
import {
  CHAIN_CONFIGS,
  DEFAULT_CHAIN_ID,
  getChainConfig,
  requireChainConfig,
  getContractAddresses,
  getTokensForChain,
  getPublicTokensForChain,
  getPrivateTokensForChain,
  getExplorerBaseUrlForChain,
  getRpcUrlForChain,
  getNetworkNameForChain,
  getUnlockStrategyForChain,
  getWalletNetworkConfigs,
  getWalletNetworkOptions,
  getChainIdConstants,
  resolveIndexPageUi,
  getSupportedChainIds,
  isSupportedChain,
  COTI_MAINNET_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  AVALANCHE_FUJI_CHAIN_ID,
  AVALANCHE_C_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  getPodPortalHostChainIds,
  getPodTrackingChainIds,
  cotiMainnet,
  cotiTestnet,
  sepolia,
  COTI_MAINNET_RPC,
  COTI_TESTNET_RPC,
  SEPOLIA_RPC,
} from '../../src/chains/index';

describe('chains/index', () => {
  describe('getChainConfig', () => {
    it('resolves a numeric chain ID', () => {
      expect(getChainConfig(SEPOLIA_CHAIN_ID)?.id).toBe(SEPOLIA_CHAIN_ID);
    });

    it('coerces a string chain ID', () => {
      expect(getChainConfig(String(COTI_TESTNET_CHAIN_ID))?.id).toBe(COTI_TESTNET_CHAIN_ID);
    });

    it('returns undefined for null/undefined', () => {
      expect(getChainConfig(null)).toBeUndefined();
      expect(getChainConfig(undefined)).toBeUndefined();
    });

    it('returns undefined for chain ID 0 (falsy numeric)', () => {
      expect(getChainConfig(0)).toBeUndefined();
    });

    it('returns undefined for unknown chain ID', () => {
      expect(getChainConfig(999999)).toBeUndefined();
    });
  });

  describe('requireChainConfig', () => {
    it('returns the config for a supported chain', () => {
      expect(requireChainConfig(SEPOLIA_CHAIN_ID).id).toBe(SEPOLIA_CHAIN_ID);
    });

    it('throws for an unsupported chain ID', () => {
      expect(() => requireChainConfig(999999)).toThrow('Unsupported chain ID: 999999');
    });
  });

  describe('getSupportedChainIds / isSupportedChain', () => {
    it('lists every chain registered in CHAIN_CONFIGS', () => {
      expect(getSupportedChainIds().sort()).toEqual(
        [
          COTI_MAINNET_CHAIN_ID,
          COTI_TESTNET_CHAIN_ID,
          SEPOLIA_CHAIN_ID,
          AVALANCHE_FUJI_CHAIN_ID,
          ETHEREUM_MAINNET_CHAIN_ID,
          AVALANCHE_C_CHAIN_ID,
        ].sort(),
      );
    });

    it('accepts COTI and Sepolia PoD chains', () => {
      expect(isSupportedChain(COTI_MAINNET_CHAIN_ID)).toBe(true);
      expect(isSupportedChain(COTI_TESTNET_CHAIN_ID)).toBe(true);
      expect(isSupportedChain(SEPOLIA_CHAIN_ID)).toBe(true);
      expect(isSupportedChain(999999)).toBe(false);
    });
  });

  describe('getContractAddresses', () => {
    it('returns addresses for a known chain', () => {
      expect(getContractAddresses(SEPOLIA_CHAIN_ID)).toBeDefined();
    });

    it('returns undefined for an unknown chain', () => {
      expect(getContractAddresses(999999)).toBeUndefined();
    });
  });

  describe('token helpers', () => {
    it('getTokensForChain returns tokens for a known chain', () => {
      expect(getTokensForChain(SEPOLIA_CHAIN_ID).length).toBeGreaterThan(0);
    });

    it('getTokensForChain returns [] for an unknown chain', () => {
      expect(getTokensForChain(999999)).toEqual([]);
    });

    it('getPublicTokensForChain filters out private tokens', () => {
      expect(getPublicTokensForChain(SEPOLIA_CHAIN_ID).every(t => !t.isPrivate)).toBe(true);
    });

    it('getPrivateTokensForChain keeps only private tokens', () => {
      expect(getPrivateTokensForChain(SEPOLIA_CHAIN_ID).every(t => t.isPrivate)).toBe(true);
    });
  });

  describe('explorer / rpc / name / unlock-strategy fallbacks', () => {
    it('getExplorerBaseUrlForChain returns chain value when known', () => {
      expect(getExplorerBaseUrlForChain(SEPOLIA_CHAIN_ID)).toBe('https://eth-sepolia.blockscout.com');
    });

    it('getExplorerBaseUrlForChain falls back to testnet explorer', () => {
      expect(getExplorerBaseUrlForChain(999999)).toBe('https://testnet.cotiscan.io');
    });

    it('getRpcUrlForChain returns chain value when known', () => {
      expect(getRpcUrlForChain(SEPOLIA_CHAIN_ID)).toBe(
        'https://ethereum-sepolia-rpc.publicnode.com',
      );
    });

    it('getRpcUrlForChain falls back to testnet rpc', () => {
      expect(getRpcUrlForChain(999999)).toBe('https://testnet.coti.io/rpc');
    });

    it('getNetworkNameForChain returns chain name when known', () => {
      expect(getNetworkNameForChain(SEPOLIA_CHAIN_ID)).toBe('Sepolia');
    });

    it('getNetworkNameForChain falls back to "Wrong Network"', () => {
      expect(getNetworkNameForChain(999999)).toBe('Wrong Network');
    });

    it('getUnlockStrategyForChain returns chain strategy when known', () => {
      expect(getUnlockStrategyForChain(SEPOLIA_CHAIN_ID)).toBe('manual-aes-key');
    });

    it('getUnlockStrategyForChain falls back to "snap"', () => {
      expect(getUnlockStrategyForChain(999999)).toBe('snap');
    });
  });

  describe('getWalletNetworkConfigs', () => {
    it('keys wallet network configs by hexId for every chain', () => {
      const configs = getWalletNetworkConfigs();
      const hexIds = Object.values(CHAIN_CONFIGS).map(c => c.hexId);
      expect(Object.keys(configs).sort()).toEqual([...hexIds].sort());
      const sepoliaHex = CHAIN_CONFIGS[SEPOLIA_CHAIN_ID].hexId;
      expect(configs[sepoliaHex].chainName).toBe('Sepolia');
    });
  });

  describe('getWalletNetworkOptions', () => {
    it('maps each chain to { id, label }', () => {
      const options = getWalletNetworkOptions();
      expect(options).toHaveLength(Object.keys(CHAIN_CONFIGS).length);
      const sepolia = options.find(o => o.id === CHAIN_CONFIGS[SEPOLIA_CHAIN_ID].hexId);
      expect(sepolia?.label).toBe('Sepolia');
    });
  });

  describe('PoD portal registry helpers', () => {
    it('getPodPortalHostChainIds includes testnet and mainnet portal hosts', () => {
      const hosts = getPodPortalHostChainIds();
      expect(hosts).toContain(SEPOLIA_CHAIN_ID);
      expect(hosts).toContain(ETHEREUM_MAINNET_CHAIN_ID);
      expect(hosts).toContain(AVALANCHE_C_CHAIN_ID);
    });

    it('getPodTrackingChainIds excludes hosts without inbox addresses', () => {
      const tracking = getPodTrackingChainIds();
      expect(tracking).toContain(SEPOLIA_CHAIN_ID);
      expect(tracking).not.toContain(ETHEREUM_MAINNET_CHAIN_ID);
    });
  });

  describe('getChainIdConstants', () => {
    it('returns the hex IDs for the three chains', () => {
      expect(getChainIdConstants()).toEqual({
        COTI_MAINNET_ID: CHAIN_CONFIGS[COTI_MAINNET_CHAIN_ID].hexId,
        COTI_TESTNET_ID: CHAIN_CONFIGS[COTI_TESTNET_CHAIN_ID].hexId,
        SEPOLIA_ID: CHAIN_CONFIGS[SEPOLIA_CHAIN_ID].hexId,
      });
    });
  });

  describe('viem chains derived from CHAIN_CONFIGS', () => {
    it('exports viem chains whose ids and RPC URLs match the registry', () => {
      for (const [chain, rpcConstant] of [
        [cotiMainnet, COTI_MAINNET_RPC],
        [cotiTestnet, COTI_TESTNET_RPC],
        [sepolia, SEPOLIA_RPC],
      ] as const) {
        const cfg = CHAIN_CONFIGS[chain.id];
        expect(cfg).toBeDefined();
        expect(chain.name).toBe(cfg.name);
        expect(chain.nativeCurrency).toEqual(cfg.walletNetwork.nativeCurrency);
        expect(chain.rpcUrls.default.http[0]).toBe(cfg.rpcUrl);
        expect(rpcConstant).toBe(cfg.rpcUrl);
        expect(chain.blockExplorers?.default?.url).toBe(cfg.explorerBaseUrl);
      }
    });
  });

  describe('resolveIndexPageUi', () => {
    it('uses native currency symbol when gas symbol is "native" (Sepolia)', () => {
      const ui = resolveIndexPageUi(SEPOLIA_CHAIN_ID);
      expect(ui.showPodRequestTracker).toBe(true);
      expect(ui.amountModalGasLabel).toBe('Estimated Gas and PoD fee');
      expect(ui.amountModalGasSymbol).toBe('ETH');
    });

    it('uses "COTI" when gas symbol is not "native" (COTI testnet)', () => {
      const ui = resolveIndexPageUi(COTI_TESTNET_CHAIN_ID);
      expect(ui.showPodRequestTracker).toBe(false);
      expect(ui.amountModalGasSymbol).toBe('COTI');
    });

    it('falls back to the default chain config for unknown chain IDs', () => {
      const ui = resolveIndexPageUi(999999);
      const fallback = resolveIndexPageUi(DEFAULT_CHAIN_ID);
      expect(ui).toEqual(fallback);
    });
  });
});
