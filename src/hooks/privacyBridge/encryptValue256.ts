import { ethers } from 'ethers';
import { buildItUint256WithSigner } from '@coti-io/coti-sdk-typescript';

/**
 * Builds a signed 256-bit COTI input-text value through the SDK.
 */
export async function encryptValue256(
  amountWei: bigint,
  aesKeyHex: string,
  contractAddress: string,
  functionSelector: string,
  walletAddress: string,
  signer: ethers.JsonRpcSigner,
) {
  return buildItUint256WithSigner({
    value: amountWei,
    aesKey: aesKeyHex,
    signerAddress: walletAddress,
    contractAddress,
    functionSelector,
    signMessage: message => signer.signMessage(message),
  });
}
