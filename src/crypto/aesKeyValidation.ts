import { encodeKey, encodeUint, encrypt, decryptUint, decodeUint } from '@coti-io/coti-sdk-typescript';
import { ethers } from 'ethers';
import { normalizeAesKey } from './aesKey';
import { decryptCtUint256 } from './decryption';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { guardedEthAccounts } from '../lib/metaMaskMobile';
import { logger } from '../lib/logger';
import type { EIP1193Provider } from '../lib/ethereum';
import { CONTRACT_ADDRESSES, getPrivateTokensForChain, getPublicTokensForChain } from '../contracts/config';
import { getChainConfig } from '../chains';
import { getRpcUrlForChainId } from '../config/chains';

/** Fixed plaintext used for local encrypt/decrypt round-trip validation. */
const ROUND_TRIP_TEST_VALUE = 0x0123456789abcdefn;

const NESTED_BALANCE_ABI = [
  'function balanceOf(address account) view returns (tuple(tuple(uint256 high, uint256 low) high, tuple(uint256 high, uint256 low) low))',
];

const FLAT_BALANCE_ABI = [
  'function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))',
];

/** Returns the 128-bit SDK key material (Snap may store 256-bit hex). */
export function getSdkAesKeyHex(aesKey: string): string {
  const normalized = normalizeAesKey(aesKey);
  return normalized.length === 64 ? normalized.slice(0, 32) : normalized;
}

/**
 * Encrypts and decrypts a fixed test value with the given AES key.
 * Returns true when the round-trip succeeds.
 */
