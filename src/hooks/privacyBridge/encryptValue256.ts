import { ethers } from 'ethers';

/**
 * Custom 256-bit encrypt and sign helper for COTI MPC (itUint256).
 * Mirrors the snap site's buildItUint256 signing strategy.
 */
export async function encryptValue256(
  amountWei: bigint,
  aesKeyHex: string,
  contractAddress: string,
  functionSelector: string,
  walletAddress: string,
  signer: ethers.JsonRpcSigner,
) {
  const { encodeKey, encrypt } = await import('@coti-io/coti-sdk-typescript');

  const BLOCK_SIZE = 16;
  const CT_SIZE = 32;

  const userAesKey = encodeKey(aesKeyHex);
  const plaintextBigInt = BigInt(amountWei);
  const bitSize = plaintextBigInt === 0n ? 0 : plaintextBigInt.toString(2).length;

  function writeBE(buf: Uint8Array, value: bigint) {
    for (let i = buf.length - 1; i >= 0; i--) {
      buf[i] = Number(value & 0xffn);
      value >>= 8n;
    }
  }

  let ct: Uint8Array;
  if (bitSize <= 128) {
    const lowBytes = new Uint8Array(BLOCK_SIZE);
    writeBE(lowBytes, plaintextBigInt);
    const { ciphertext: ctLow, r: rLow } = encrypt(userAesKey, lowBytes);
    const highBytes = new Uint8Array(BLOCK_SIZE);
    const { ciphertext: ctHigh, r: rHigh } = encrypt(userAesKey, highBytes);
    ct = new Uint8Array([...ctHigh, ...rHigh, ...ctLow, ...rLow]);
  } else {
    const fullBytes = new Uint8Array(CT_SIZE);
    writeBE(fullBytes, plaintextBigInt);
    const { ciphertext: ctHigh, r: rHigh } = encrypt(userAesKey, fullBytes.slice(0, BLOCK_SIZE));
    const { ciphertext: ctLow, r: rLow } = encrypt(userAesKey, fullBytes.slice(BLOCK_SIZE));
    ct = new Uint8Array([...ctHigh, ...rHigh, ...ctLow, ...rLow]);
  }

  const ctHighHex = Array.from(ct.slice(0, CT_SIZE))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const ctLowHex = Array.from(ct.slice(CT_SIZE))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const ciphertextHigh = BigInt('0x' + ctHighHex);
  const ciphertextLow = BigInt('0x' + ctLowHex);

  const message = ethers.solidityPacked(
    ['address', 'address', 'bytes4', 'uint256', 'uint256'],
    [walletAddress, contractAddress, functionSelector, ciphertextHigh, ciphertextLow],
  );

  const signature = await signer.signMessage(ethers.getBytes(message));

  return {
    ciphertext: { ciphertextHigh, ciphertextLow },
    signature,
  };
}
