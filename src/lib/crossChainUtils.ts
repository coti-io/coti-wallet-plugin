/**
 * Cross-chain bridge utility functions for token amount formatting,
 * parsing, and decimal truncation.
 */

/**
 * Formats a bigint token value into a human-readable decimal string
 * without trailing zeros and without thousands separators.
 *
 * @param value - The bigint token amount in smallest unit (e.g., wei).
 * @param decimals - The number of decimals for the token (0-18).
 * @returns A decimal string representation (e.g., bigint 1500000 with 6 decimals returns "1.5").
 *
 * @example
 * formatTokenAmount(1500000n, 6) // => "1.5"
 * formatTokenAmount(1000000000000000000n, 18) // => "1"
 * formatTokenAmount(0n, 18) // => "0"
 */
export function formatTokenAmount(value: bigint, decimals: number): string {
  if (decimals === 0) {
    return value.toString();
  }

  const divisor = 10n ** BigInt(decimals);
  const integerPart = value / divisor;
  const remainder = value % divisor;

  if (remainder === 0n) {
    return integerPart.toString();
  }

  // Pad remainder to full decimal length
  const decimalStr = remainder.toString().padStart(decimals, '0');

  // Remove trailing zeros
  const trimmed = decimalStr.replace(/0+$/, '');

  return `${integerPart.toString()}.${trimmed}`;
}

/**
 * Parses a non-negative decimal string into a bigint token amount.
 * The string must contain only digits and at most one decimal point.
 *
 * @param value - A non-negative decimal string (e.g., "1.5").
 * @param decimals - The number of decimals for the token (0-18).
 * @returns The corresponding bigint value in smallest unit.
 * @throws Error if the input is empty, negative, or contains invalid characters.
 *
 * @example
 * parseTokenAmount("1.5", 6) // => 1500000n
 * parseTokenAmount("0", 18) // => 0n
 * parseTokenAmount("100", 18) // => 100000000000000000000n
 */
export function parseTokenAmount(value: string, decimals: number): bigint {
  if (value === '') {
    throw new Error('Invalid token amount: input must not be empty');
  }

  if (value.startsWith('-')) {
    throw new Error('Invalid token amount: negative values are not allowed');
  }

  // Validate that the string contains only digits and at most one decimal point
  if (!/^\d+\.?\d*$/.test(value)) {
    throw new Error('Invalid token amount: input must contain only digits and at most one decimal point');
  }

  const [integerPart, decimalPart = ''] = value.split('.');

  if (decimals === 0) {
    if (decimalPart.length > 0) {
      throw new Error('Invalid token amount: decimal places exceed token decimals');
    }
    return BigInt(integerPart);
  }

  if (decimalPart.length > decimals) {
    throw new Error('Invalid token amount: decimal places exceed token decimals');
  }

  // Pad the decimal part to match token decimals
  const paddedDecimal = decimalPart.padEnd(decimals, '0');
  const combined = integerPart + paddedDecimal;

  return BigInt(combined);
}

/**
 * Truncates a numeric string to at most the specified number of decimal places
 * without rounding. If the input has no decimal point, it is returned unchanged.
 *
 * @param value - A numeric string, possibly with a decimal point.
 * @param maxDecimals - Maximum number of decimal places to keep (0-18).
 * @returns The truncated string.
 *
 * @example
 * truncateDecimals("1.123456", 3) // => "1.123"
 * truncateDecimals("1.5", 6) // => "1.5"
 * truncateDecimals("100", 4) // => "100"
 */
export function truncateDecimals(value: string, maxDecimals: number): string {
  if (!value.includes('.')) {
    return value;
  }

  if (maxDecimals === 0) {
    const [integerPart] = value.split('.');
    return integerPart;
  }

  const [integerPart, decimalPart] = value.split('.');

  const truncated = decimalPart.slice(0, maxDecimals);

  if (truncated === '') {
    return integerPart;
  }

  return `${integerPart}.${truncated}`;
}

// ─── Network Management ───────────────────────────────────────────────────────

/**
 * Configuration for a single chain in the cross-chain bridge network.
 */
export interface ChainConfig {
  chainId: number;
  networkName: string;
  rpcUrl: string;
  explorerUrl: string;
  isTestnet: boolean;
}

/**
 * A pair of chains representing a valid cross-chain bridge route.
 */
export interface ChainPair {
  coti: ChainConfig;
  ethereum: ChainConfig;
}

/**
 * Chain pair configurations for testnet and mainnet environments.
 */
