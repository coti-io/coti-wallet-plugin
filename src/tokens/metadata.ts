/**
 * ERC20 metadata fetching with in-memory caching.
 *
 * Ported from coti-snap/packages/snap/src/utils/token.ts (getERC20Details)
 */

import { ethers } from 'ethers';

/** ERC20 token metadata. */
export interface ERC20Metadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
}

const ERC20_METADATA_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

/** Default timeout for provider calls (10 seconds). */
const METADATA_TIMEOUT_MS = 10_000;

/** In-memory cache keyed by address (lowercase). */
const metadataCache = new Map<string, ERC20Metadata>();

/**
 * Wraps a promise with a timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return Promise.race([
    promise.then((v) => { clearTimeout(timer); return v; }),
    new Promise<T>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Timeout')));
    }),
  ]);
}

/**
 * Fetches ERC20 metadata (name, symbol, decimals) for a token address.
 * Results are cached in memory per address.
 * Returns null if all calls revert (i.e., the contract is not an ERC20).
 *
 * @param address - The token contract address.
 * @param provider - An ethers Provider instance.
 * @returns The ERC20 metadata, or null if the contract is not an ERC20.
 */
export async function getERC20Metadata(
  address: string,
  provider: ethers.Provider,
): Promise<ERC20Metadata | null> {
  const cacheKey = address.toLowerCase();
  const cached = metadataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const result = await withTimeout(
      fetchERC20Metadata(address, provider),
      METADATA_TIMEOUT_MS,
    );

    if (result) {
      metadataCache.set(cacheKey, result);
    }

    return result;
  } catch {
    return null;
  }
}

async function fetchERC20Metadata(
  address: string,
  provider: ethers.Provider,
): Promise<ERC20Metadata | null> {
  const contract = new ethers.Contract(address, ERC20_METADATA_ABI, provider);

  let name: string | null = null;
  let symbol: string | null = null;
  let decimals: number | null = null;

  const results = await Promise.allSettled([
    contract.name(),
    contract.symbol(),
    contract.decimals(),
  ]);

  if (results[0].status === 'fulfilled') {
    name = results[0].value as string;
  }
  if (results[1].status === 'fulfilled') {
    symbol = results[1].value as string;
  }
  if (results[2].status === 'fulfilled') {
    const raw = results[2].value;
    decimals = typeof raw === 'bigint' ? Number(raw) : Number(raw);
  }

  // If all calls failed, the contract is likely not an ERC20
  if (name === null && symbol === null && decimals === null) {
    return null;
  }

  return { name, symbol, decimals };
}
