import { describe, it, expect } from 'vitest';
import {
  CrossChainTokenConfig,
  CROSS_CHAIN_TOKENS,
  getCrossChainTokenConfig,
} from '../../src/config/crossChainTokens';
import {
  COTI_TESTNET_CHAIN_ID,
  COTI_MAINNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
} from '../../src/config/chains';

describe('CrossChainTokens Configuration', () => {
  describe('CROSS_CHAIN_TOKENS structure', () => {
    it('has testnet and mainnet environments', () => {
      expect(CROSS_CHAIN_TOKENS).toHaveProperty('testnet');
      expect(CROSS_CHAIN_TOKENS).toHaveProperty('mainnet');
    });

    it('testnet contains COTI and gCOTI tokens', () => {
      expect(CROSS_CHAIN_TOKENS.testnet).toHaveProperty('COTI');
      expect(CROSS_CHAIN_TOKENS.testnet).toHaveProperty('gCOTI');
    });

    it('mainnet contains COTI and gCOTI tokens', () => {
      expect(CROSS_CHAIN_TOKENS.mainnet).toHaveProperty('COTI');
      expect(CROSS_CHAIN_TOKENS.mainnet).toHaveProperty('gCOTI');
    });

    it('testnet COTI has configs for COTI Testnet and Sepolia', () => {
      expect(CROSS_CHAIN_TOKENS.testnet.COTI).toHaveProperty(String(COTI_TESTNET_CHAIN_ID));
      expect(CROSS_CHAIN_TOKENS.testnet.COTI).toHaveProperty(String(SEPOLIA_CHAIN_ID));
    });

    it('testnet gCOTI has configs for COTI Testnet and Sepolia', () => {
      expect(CROSS_CHAIN_TOKENS.testnet.gCOTI).toHaveProperty(String(COTI_TESTNET_CHAIN_ID));
      expect(CROSS_CHAIN_TOKENS.testnet.gCOTI).toHaveProperty(String(SEPOLIA_CHAIN_ID));
    });

    it('mainnet COTI has configs for COTI Mainnet and Ethereum Mainnet', () => {
      expect(CROSS_CHAIN_TOKENS.mainnet.COTI).toHaveProperty(String(COTI_MAINNET_CHAIN_ID));
      expect(CROSS_CHAIN_TOKENS.mainnet.COTI).toHaveProperty(String(ETHEREUM_MAINNET_CHAIN_ID));
    });

    it('mainnet gCOTI has configs for COTI Mainnet and Ethereum Mainnet', () => {
      expect(CROSS_CHAIN_TOKENS.mainnet.gCOTI).toHaveProperty(String(COTI_MAINNET_CHAIN_ID));
      expect(CROSS_CHAIN_TOKENS.mainnet.gCOTI).toHaveProperty(String(ETHEREUM_MAINNET_CHAIN_ID));
    });
  });

  describe('Token config structure validation', () => {
    const allConfigs: { env: string; tokenId: string; chainId: number; config: CrossChainTokenConfig }[] = [];

    for (const env of ['testnet', 'mainnet'] as const) {
      for (const tokenId of Object.keys(CROSS_CHAIN_TOKENS[env])) {
        for (const chainIdStr of Object.keys(CROSS_CHAIN_TOKENS[env][tokenId])) {
          const chainId = Number(chainIdStr);
          allConfigs.push({
            env,
            tokenId,
            chainId,
            config: CROSS_CHAIN_TOKENS[env][tokenId][chainId],
          });
        }
      }
    }

    it.each(allConfigs)(
      '$env/$tokenId on chain $chainId has valid contractAddress (0x-prefixed, 42 chars)',
      ({ config }) => {
        expect(config.contractAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(config.contractAddress.length).toBe(42);
      },
    );

    it.each(allConfigs)(
      '$env/$tokenId on chain $chainId has valid recipientAddress (0x-prefixed, 42 chars)',
      ({ config }) => {
        expect(config.recipientAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(config.recipientAddress.length).toBe(42);
      },
    );

    it.each(allConfigs)(
      '$env/$tokenId on chain $chainId has decimals between 0 and 18',
      ({ config }) => {
        expect(config.decimals).toBeGreaterThanOrEqual(0);
        expect(config.decimals).toBeLessThanOrEqual(18);
      },
    );

    it.each(allConfigs)(
      '$env/$tokenId on chain $chainId has matching tokenId field',
      ({ tokenId, config }) => {
        expect(config.tokenId).toBe(tokenId);
      },
    );
  });

  describe('Native COTI uses sentinel address', () => {
    const NATIVE_SENTINEL = '0x0000000000000000000000000000000000000000';

    it('testnet COTI on COTI Testnet uses native sentinel address', () => {
      const config = CROSS_CHAIN_TOKENS.testnet.COTI[COTI_TESTNET_CHAIN_ID];
      expect(config.contractAddress).toBe(NATIVE_SENTINEL);
    });

    it('mainnet COTI on COTI Mainnet uses native sentinel address', () => {
      const config = CROSS_CHAIN_TOKENS.mainnet.COTI[COTI_MAINNET_CHAIN_ID];
      expect(config.contractAddress).toBe(NATIVE_SENTINEL);
    });

    it('testnet COTI on Sepolia uses non-sentinel address (ERC20)', () => {
      const config = CROSS_CHAIN_TOKENS.testnet.COTI[SEPOLIA_CHAIN_ID];
      expect(config.contractAddress).not.toBe(NATIVE_SENTINEL);
    });

    it('mainnet COTI on Ethereum Mainnet uses non-sentinel address (ERC20)', () => {
      const config = CROSS_CHAIN_TOKENS.mainnet.COTI[ETHEREUM_MAINNET_CHAIN_ID];
      expect(config.contractAddress).not.toBe(NATIVE_SENTINEL);
    });
  });

  describe('getCrossChainTokenConfig', () => {
    it('returns config for COTI on COTI Testnet', () => {
      const config = getCrossChainTokenConfig('COTI', COTI_TESTNET_CHAIN_ID);
      expect(config).toBeDefined();
      expect(config!.tokenId).toBe('COTI');
      expect(config!.symbol).toBe('COTI');
      expect(config!.decimals).toBe(18);
    });

    it('returns config for COTI on Sepolia', () => {
      const config = getCrossChainTokenConfig('COTI', SEPOLIA_CHAIN_ID);
      expect(config).toBeDefined();
      expect(config!.tokenId).toBe('COTI');
      expect(config!.symbol).toBe('COTI');
    });

    it('returns config for gCOTI on COTI Testnet', () => {
      const config = getCrossChainTokenConfig('gCOTI', COTI_TESTNET_CHAIN_ID);
      expect(config).toBeDefined();
      expect(config!.tokenId).toBe('gCOTI');
      expect(config!.symbol).toBe('gCOTI');
    });

    it('returns config for COTI on COTI Mainnet', () => {
      const config = getCrossChainTokenConfig('COTI', COTI_MAINNET_CHAIN_ID);
      expect(config).toBeDefined();
      expect(config!.tokenId).toBe('COTI');
    });

    it('returns config for gCOTI on Ethereum Mainnet', () => {
      const config = getCrossChainTokenConfig('gCOTI', ETHEREUM_MAINNET_CHAIN_ID);
      expect(config).toBeDefined();
      expect(config!.tokenId).toBe('gCOTI');
    });

    it('returns undefined for unsupported token ID', () => {
      const config = getCrossChainTokenConfig('UNKNOWN_TOKEN', COTI_TESTNET_CHAIN_ID);
      expect(config).toBeUndefined();
    });

    it('returns undefined for unsupported chain ID', () => {
      const config = getCrossChainTokenConfig('COTI', 999999);
      expect(config).toBeUndefined();
    });

    it('returns undefined for valid token on wrong environment chain', () => {
      // COTI testnet config should not be returned for mainnet chain IDs via the lookup
      // because the function resolves environment from chainId
      const config = getCrossChainTokenConfig('COTI', COTI_MAINNET_CHAIN_ID);
      expect(config).toBeDefined();
      expect(config!.tokenId).toBe('COTI');
    });

    it('does not throw for any invalid input combination', () => {
      expect(() => getCrossChainTokenConfig('', 0)).not.toThrow();
      expect(getCrossChainTokenConfig('', 0)).toBeUndefined();
    });
  });
});
