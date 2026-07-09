import { encodeKey, encodeUint, encrypt, decryptUint, decodeUint } from '@coti-io/coti-sdk-typescript';
import { ethers } from 'ethers';
import { normalizeAesKey } from './aesKey';
import { decryptCtUint256 } from './decryption';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { guardedEthAccounts } from '../lib/metaMaskMobile';
import { logger } from '../lib/logger';
import type { EIP1193Provider } from '../lib/ethereum';
import { CONTRACT_ADDRESSES, getPrivateTokensForChain, getPublicTokensForChain } from '../contracts/config';
import { withRpcFallback } from '../lib/rpcProvider';

/** Fixed plaintext used for local encrypt/decrypt round-trip validation. */
const ROUND_TRIP_TEST_VALUE = 0x0123456789abcdefn;

const FLAT_BALANCE_ABI = [
  'function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))',
];

/** Returns the 128-bit SDK key material (Snap may store 256-bit hex). */
export function getSdkAesKeyHex(aesKey: string): string {
  const trimmed = aesKey.startsWith('0x') ? aesKey.slice(2) : aesKey;
  const lowered = trimmed.toLowerCase();
  if (/^[0-9a-f]{64}$/.test(lowered)) {
    return lowered.slice(0, 32);
  }
  return normalizeAesKey(aesKey);
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

async function readEncryptedBalance(
  provider: ethers.JsonRpcProvider,
  tokenAddress: string,
  account: string,
): Promise<unknown | null> {
  try {
    const flatContract = new ethers.Contract(tokenAddress, FLAT_BALANCE_ABI, provider);
    return await flatContract.balanceOf(account);
  } catch (error) {
    logger.warn('[validateAesKeyAgainstOnChainCiphertext] balanceOf read failed:', error);
    return null;
  }
}

function tryDecryptEncryptedBalance(
  encrypted: unknown,
  aesKey: string,
  decimals: number,
): boolean | null {
  const record = encrypted as Record<string, unknown>;
  const arrayValue = encrypted as ArrayLike<unknown>;
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

  let sawNonZeroCiphertext = false;
  let validated = false;

  await withRpcFallback(chainId, async provider => {
    for (const token of privateTokenConfigs) {
      if (!token.addressKey) continue;
      const tokenAddress = addresses[token.addressKey];
      if (!tokenAddress) continue;

      const publicSymbol = token.symbol.replace(/^p\./, '');
      const pubCfg = publicTokenConfigs.find(t => t.symbol === publicSymbol);
      if (pubCfg?.isNative) continue;

      const encrypted = await readEncryptedBalance(provider, tokenAddress, account);
      if (!encrypted) continue;

      const decryptResult = tryDecryptEncryptedBalance(encrypted, aesKey, token.decimals ?? 18);
      if (decryptResult === null) continue;

      sawNonZeroCiphertext = true;
      if (decryptResult) {
        logger.log(`[validateAesKeyAgainstOnChainCiphertext] key validated via ${token.symbol}`);
        validated = true;
        return;
      }
    }
  });

  if (validated) return;

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
    getSdkAesKeyHex(aesKey).toLowerCase(),
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
  return stored === getSdkAesKeyHex(aesKey).toLowerCase();
}

export function getValidatedAesKeyForUnlock(address: string): string | null {
  return validatedUnlockKeys.get(address.toLowerCase()) ?? null;
}
