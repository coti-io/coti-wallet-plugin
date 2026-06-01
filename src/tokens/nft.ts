/**
 * ERC721 operations including confidential token URI decryption.
 *
 * Ported from coti-snap/packages/snap/src/utils/token.ts
 * (getERC721Details, checkERC721Ownership, getTokenURI, getPublicTokenURI)
 */

import { ethers } from 'ethers';
import { decryptString } from '@coti-io/coti-sdk-typescript';
import { normalizeAesKey } from '../crypto/aesKey';

/** ERC721 collection metadata. */
export interface ERC721Metadata {
  name: string | null;
  symbol: string | null;
}

const ERC721_METADATA_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

const ERC721_OWNERSHIP_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
];

const ERC721_TOKEN_URI_ABI = [
  'function tokenURI(uint256 tokenId) view returns (string)',
];

const ERC721_PRIVATE_TOKEN_URI_ABI = [
  'function tokenURI(uint256 tokenId) view returns ((uint256[]))',
];

/** Default timeout for provider calls (10 seconds). */
const NFT_TIMEOUT_MS = 10_000;

/** Default IPFS gateway. */
const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';

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
 * Fetches ERC721 collection metadata (name, symbol).
 *
 * @param address - The NFT contract address.
 * @param provider - An ethers Provider instance.
 * @returns The ERC721 metadata, or null if the contract is not an ERC721.
 */
export async function getERC721Metadata(
  address: string,
  provider: ethers.Provider,
): Promise<ERC721Metadata | null> {
  try {
    return await withTimeout(
      fetchERC721Metadata(address, provider),
      NFT_TIMEOUT_MS,
    );
  } catch {
    return null;
  }
}

async function fetchERC721Metadata(
  address: string,
  provider: ethers.Provider,
): Promise<ERC721Metadata | null> {
  const contract = new ethers.Contract(address, ERC721_METADATA_ABI, provider);

  let name: string | null = null;
  let symbol: string | null = null;

  const results = await Promise.allSettled([
    contract.name(),
    contract.symbol(),
  ]);

  if (results[0].status === 'fulfilled') {
    name = results[0].value as string;
  }
  if (results[1].status === 'fulfilled') {
    symbol = results[1].value as string;
  }

  if (name === null && symbol === null) {
    return null;
  }

  return { name, symbol };
}

/**
 * Verifies ERC721 token ownership by checking if `ownerOf(tokenId)` matches the given address.
 *
 * @param address - The NFT contract address.
 * @param tokenId - The token ID to check.
 * @param ownerAddress - The expected owner's Ethereum address.
 * @param provider - An ethers Provider instance.
 * @returns True if the given address owns the token.
 */
export async function verifyERC721Ownership(
  address: string,
  tokenId: string,
  ownerAddress: string,
  provider: ethers.Provider,
): Promise<boolean> {
  try {
    return await withTimeout(
      verifyOwnershipInternal(address, tokenId, ownerAddress, provider),
      NFT_TIMEOUT_MS,
    );
  } catch {
    return false;
  }
}

async function verifyOwnershipInternal(
  address: string,
  tokenId: string,
  ownerAddress: string,
  provider: ethers.Provider,
): Promise<boolean> {
  const contract = new ethers.Contract(address, ERC721_OWNERSHIP_ABI, provider);
  try {
    const owner: string = await contract.ownerOf(BigInt(tokenId));
    return owner.toLowerCase() === ownerAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Decrypts a private NFT's token URI using the user's AES key.
 * The on-chain tokenURI returns an encrypted ctString which is decrypted client-side.
 *
 * @param address - The NFT contract address.
 * @param tokenId - The token ID.
 * @param aesKey - The user's AES key (hex string, with or without 0x prefix).
 * @param provider - An ethers Provider instance.
 * @returns The decrypted token URI string, or null on failure.
 */
export async function getPrivateTokenURI(
  address: string,
  tokenId: string,
  aesKey: string,
  provider: ethers.Provider,
): Promise<string | null> {
  try {
    return await withTimeout(
      fetchPrivateTokenURI(address, tokenId, aesKey, provider),
      NFT_TIMEOUT_MS,
    );
  } catch {
    return null;
  }
}

async function fetchPrivateTokenURI(
  address: string,
  tokenId: string,
  aesKey: string,
  provider: ethers.Provider,
): Promise<string | null> {
  const normalizedKey = normalizeAesKey(aesKey);
  const contract = new ethers.Contract(
    address,
    ERC721_PRIVATE_TOKEN_URI_ABI,
    provider,
  );

  const encryptedTokenURI = await contract.tokenURI(BigInt(tokenId));
  const decryptedURI = decryptString(encryptedTokenURI, normalizedKey)
    .replace(/\0/g, '')
    .trim();

  if (!decryptedURI) {
    return null;
  }

  return decryptedURI;
}

/**
 * Fetches a public NFT's token URI, resolving IPFS URIs through a gateway.
 *
 * @param address - The NFT contract address.
 * @param tokenId - The token ID.
 * @param provider - An ethers Provider instance.
 * @returns The token URI string (with IPFS resolved to HTTP), or null on failure.
 */
export async function getPublicTokenURI(
  address: string,
  tokenId: string,
  provider: ethers.Provider,
): Promise<string | null> {
  try {
    return await withTimeout(
      fetchPublicTokenURI(address, tokenId, provider),
      NFT_TIMEOUT_MS,
    );
  } catch {
    return null;
  }
}

async function fetchPublicTokenURI(
  address: string,
  tokenId: string,
  provider: ethers.Provider,
): Promise<string | null> {
  const contract = new ethers.Contract(address, ERC721_TOKEN_URI_ABI, provider);
  const uri: string | null = await contract.tokenURI(BigInt(tokenId));

  if (!uri) {
    return null;
  }

  return resolveIpfsUri(uri);
}

/**
 * Resolves an IPFS URI to an HTTP gateway URL.
 * If the URI is already HTTP(S), returns it unchanged.
 *
 * @param uri - The URI to resolve (ipfs:// or http(s)://).
 * @param gateway - The IPFS gateway base URL. Defaults to "https://ipfs.io/ipfs/".
 * @returns The resolved HTTP URL.
 */
export function resolveIpfsUri(uri: string, gateway?: string): string {
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice('ipfs://'.length);
    return `${gateway ?? DEFAULT_IPFS_GATEWAY}${cid}`;
  }
  return uri;
}
