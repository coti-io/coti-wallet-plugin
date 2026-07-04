import { ethers } from 'ethers';
import { normalizeAesKey } from '@coti-io/coti-sdk-typescript';
import { getEthereumProvider, type EIP1193Provider } from '../../lib/ethereum';
import { logger } from '../../lib/logger';
import { CONTRACT_ADDRESSES } from '../../contracts/config';
import { getPrivateTokensForChain } from '../../chains';
import { encryptValue256 } from './encryptValue256';
import { shortHash } from './utils';

/** Matches coti-snap useTokenOperations private 256-bit transfer selector. */
export const PRIVATE_ERC20_TRANSFER_256_SIG =
  'transfer(address,((uint256,uint256),bytes))';

const GAS_ESTIMATE_BUFFER_PERCENT = 105n;
const CONFIDENTIAL_TRANSFER_GAS_LIMIT = 2_000_000n;

const TRANSFER_INTERFACE = new ethers.Interface([
  'function transfer(address to, tuple(tuple(uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) value) returns (uint256)',
]);

export interface ExecutePrivateTokenTransferParams {
  /** Private token contract address */
  tokenAddress: string;
  /** Recipient wallet address */
  recipient: string;
  /** Human-readable amount (e.g. "1.5") */
  amount: string;
  /** Token decimals for amount parsing */
  decimals: number;
  /** 32-byte AES key hex (with or without 0x prefix) */
  aesKey: string;
  /** Connected wallet address (tx sender) */
  walletAddress: string;
  /** Optional EIP-1193 provider; defaults to window.ethereum */
  provider?: EIP1193Provider | null;
}

export interface ExecutePrivateTokenTransferResult {
  txHash: string;
}

type ItUint256TransferPayload = {
  ciphertext: { ciphertextHigh: bigint; ciphertextLow: bigint };
  signature: string;
};

interface BuildItUint256ForTransferParams {
  value: bigint;
  tokenAddress: string;
  functionSelector: string;
  chainId: number;
}

interface SendPrivateTokenTransferParams {
  chainId: number;
  symbol: string;
  recipient: string;
  amount: string;
  walletAddress: string;
  provider?: EIP1193Provider | null;
  sessionAesKey?: string | null;
  hasSnap?: boolean;
  buildItUint256ViaSnap?: (
    params: BuildItUint256ForTransferParams,
  ) => Promise<ItUint256TransferPayload | null>;
}

export function normalizeAesKeyHex(aesKey: string): string {
  try {
    return normalizeAesKey(aesKey);
  } catch {
    throw new Error('AES key must be a 32-hex-character string.');
  }
}

export function resolvePrivateTokenContractAddress(
  chainId: number,
  addressKey: string,
): string | undefined {
  const addresses = CONTRACT_ADDRESSES[chainId];
  if (!addresses) return undefined;
  const resolved = addresses[addressKey as keyof typeof addresses];
  return resolved || undefined;
}

export function resolvePrivateTokenTransferTarget(
  chainId: number,
  symbol: string,
): { tokenAddress: string; decimals: number; addressKey: string } | null {
  const token = getPrivateTokensForChain(chainId).find(t => t.symbol === symbol);
  if (!token?.addressKey) return null;

  const tokenAddress = resolvePrivateTokenContractAddress(chainId, token.addressKey);
  if (!tokenAddress) return null;

  return {
    tokenAddress,
    decimals: token.decimals ?? 18,
    addressKey: token.addressKey,
  };
}

function validatePrivateTransferInputs(
  tokenAddress: string,
  recipient: string,
  amount: string,
  walletAddress: string,
): void {
  if (!ethers.isAddress(tokenAddress)) {
    throw new Error('Invalid token contract address');
  }
  if (!ethers.isAddress(recipient)) {
    throw new Error('Invalid recipient address');
  }
  if (recipient.toLowerCase() === walletAddress.toLowerCase()) {
    throw new Error('Cannot send to your own address');
  }
  if (!amount?.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new Error('Amount must be greater than zero');
  }
}

function parseTransferAmountWei(amount: string, decimals: number): bigint {
  let amountWei: bigint;
  try {
    amountWei = ethers.parseUnits(amount, decimals);
  } catch {
    throw new Error('Invalid amount for token decimals');
  }
  if (amountWei <= 0n) {
    throw new Error('Amount must be greater than zero');
  }
  return amountWei;
}

