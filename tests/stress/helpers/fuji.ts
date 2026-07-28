import { ethers } from 'ethers';
import { AVALANCHE_FUJI_CHAIN_ID, avalancheFujiChain } from '../../../src/chains/avalancheFuji';

export const FUJI_CHAIN_ID = AVALANCHE_FUJI_CHAIN_ID;

/** Every endpoint the plugin is configured to use, primary first. */
export const FUJI_URLS = [
  avalancheFujiChain.rpcUrl,
  ...(avalancheFujiChain.rpcFallbackUrls ?? []),
];

/**
 * A funded Fuji account with a non-zero MTT balance, used purely as a read
 * target. Reads only — no key material is needed and nothing is signed.
 */
export const READ_ACCOUNT = '0xAb81c57CCc578a5636BFF47B896BEC6Af1c30012';

export const FUJI_TOKENS = {
  MTT: avalancheFujiChain.addresses.MTT,
  USDC: avalancheFujiChain.addresses.USDC,
  WAVAX: avalancheFujiChain.addresses.WAVAX,
} as const;

/** Private (PoD) pToken — `balanceOf` returns a flat ctUint256, never plaintext. */
export const FUJI_PRIVATE_MTT = avalancheFujiChain.addresses['p.MTT'];

export const ERC20_BALANCE_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

export const CT_BALANCE_ABI = [
  'function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))',
];

export const ORACLE_ABI = ['function getLivePrice(address token) view returns (uint256)'];

export type EndpointHealth = {
  url: string;
  ok: boolean;
  ms: number;
  blockNumber?: number;
  error?: string;
};

/** Races a promise against a wall-clock bound, so one hung endpoint cannot stall a run. */
export const withDeadline = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: local deadline of ${ms}ms exceeded`)), ms),
    ),
  ]);

/**
 * Probes one endpoint with a raw provider — deliberately not the plugin's
 * memoized one, so probing never seeds the cache or the cooldown map that the
 * behavioural tests are measuring.
 */
export async function probeEndpoint(url: string, timeoutMs = 8_000): Promise<EndpointHealth> {
  const started = Date.now();
  try {
    const provider = new ethers.JsonRpcProvider(url, FUJI_CHAIN_ID, { staticNetwork: true });
    const blockNumber = await withDeadline(provider.getBlockNumber(), timeoutMs, url);
    return { url, ok: true, ms: Date.now() - started, blockNumber };
  } catch (error) {
    const e = error as { shortMessage?: string; message?: string };
    return {
      url,
      ok: false,
      ms: Date.now() - started,
      error: (e.shortMessage ?? e.message ?? String(error)).slice(0, 80),
    };
  }
}

export async function probeAll(urls: string[] = FUJI_URLS): Promise<EndpointHealth[]> {
  const results: EndpointHealth[] = [];
  for (const url of urls) {
    results.push(await probeEndpoint(url));
  }
  return results;
}

/** Short label for tables, so QuikNode's API key never lands in test output. */
export const labelFor = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/\.(com|org|net|co|io)$/, '');
  } catch {
    return url.slice(0, 30);
  }
};

export const table = (rows: string[][]): string => {
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => (r[i] ?? '').length)));
  return rows.map(r => r.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ')).join('\n');
};