export function validateAesKeyRoundTrip(aesKey: string): boolean {
  try {
    const sdkKey = getSdkAesKeyHex(aesKey);
    const keyBytes = encodeKey(sdkKey);
    const plainBytes = encodeUint(ROUND_TRIP_TEST_VALUE);
    const { ciphertext, r } = encrypt(keyBytes, plainBytes);
    const ct = new Uint8Array(ciphertext.length + r.length);
    ct.set(ciphertext, 0);
    ct.set(r, ciphertext.length);
    const decrypted = decryptUint(decodeUint(ct), sdkKey);
    const decryptedBigInt = typeof decrypted === 'bigint' ? decrypted : BigInt(decrypted);
    return decryptedBigInt === ROUND_TRIP_TEST_VALUE;
  } catch (error) {
    logger.warn(
      '[validateAesKeyRoundTrip] failed:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Compares two AES keys that may differ in length (32 vs 64 hex chars).
 */
export function aesKeysEquivalent(a: string, b: string): boolean {
  return getSdkAesKeyHex(a) === getSdkAesKeyHex(b);
}

/**
 * Ensures MetaMask's active account matches the connected dApp address.
 */
export async function assertMetaMaskActiveAccount(
  provider: EIP1193Provider,
  expectedAddress: string,
): Promise<void> {
  const accounts = await guardedEthAccounts(provider);
  const active = accounts[0]?.toLowerCase();
  const expected = expectedAddress.toLowerCase();
  if (!active || active !== expected) {
    throw new CotiPluginError(
      CotiErrorCode.AES_KEY_MISMATCH,
      'MetaMask active account does not match the connected wallet. Switch accounts in MetaMask and try again.',
    );
  }
}

function isZeroNestedCiphertext(result: unknown): boolean {
  if (!result || typeof result !== 'object') return true;
  const record = result as Record<string, unknown>;
  const high = record.high as Record<string, unknown> | undefined;
  const low = record.low as Record<string, unknown> | undefined;
  const arrayValue = result as unknown as ArrayLike<unknown>;
  const hh = high?.high ?? (arrayValue[0] as ArrayLike<unknown> | undefined)?.[0];
  const hl = high?.low ?? (arrayValue[0] as ArrayLike<unknown> | undefined)?.[1];
  const lh = low?.high ?? (arrayValue[1] as ArrayLike<unknown> | undefined)?.[0];
  const ll = low?.low ?? (arrayValue[1] as ArrayLike<unknown> | undefined)?.[1];
  return [hh, hl, lh, ll].every(v => v === 0n || v === undefined);
}

function normalizeNestedCiphertext(result: unknown) {
  const record = result as Record<string, unknown>;
  const high = record.high as Record<string, unknown> | undefined;
  const low = record.low as Record<string, unknown> | undefined;
  const arrayValue = result as unknown as ArrayLike<unknown>;
  return {
    high: {
      high: BigInt((high?.high ?? (arrayValue[0] as ArrayLike<unknown>)?.[0] ?? 0n) as bigint),
      low: BigInt((high?.low ?? (arrayValue[0] as ArrayLike<unknown>)?.[1] ?? 0n) as bigint),
    },
    low: {
      high: BigInt((low?.high ?? (arrayValue[1] as ArrayLike<unknown>)?.[0] ?? 0n) as bigint),
      low: BigInt((low?.low ?? (arrayValue[1] as ArrayLike<unknown>)?.[1] ?? 0n) as bigint),
    },
  };
}

async function readEncryptedBalance(
  provider: ethers.JsonRpcProvider,
  tokenAddress: string,
  account: string,
): Promise<{ isNested: boolean; value: unknown } | null> {
  try {
    const nestedContract = new ethers.Contract(tokenAddress, NESTED_BALANCE_ABI, provider);
    const nested = await nestedContract.balanceOf(account);
    const hasNestedShape =
      (nested?.high?.high !== undefined && nested?.high?.low !== undefined) ||
      (nested?.[0]?.[0] !== undefined && nested?.[0]?.[1] !== undefined);
    if (hasNestedShape) {
      return { isNested: true, value: nested };
    }
  } catch {
    // fall through to flat ABI
  }

  try {
    const flatContract = new ethers.Contract(tokenAddress, FLAT_BALANCE_ABI, provider);
    const flat = await flatContract.balanceOf(account);
    return { isNested: false, value: flat };
  } catch (error) {
    logger.warn('[validateAesKeyAgainstOnChainCiphertext] balanceOf read failed:', error);
    return null;
  }
}

function tryDecryptEncryptedBalance(
  encrypted: { isNested: boolean; value: unknown },
  aesKey: string,
  decimals: number,
): boolean | null {
  if (encrypted.isNested) {
    if (isZeroNestedCiphertext(encrypted.value)) return null;
    const normalized = normalizeNestedCiphertext(encrypted.value);
    const decrypted = decryptCtUint256(normalized, aesKey, { decimals });
    return decrypted !== null;
  }

  const record = encrypted.value as Record<string, unknown>;
  const arrayValue = encrypted.value as ArrayLike<unknown>;
  const high = (record.ciphertextHigh ?? arrayValue[0] ?? 0n) as bigint;
  const low = (record.ciphertextLow ?? arrayValue[1] ?? 0n) as bigint;
  if (high === 0n && low === 0n) return null;

  const decrypted = decryptCtUint256({ ciphertextHigh: high, ciphertextLow: low }, aesKey, { decimals });
  return decrypted !== null;
}

/**
 * Read-only validation: decrypts existing on-chain ciphertext via RPC (no wallet transactions).
 * When every non-zero ciphertext fails to decrypt, the AES key is treated as invalid.
 */
export async function validateAesKeyAgainstOnChainCiphertext(
  aesKey: string,
  account: string,
  chainId: number,
): Promise<void> {
  const addresses = CONTRACT_ADDRESSES[chainId];
  if (!addresses) return;

  const privateTokenConfigs = getPrivateTokensForChain(chainId);
  const publicTokenConfigs = getPublicTokensForChain(chainId);
  const chainCfg = getChainConfig(chainId);
  const isPodChain = chainCfg?.portalStrategy === 'pod-privacy-portal';

  const provider = new ethers.JsonRpcProvider(getRpcUrlForChainId(chainId), chainId);

  let sawNonZeroCiphertext = false;

  for (const token of privateTokenConfigs) {
    if (!token.addressKey) continue;
    const tokenAddress = addresses[token.addressKey];
    if (!tokenAddress) continue;

    const publicSymbol = token.symbol.replace(/^p\./, '');
    const pubCfg = publicTokenConfigs.find(t => t.symbol === publicSymbol);
    const isPlainBalance = !isPodChain && !!pubCfg?.isNative;
    if (isPlainBalance) continue;

    const encrypted = await readEncryptedBalance(provider, tokenAddress, account);
    if (!encrypted) continue;

    const decryptResult = tryDecryptEncryptedBalance(encrypted, aesKey, token.decimals ?? 18);
    if (decryptResult === null) continue;

    sawNonZeroCiphertext = true;
    if (decryptResult) {
      logger.log(`[validateAesKeyAgainstOnChainCiphertext] key validated via ${token.symbol}`);
      return;
    }
  }

  if (sawNonZeroCiphertext) {
    throw new CotiPluginError(
      CotiErrorCode.AES_KEY_MISMATCH,
      'AES key cannot decrypt on-chain private balances for this account. Re-onboarding required.',
    );
  }
}

/**
 * Validates a MetaMask Snap AES key on unlock without wallet transactions:
 * 1. Local encrypt/decrypt round-trip
 * 2. Active account matches connected address
 * 3. Read-only decrypt probe against on-chain ciphertext (when present)
 */
export async function validateMetaMaskAesKeyOnUnlock(
  snapKey: string,
  address: string,
  walletProvider: EIP1193Provider,
  chainId?: number | null,
): Promise<void> {
  if (!validateAesKeyRoundTrip(snapKey)) {
    throw new CotiPluginError(
      CotiErrorCode.AES_KEY_MISMATCH,
      'AES key failed encrypt/decrypt validation. Re-onboarding required.',
    );
  }

  await assertMetaMaskActiveAccount(walletProvider, address);

  if (typeof chainId === 'number') {
    await validateAesKeyAgainstOnChainCiphertext(snapKey, address, chainId);
  }
}

/** Session-scoped registry of AES keys that passed unlock validation for a wallet. */
const validatedUnlockKeys = new Map<string, string>();

export function markAesKeyValidatedForUnlock(address: string, aesKey: string): void {
  validatedUnlockKeys.set(
    address.toLowerCase(),
    normalizeAesKey(aesKey).toLowerCase(),
  );
}

export function clearAesKeyValidatedForUnlock(address?: string): void {
  if (address) {
    validatedUnlockKeys.delete(address.toLowerCase());
  } else {
    validatedUnlockKeys.clear();
  }
}

export function isAesKeyValidatedForUnlock(address: string, aesKey: string): boolean {
  const stored = validatedUnlockKeys.get(address.toLowerCase());
  if (!stored) return false;
  return stored === normalizeAesKey(aesKey).toLowerCase();
}

export function getValidatedAesKeyForUnlock(address: string): string | null {
  return validatedUnlockKeys.get(address.toLowerCase()) ?? null;
}
