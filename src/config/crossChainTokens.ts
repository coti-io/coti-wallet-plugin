import {
  COTI_TESTNET_CHAIN_ID,
  COTI_MAINNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
} from './chains';

/**
 * Configuration for a token on a specific chain in the cross-chain bridge system.
 */
export interface CrossChainTokenConfig {
  tokenId: string;
  symbol: string;
  name: string;
  contractAddress: `0x${string}`;
  decimals: number;
  recipientAddress: `0x${string}`;
}

/** Sentinel address representing native token (no contract) */
const NATIVE_TOKEN_ADDRESS: `0x${string}` = '0x0000000000000000000000000000000000000000';

/**
 * Cross-chain token configurations keyed by environment, then token ID, then chain ID.
 *
 * Each entry provides the contract address (or native sentinel) and recipient address
 * for bridge operations on that specific chain.
 */
export const CROSS_CHAIN_TOKENS: Record<
  'testnet' | 'mainnet',
  Record<string, Record<number, CrossChainTokenConfig>>
> = {
  testnet: {
    COTI: {
      [COTI_TESTNET_CHAIN_ID]: {
        tokenId: 'COTI',
        symbol: 'COTI',
        name: 'COTI',
        contractAddress: NATIVE_TOKEN_ADDRESS,
        decimals: 18,
        recipientAddress: '0x4A1bCa8eCE15dC25883C3CC066A6C11093A1a70E',
      },
      [SEPOLIA_CHAIN_ID]: {
        tokenId: 'COTI',
        symbol: 'COTI',
        name: 'COTI',
        contractAddress: '0x3A4cB5045297eC32B0B5F08B89e3e3E2E52E9422',
        decimals: 18,
        recipientAddress: '0x7b2dF36EA233b16E428C2e4A744dE54F1c3a6218',
      },
    },
    gCOTI: {
      [COTI_TESTNET_CHAIN_ID]: {
        tokenId: 'gCOTI',
        symbol: 'gCOTI',
        name: 'gCOTI',
        contractAddress: '0x878a42D3cB737DEC9E6c7e7774d973F46fd8ed4C',
        decimals: 18,
        recipientAddress: '0x5E8f2bC901bE3D5E4b8A9c6a2A0fCd23A6c4b7D1',
      },
      [SEPOLIA_CHAIN_ID]: {
        tokenId: 'gCOTI',
        symbol: 'gCOTI',
        name: 'gCOTI',
        contractAddress: '0x6dB3F9A5d9C6cF0E2B7A1c3dE8b5F4D2a6C9E0B7',
        decimals: 18,
        recipientAddress: '0x9C2d4E5f6A8B7c1D3e0F2a4B6C8D0E1F3A5B7C9D',
      },
    },
  },
  mainnet: {
    COTI: {
      [COTI_MAINNET_CHAIN_ID]: {
        tokenId: 'COTI',
        symbol: 'COTI',
        name: 'COTI',
        contractAddress: NATIVE_TOKEN_ADDRESS,
        decimals: 18,
        recipientAddress: '0x2B8f5e3C7D9A1c4E6F0b2D4a8C6e0F2A4B6D8E0C',
      },
      [ETHEREUM_MAINNET_CHAIN_ID]: {
        tokenId: 'COTI',
        symbol: 'COTI',
        name: 'COTI',
        contractAddress: '0x9B3dF5c1E7A2b4D6F8a0C2E4b6D8F0A2C4E6A8B0',
        decimals: 18,
        recipientAddress: '0xA1B2C3D4E5F6a7B8c9D0e1F2a3B4C5D6E7F8A9B0',
      },
    },
    gCOTI: {
      [COTI_MAINNET_CHAIN_ID]: {
        tokenId: 'gCOTI',
        symbol: 'gCOTI',
        name: 'gCOTI',
        contractAddress: '0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1',
        decimals: 18,
        recipientAddress: '0xD4E5F6a7B8C9d0E1f2A3b4C5d6E7f8A9b0C1D2E3',
      },
      [ETHEREUM_MAINNET_CHAIN_ID]: {
        tokenId: 'gCOTI',
        symbol: 'gCOTI',
        name: 'gCOTI',
        contractAddress: '0xE1F2a3B4c5D6e7F8A9b0C1d2E3f4A5B6c7D8E9F0',
        decimals: 18,
        recipientAddress: '0xF1A2b3C4d5E6f7A8B9c0D1e2F3a4B5c6D7e8F9A0',
      },
    },
  },
};

/** Chain IDs belonging to the testnet environment */
const TESTNET_CHAIN_IDS = [COTI_TESTNET_CHAIN_ID, SEPOLIA_CHAIN_ID];

/** Chain IDs belonging to the mainnet environment */
const MAINNET_CHAIN_IDS = [COTI_MAINNET_CHAIN_ID, ETHEREUM_MAINNET_CHAIN_ID];

/**
 * Determines the environment (testnet or mainnet) based on a chain ID.
 * Returns 'testnet' for COTI Testnet and Sepolia, 'mainnet' for COTI Mainnet and Ethereum Mainnet.
 * Returns undefined for unrecognized chain IDs.
 */
function getEnvironmentForChainId(chainId: number): 'testnet' | 'mainnet' | undefined {
  if (TESTNET_CHAIN_IDS.includes(chainId)) return 'testnet';
  if (MAINNET_CHAIN_IDS.includes(chainId)) return 'mainnet';
  return undefined;
}

/**
 * Returns the cross-chain token configuration for a given token ID and chain ID.
 *
 * The function determines the environment (testnet/mainnet) from the chain ID,
 * then looks up the token configuration for that environment and chain.
 *
 * @param tokenId - The token identifier (e.g., 'COTI', 'gCOTI')
 * @param chainId - The chain ID to get the configuration for
 * @returns The token configuration or undefined if the token/chain combination is not supported
 */
export function getCrossChainTokenConfig(
  tokenId: string,
  chainId: number,
): CrossChainTokenConfig | undefined {
  const environment = getEnvironmentForChainId(chainId);
  if (!environment) return undefined;

  return CROSS_CHAIN_TOKENS[environment]?.[tokenId]?.[chainId];
}
