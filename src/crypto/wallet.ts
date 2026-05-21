/**
 * Deterministic wallet derivation for COTI confidential operations.
 *
 * Ported from coti-snap/packages/snap/src/utils/itUint.ts (deriveSnapWallet)
 */

import { ethers } from 'ethers';
import { normalizeAesKey } from './aesKey';

/**
 * Derives a deterministic ethers Wallet from an AES key, account address, and chain ID.
 *
 * Uses `solidityPackedKeccak256(['string','address','string','string'],
 *   ['coti-snap-encryption', account, chainId, normalizedAesKey])` as the private key.
 *
 * @param aesKey - The user's AES key (hex string, with or without 0x prefix).
 * @param account - The user's Ethereum address.
 * @param chainId - The chain ID string (e.g., "2632500").
 * @returns A deterministic ethers Wallet instance.
 * @throws Error if the AES key is invalid or the address is not a valid Ethereum address.
 */
export function deriveWallet(
  aesKey: string,
  account: string,
  chainId: string,
): ethers.Wallet {
  if (!ethers.isAddress(account)) {
    throw new Error('Invalid Ethereum address');
  }

  const normalizedKey = normalizeAesKey(aesKey);

  const seed = ethers.solidityPackedKeccak256(
    ['string', 'address', 'string', 'string'],
    ['coti-snap-encryption', account, chainId, normalizedKey],
  );

  return new ethers.Wallet(seed);
}