async function submitPrivateTokenTransferTx(params: {
  tokenAddress: string;
  recipient: string;
  amount: string;
  walletAddress: string;
  itValue: ItUint256TransferPayload;
  provider: EIP1193Provider;
}): Promise<ExecutePrivateTokenTransferResult> {
  const { tokenAddress, recipient, amount, walletAddress, itValue, provider: eip1193 } = params;

  const calldata = TRANSFER_INTERFACE.encodeFunctionData('transfer', [
    recipient,
    [[itValue.ciphertext.ciphertextHigh, itValue.ciphertext.ciphertextLow], itValue.signature],
  ]);

  let gasLimit = CONFIDENTIAL_TRANSFER_GAS_LIMIT;
  try {
    const estimateHex = await eip1193.request({
      method: 'eth_estimateGas',
      params: [
        {
          from: walletAddress,
          to: tokenAddress,
          data: calldata,
        },
      ],
    });
    gasLimit = (BigInt(estimateHex as string) * GAS_ESTIMATE_BUFFER_PERCENT) / 100n;
  } catch (err) {
    logger.warn('Private transfer gas estimation failed, using fallback', err);
  }

  logger.log('Sending private token transfer', {
    token: shortHash(tokenAddress),
    recipient: shortHash(recipient),
    amount,
  });

  const browserProvider = new ethers.BrowserProvider(eip1193);
  const rawTxHash = (await eip1193.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: walletAddress,
        to: tokenAddress,
        data: calldata,
        gas: `0x${gasLimit.toString(16)}`,
      },
    ],
  })) as string;

  logger.log('Waiting for private transfer tx', { txHash: shortHash(rawTxHash) });
  const receipt = await browserProvider.waitForTransaction(rawTxHash);
  if (!receipt || receipt.status !== 1) {
    throw new Error('Private token transfer failed');
  }

  return { txHash: rawTxHash };
}

/**
 * Sends a private ERC-20 transfer (256-bit itUint256) to another address.
 *
 * Flow mirrors coti-snap transferERC20 (256-bit branch) and portal private approve:
 * encrypt + signMessage, encode transfer calldata, estimate gas, eth_sendTransaction.
 */
export async function executePrivateTokenTransfer(
  params: ExecutePrivateTokenTransferParams,
): Promise<ExecutePrivateTokenTransferResult> {
  const {
    tokenAddress,
    recipient,
    amount,
    decimals,
    aesKey,
    walletAddress,
    provider: injectedProvider,
  } = params;

  validatePrivateTransferInputs(tokenAddress, recipient, amount, walletAddress);

  const eip1193 = injectedProvider ?? getEthereumProvider();
  if (!eip1193) {
    throw new Error('No wallet found');
  }

  const normalizedAesKey = normalizeAesKeyHex(aesKey);
  const provider = new ethers.BrowserProvider(eip1193);
  const signer = await provider.getSigner();
  const amountWei = parseTransferAmountWei(amount, decimals);
  const transferSig = ethers.id(PRIVATE_ERC20_TRANSFER_256_SIG).slice(0, 10);
  const itValue = await encryptValue256(
    amountWei,
    normalizedAesKey,
    tokenAddress,
    transferSig,
    walletAddress,
    signer,
  );

  return submitPrivateTokenTransferTx({
    tokenAddress,
    recipient,
    amount,
    walletAddress,
    itValue,
    provider: eip1193,
  });
}

/**
 * Plugin-owned private send — resolves token metadata and encrypts via session key
 * or Snap without exposing the AES key to dApp code.
 */
export async function sendPrivateTokenTransfer(
  params: SendPrivateTokenTransferParams,
): Promise<ExecutePrivateTokenTransferResult> {
  const {
    chainId,
    symbol,
    recipient,
    amount,
    walletAddress,
    provider: injectedProvider,
    sessionAesKey,
    hasSnap,
    buildItUint256ViaSnap,
  } = params;

  const target = resolvePrivateTokenTransferTarget(chainId, symbol);
  if (!target) {
    throw new Error('This token is not supported for send on this network.');
  }

  validatePrivateTransferInputs(target.tokenAddress, recipient, amount, walletAddress);

  const eip1193 = injectedProvider ?? getEthereumProvider();
  if (!eip1193) {
    throw new Error('No wallet found');
  }

  const browserProvider = new ethers.BrowserProvider(eip1193);
  const signer = await browserProvider.getSigner();
  const amountWei = parseTransferAmountWei(amount, target.decimals);
  const transferSig = ethers.id(PRIVATE_ERC20_TRANSFER_256_SIG).slice(0, 10);

  let itValue: ItUint256TransferPayload | null = null;
  if (sessionAesKey) {
    itValue = await encryptValue256(
      amountWei,
      normalizeAesKeyHex(sessionAesKey),
      target.tokenAddress,
      transferSig,
      walletAddress,
      signer,
    );
  } else if (hasSnap && buildItUint256ViaSnap) {
    itValue = await buildItUint256ViaSnap({
      value: amountWei,
      tokenAddress: target.tokenAddress,
      functionSelector: transferSig,
      chainId,
    });
  }

  if (!itValue) {
    throw new Error('Private balances are locked. Unlock to send tokens.');
  }

  return submitPrivateTokenTransferTx({
    tokenAddress: target.tokenAddress,
    recipient,
    amount,
    walletAddress,
    itValue,
    provider: eip1193,
  });
}