export const CHAIN_PAIRS: Record<'testnet' | 'mainnet', ChainPair> = {
  testnet: {
    coti: {
      chainId: 7082400,
      networkName: 'COTI Testnet',
      rpcUrl: 'https://testnet.coti.io/rpc',
      explorerUrl: 'https://testnet.cotiscan.io',
      isTestnet: true,
    },
    ethereum: {
      chainId: 11155111,
      networkName: 'Sepolia',
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
      explorerUrl: 'https://sepolia.etherscan.io',
      isTestnet: true,
    },
  },
  mainnet: {
    coti: {
      chainId: 2632500,
      networkName: 'COTI Mainnet',
      rpcUrl: 'https://mainnet.coti.io/rpc',
      explorerUrl: 'https://mainnet.cotiscan.io',
      isTestnet: false,
    },
    ethereum: {
      chainId: 1,
      networkName: 'Ethereum Mainnet',
      rpcUrl: 'https://eth.llamarpc.com',
      explorerUrl: 'https://etherscan.io',
      isTestnet: false,
    },
  },
};

/**
 * Resolves the current environment ('testnet' or 'mainnet') based on the
 * connected chain ID. Defaults to 'testnet' if no chain ID is provided or
 * the chain ID is not recognized.
 */
function resolveEnvironment(connectedChainId?: number): 'testnet' | 'mainnet' {
  if (connectedChainId === undefined) {
    return 'testnet';
  }

  const mainnetChainIds = [
    CHAIN_PAIRS.mainnet.coti.chainId,
    CHAIN_PAIRS.mainnet.ethereum.chainId,
  ];

  if (mainnetChainIds.includes(connectedChainId)) {
    return 'mainnet';
  }

  return 'testnet';
}

/**
 * Returns the active chain pairs for the current environment.
 * The environment is determined by the connected wallet's chain ID.
 * Defaults to testnet if no chain ID is provided.
 *
 * @param connectedChainId - The currently connected wallet's chain ID.
 * @returns An array containing the ChainPair for the resolved environment.
 *
 * @example
 * getActiveChains(7082400) // => [{ coti: {...testnet}, ethereum: {...sepolia} }]
 * getActiveChains(1) // => [{ coti: {...mainnet}, ethereum: {...ethereum} }]
 * getActiveChains() // => [{ coti: {...testnet}, ethereum: {...sepolia} }]
 */
export function getActiveChains(connectedChainId?: number): ChainPair[] {
  const env = resolveEnvironment(connectedChainId);
  return [CHAIN_PAIRS[env]];
}

/**
 * Checks whether a given chain ID is valid for cross-chain bridge operations
 * in the current environment.
 *
 * @param chainId - The chain ID to validate.
 * @param connectedChainId - The currently connected wallet's chain ID (for environment resolution).
 * @returns `true` if the chain ID belongs to the active environment's chain pair.
 *
 * @example
 * isValidChain(7082400, 7082400) // => true (testnet COTI)
 * isValidChain(1, 7082400) // => false (mainnet chain in testnet env)
 * isValidChain(11155111) // => true (defaults to testnet, Sepolia is valid)
 */
export function isValidChain(chainId: number, connectedChainId?: number): boolean {
  const env = resolveEnvironment(connectedChainId);
  const pair = CHAIN_PAIRS[env];
  return chainId === pair.coti.chainId || chainId === pair.ethereum.chainId;
}

/**
 * Returns the ChainConfig for a given chain ID in the active environment,
 * or `undefined` if the chain ID is not part of the active chain pair.
 *
 * @param chainId - The chain ID to look up.
 * @param connectedChainId - The currently connected wallet's chain ID (for environment resolution).
 * @returns The matching ChainConfig or `undefined`.
 *
 * @example
 * getActiveChainById(7082400) // => { chainId: 7082400, networkName: 'COTI Testnet', ... }
 * getActiveChainById(1, 1) // => { chainId: 1, networkName: 'Ethereum Mainnet', ... }
 * getActiveChainById(999) // => undefined
 */
export function getActiveChainById(chainId: number, connectedChainId?: number): ChainConfig | undefined {
  const env = resolveEnvironment(connectedChainId);
  const pair = CHAIN_PAIRS[env];

  if (chainId === pair.coti.chainId) {
    return pair.coti;
  }

  if (chainId === pair.ethereum.chainId) {
    return pair.ethereum;
  }

  return undefined;
}

/**
 * Returns all active ChainConfig objects for the current environment.
 *
 * @param connectedChainId - The currently connected wallet's chain ID (for environment resolution).
 * @returns An array of ChainConfig objects for the active environment.
 *
 * @example
 * getActiveNetworks(7082400) // => [{ chainId: 7082400, ... }, { chainId: 11155111, ... }]
 * getActiveNetworks(1) // => [{ chainId: 2632500, ... }, { chainId: 1, ... }]
 * getActiveNetworks() // => [{ chainId: 7082400, ... }, { chainId: 11155111, ... }]
 */
export function getActiveNetworks(connectedChainId?: number): ChainConfig[] {
  const env = resolveEnvironment(connectedChainId);
  const pair = CHAIN_PAIRS[env];
  return [pair.coti, pair.ethereum];
}
