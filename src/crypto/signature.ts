/**
 * Low-level ECDSA signature helpers for COTI IT (Input Text) construction.
 *
 * Ported from coti-snap/packages/snap/src/utils/itUint.ts (buildSignature)
 */

import { ethers } from 'ethers';

/**
 * Produces a raw ECDSA signature (r, s, v) for a given digest.
 *
 * @param privateKey - The signer's private key (hex string with 0x prefix).
 * @param digest - The 32-byte message digest to sign (hex string with 0x prefix).
 * @returns An object containing r, s (hex strings), and v (27 or 28).
 */
export function signDigest(
  privateKey: string,
  digest: string,
): { r: string; s: string; v: number } {
  const signingKey = new ethers.SigningKey(privateKey);
  const sig = signingKey.sign(digest);
  return { r: sig.r, s: sig.s, v: sig.v };
}

/**
 * Builds the COTI IT signature: signs keccak256(signerAddress, contractAddress, selector, ciphertext)
 * with the wallet's private key, returned as a 65-byte hex string with normalized v.
 *
 * The signature digest is computed as:
 * `solidityPackedKeccak256(['address','address','bytes4','uint256'], [signer, contract, selector, ct])`
 *
 * @param signerAddress - The signer's Ethereum address.
 * @param contractAddress - The target contract address.
 * @param functionSelector - The 4-byte function selector (e.g., "0x12345678").
 * @param ciphertext - The encrypted ciphertext as a bigint.
 * @param privateKey - The signer's private key (hex string with 0x prefix).
 * @returns A 65-byte hex string (0x-prefixed, 132 chars) with normalized v (0x00/0x01).
 */
export function buildItSignature(
  signerAddress: string,
  contractAddress: string,
  functionSelector: string,
  ciphertext: bigint,
  privateKey: string,
): string {
  const digest = ethers.solidityPackedKeccak256(
    ['address', 'address', 'bytes4', 'uint256'],
    [signerAddress, contractAddress, functionSelector, ciphertext],
  );

  const sig = signDigest(privateKey, digest);
  return normalizeSignature(sig);
}

/**
 * Normalizes a signature's v value (27/28 → 0x00/0x01) and returns a 65-byte hex string.
 *
 * @param sig - An object with r, s (hex strings) and v (27 or 28).
 * @returns A 0x-prefixed 65-byte hex string (r + s + normalized_v).
 */
export function normalizeSignature(sig: {
  r: string;
  s: string;
  v: number;
}): string {
  const vByte = sig.v === 27 ? '0x00' : '0x01';
  return ethers.hexlify(ethers.concat([sig.r, sig.s, vByte]));
}
