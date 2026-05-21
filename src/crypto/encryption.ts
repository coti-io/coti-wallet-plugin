/**
 * Encryption utilities for constructing IT (Input Text) structures
 * for COTI confidential smart contract calls.
 *
 * Ported from coti-snap/packages/snap/src/utils/itUint.ts
 * Uses @coti-io/coti-sdk-typescript for the underlying AES encryption.
 */

import {
  encodeUint,
  encodeKey,
  encrypt,
  decodeUint,
} from '@coti-io/coti-sdk-typescript';
import { ethers } from 'ethers';
import type { ItUint64, ItUint256 } from '../types/ciphertext';
import { normalizeAesKey } from './aesKey';
import { buildItSignature } from './signature';

/**
 * Builds an ItUint64 structure for a plaintext value < 2^64.
 * Encrypts the plaintext with the user's AES key and signs the ciphertext
 * with the wallet's private key for on-chain verification.
 *
 * @param plaintext - The value to encrypt (must be < 2^64).
 * @param aesKey - The user's AES key (hex string, with or without 0x prefix).
 * @param wallet - An ethers Wallet instance for signing.
 * @param contractAddress - The target contract address.
 * @param functionSelector - The 4-byte function selector (e.g., "0x12345678").
 * @returns An ItUint64 structure with ciphertext and signature.
 * @throws RangeError if plaintext >= 2^64.
 */
export function buildItUint64(
  plaintext: bigint,
  aesKey: string,
  wallet: ethers.Wallet,
  contractAddress: string,
  functionSelector: string,
): ItUint64 {
  if (plaintext >= 2n ** 64n) {
    throw new RangeError('Plaintext size must be 64 bits or smaller');
  }

  const normalizedKey = normalizeAesKey(aesKey);
  const plaintextBytes = encodeUint(plaintext);
  const keyBytes = encodeKey(normalizedKey);
  const { ciphertext, r } = encrypt(keyBytes, plaintextBytes);

  // Concatenate ciphertext and randomness into a single Uint8Array
  const ct = new Uint8Array(ciphertext.length + r.length);
  ct.set(ciphertext, 0);
  ct.set(r, ciphertext.length);

  const ctInt = decodeUint(ct);

  const signature = buildItSignature(
    wallet.address,
    contractAddress,
    functionSelector,
    ctInt,
    wallet.privateKey,
  );

  return { ciphertext: ctInt.toString(), signature };
}

/**
 * Builds an ItUint256 structure for a 256-bit plaintext.
 * Splits the plaintext into four 64-bit segments and encrypts each independently.
 *
 * @param plaintext - The 256-bit value to encrypt.
 * @param aesKey - The user's AES key (hex string, with or without 0x prefix).
 * @param wallet - An ethers Wallet instance for signing.
 * @param contractAddress - The target contract address.
 * @param functionSelector - The 4-byte function selector (e.g., "0x12345678").
 * @returns An ItUint256 structure with nested ciphertext and signatures.
 */
export function buildItUint256(
  plaintext: bigint,
  aesKey: string,
  wallet: ethers.Wallet,
  contractAddress: string,
  functionSelector: string,
): ItUint256 {
  const mask64 = (1n << 64n) - 1n;
  const d1 = (plaintext >> 192n) & mask64;
  const d2 = (plaintext >> 128n) & mask64;
  const d3 = (plaintext >> 64n) & mask64;
  const d4 = plaintext & mask64;

  const it1 = buildItUint64(d1, aesKey, wallet, contractAddress, functionSelector);
  const it2 = buildItUint64(d2, aesKey, wallet, contractAddress, functionSelector);
  const it3 = buildItUint64(d3, aesKey, wallet, contractAddress, functionSelector);
  const it4 = buildItUint64(d4, aesKey, wallet, contractAddress, functionSelector);

  return {
    ciphertext: {
      high: { high: it1.ciphertext, low: it2.ciphertext },
      low: { high: it3.ciphertext, low: it4.ciphertext },
    },
    signature: [
      [it1.signature, it2.signature],
      [it3.signature, it4.signature],
    ],
  };
}
