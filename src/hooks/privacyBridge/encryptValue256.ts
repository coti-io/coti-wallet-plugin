import { ethers } from 'ethers';
import { encrypt, encodeKey, encodeUint } from '@coti-io/coti-sdk-typescript';
import { normalizeAesKey } from '../../crypto/aesKey';

/**
 * Encrypts a 256-bit unsigned value using the COTI AES scheme.
 *
 * Inlined from buildItUint256WithSigner (added in coti-sdk-typescript v1.0.8).
 * Uses only encrypt/encodeKey/encodeUint which exist in v1.0.6+.
 *
 * Values up to 128 bits use compact encoding (high block is zero).
 * Values > 128 bits use full two-block encoding.
 */
function encryptUint256Local(
  value: bigint,
  aesKeyHex: string,
): { ciphertextHigh: bigint; ciphertextLow: bigint } {
  const keyBytes = encodeKey(normalizeAesKey(aesKeyHex));
  const BLOCK = 16; // bytes

  function blockToBigInt(ciphertext: Uint8Array, r: Uint8Array): bigint {
    const buf = new Uint8Array(32);
    buf.set(ciphertext, 0);
    buf.set(r, BLOCK);
    let result = 0n;
    for (const byte of buf) result = (result << 8n) | BigInt(byte);
    return result;
  }

  if (value <= (1n << 128n) - 1n) {
    // Compact: encrypt zero for high block, value for low block
    const zeroBytes = encodeUint(0n);
    const { ciphertext: ch, r: rh } = encrypt(keyBytes, zeroBytes);
    const lowBytes = new Uint8Array(BLOCK);
    let v = value;
    for (let i = BLOCK - 1; i >= 0; i--) { lowBytes[i] = Number(v & 0xffn); v >>= 8n; }
    const { ciphertext: cl, r: rl } = encrypt(keyBytes, lowBytes);
    return { ciphertextHigh: blockToBigInt(ch, rh), ciphertextLow: blockToBigInt(cl, rl) };
  } else {
    // Full: split into two 128-bit halves
    const high = value >> 128n;
    const low = value & ((1n << 128n) - 1n);
    const highBytes = new Uint8Array(BLOCK);
    const lowBytes = new Uint8Array(BLOCK);
    let h = high, l = low;
    for (let i = BLOCK - 1; i >= 0; i--) { highBytes[i] = Number(h & 0xffn); h >>= 8n; }
    for (let i = BLOCK - 1; i >= 0; i--) { lowBytes[i] = Number(l & 0xffn); l >>= 8n; }
    const { ciphertext: ch, r: rh } = encrypt(keyBytes, highBytes);
    const { ciphertext: cl, r: rl } = encrypt(keyBytes, lowBytes);
    return { ciphertextHigh: blockToBigInt(ch, rh), ciphertextLow: blockToBigInt(cl, rl) };
  }
}

/**
 * Builds a signed 256-bit COTI input-text value for a browser wallet signer.
 *
 * Inlined from buildItUint256WithSigner (coti-sdk-typescript >= v1.0.8) so the
 * plugin works with older SDK versions installed in consumer apps.
 */
export async function encryptValue256(
  amountWei: bigint,
  aesKeyHex: string,
  contractAddress: string,
  functionSelector: string,
  walletAddress: string,
  signer: ethers.JsonRpcSigner,
): Promise<{
  ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint };
  signature: string;
}> {
  const ciphertext = encryptUint256Local(amountWei, aesKeyHex);

  // Sign ABI-packed (signer, contract, selector, ciphertextHigh, ciphertextLow)
  // This matches the on-chain verification in COTI confidential token contracts.
  const message = ethers.getBytes(
    ethers.solidityPackedKeccak256(
      ['address', 'address', 'bytes4', 'uint256', 'uint256'],
      [
        walletAddress,
        contractAddress,
        functionSelector,
        ciphertext.ciphertextHigh,
        ciphertext.ciphertextLow,
      ],
    ),
  );

  const signature = await signer.signMessage(message);
  return { ciphertext, signature };
}
