import { buildItUint256WithSigner } from '@coti-io/coti-sdk-typescript';
import { ethers } from 'ethers';
import { normalizeAesKey } from '../../crypto/aesKey';

/**
 * Builds a signed 256-bit COTI input-text value for a browser wallet signer.
 * Delegates to SDK `buildItUint256WithSigner` (browser-wallet signing path).
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
  const result = await buildItUint256WithSigner({
    value: amountWei,
    aesKey: normalizeAesKey(aesKeyHex),
    signerAddress: walletAddress,
    contractAddress,
    functionSelector,
    signMessage: (message) => signer.signMessage(message),
  });

  return {
    ciphertext: {
      ciphertextHigh: result.ciphertext.ciphertextHigh,
      ciphertextLow: result.ciphertext.ciphertextLow,
    },
    signature: result.signature,
  };
}
