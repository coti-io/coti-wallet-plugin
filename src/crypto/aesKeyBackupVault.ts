import { ethers, type TypedDataDomain, type TypedDataField } from 'ethers';
import type { EncryptedAesBackup } from '../config/plugin';
import { CotiErrorCode, CotiPluginError } from '../errors';
import { validateAesKey } from './aesKey';

export interface AesBackupSigner {
  signTypedData: (
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ) => Promise<string>;
}

export interface AesBackupVaultContext {
  address: string;
  chainId: number;
}

/** Thrown / matched when a v1 (or otherwise unsupported) backup is presented. */
export const OUTDATED_AES_BACKUP_ERROR =
  'Outdated AES backup format. Please re-onboard to create a new backup.';

/**
 * Stable code for wallets that cannot reproduce the backup-wrapping signature.
 * Prefer matching `CotiErrorCode.AES_BACKUP_WALLET_NOT_SUPPORTED` on thrown errors.
 */
export const AES_BACKUP_WALLET_NOT_SUPPORTED =
  CotiErrorCode.AES_BACKUP_WALLET_NOT_SUPPORTED;

/** User-facing EIP-712 purpose / UI warning for backup wrap signatures. */
export const AES_BACKUP_SIGNING_WARNING =
  'This signature unlocks your encrypted COTI privacy key backup. Only sign from an official or explicitly trusted COTI application.';

const BACKUP_PROTOCOL = 'coti-aes-backup';
const BACKUP_FORMAT_VERSION = 2 as const;
const BACKUP_DOMAIN_NAME = 'COTI AES Backup';
const BACKUP_DOMAIN_VERSION = '2';
const BACKUP_DOMAIN_SALT = ethers.keccak256(ethers.toUtf8Bytes('coti-aes-backup:v2'));
const HKDF_SALT = ethers.getBytes(
  ethers.keccak256(ethers.toUtf8Bytes('coti-aes-backup wrapping key v2')),
);

const BACKUP_TYPES = {
  AesBackup: [
    { name: 'purpose', type: 'string' },
    { name: 'address', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'version', type: 'uint256' },
  ],
} satisfies Record<string, TypedDataField[]>;

const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const base64ToBytes = (value: string) =>
  Uint8Array.from(atob(value), char => char.charCodeAt(0));

/** Copy into a standalone Uint8Array (SubtleCrypto BufferSource-safe across realms). */
const toBufferSource = (bytes: Uint8Array): BufferSource => {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
};

/** EIP-712 domain without chainId — wallets reject typed-data when domain.chainId
 *  differs from the active network, and backup restore/save often runs off COTI.
 *  Chain binding stays in the message, HKDF info, and AES-GCM AAD. */
const getDomain = (): TypedDataDomain => ({
  name: BACKUP_DOMAIN_NAME,
  version: BACKUP_DOMAIN_VERSION,
  salt: BACKUP_DOMAIN_SALT,
});

const getMessage = ({ address, chainId }: AesBackupVaultContext) => ({
  purpose: AES_BACKUP_SIGNING_WARNING,
  address,
  chainId,
  version: BACKUP_FORMAT_VERSION,
});

/** Canonical AAD — recomputed from restore context, never trusted from stored metadata alone. */
const buildAdditionalData = (context: AesBackupVaultContext): Uint8Array =>
  new TextEncoder().encode(
    `${BACKUP_PROTOCOL}|v${BACKUP_FORMAT_VERSION}|${context.address.toLowerCase()}|${context.chainId}`,
  );

const buildHkdfInfo = (context: AesBackupVaultContext): Uint8Array =>
  new TextEncoder().encode(
    `${BACKUP_PROTOCOL}|${context.address.toLowerCase()}|${context.chainId}|${BACKUP_FORMAT_VERSION}`,
  );

const deriveCryptoKey = async (
  signature: string,
  context: AesBackupVaultContext,
): Promise<CryptoKey> => {
  const signatureBytes = ethers.getBytes(signature);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(signatureBytes),
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toBufferSource(HKDF_SALT),
      info: toBufferSource(buildHkdfInfo(context)),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const signBackupContext = (signer: AesBackupSigner, context: AesBackupVaultContext) =>
  signer.signTypedData(getDomain(), BACKUP_TYPES, getMessage(context));

const gcmParams = (iv: Uint8Array, context: AesBackupVaultContext): AesGcmParams => ({
  name: 'AES-GCM',
  iv: toBufferSource(iv),
  additionalData: toBufferSource(buildAdditionalData(context)),
});

/**
 * Maps an on-chain AesKeyBackupVault.getBackup() tuple into EncryptedAesBackup.
 * address and chainId must come from restore context (contract does not store them).
 * Accepts number | bigint for ethers v6 Result fields (Solidity ints decode as bigint).
 *
 * Note: optional on-chain `keyEpoch` fields are intentionally ignored for v2.
 * Cryptographically binding key epochs is reserved for a future backup format version.
 */
export function backupFromChainTuple(params: {
  address: string;
  chainId: number;
  version: number | bigint;
  iv: string | Uint8Array;
  ciphertext: string | Uint8Array;
  updatedAt: number | bigint;
}): EncryptedAesBackup {
  const version = Number(params.version);
  if (!Number.isInteger(version) || version !== BACKUP_FORMAT_VERSION) {
    throw new CotiPluginError(
      CotiErrorCode.AES_BACKUP_OUTDATED,
      OUTDATED_AES_BACKUP_ERROR,
    );
  }

  const updatedAtSec = Number(params.updatedAt);
  if (!Number.isFinite(updatedAtSec)) {
    throw new CotiPluginError(
      CotiErrorCode.AES_BACKUP_CRYPTO_VALIDATION_FAILED,
      'Invalid AES backup updatedAt.',
    );
  }

  const ivBytes = typeof params.iv === 'string' ? ethers.getBytes(params.iv) : params.iv;
  const ciphertextBytes =
    typeof params.ciphertext === 'string'
      ? ethers.getBytes(params.ciphertext)
      : params.ciphertext;

  return {
    version: BACKUP_FORMAT_VERSION,
    address: params.address.toLowerCase(),
    chainId: params.chainId,
    signatureKind: 'eip712',
    kdf: 'hkdf-sha256',
    iv: bytesToBase64(ivBytes),
    ciphertext: bytesToBase64(ciphertextBytes),
    createdAt: new Date(updatedAtSec * 1000).toISOString(),
  };
}

export const encryptAesKeyBackup = async (
  aesKey: string,
  signer: AesBackupSigner,
  context: AesBackupVaultContext,
): Promise<EncryptedAesBackup> => {
  const normalizedKey = validateAesKey(aesKey);
  const signature = await signBackupContext(signer, context);
  const wrappingKey = await deriveCryptoKey(signature, context);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(normalizedKey);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(gcmParams(iv, context), wrappingKey, plaintext),
  );

  // In-memory round-trip: catches AAD/impl bugs before the blob is persisted.
  const roundTrip = await crypto.subtle.decrypt(
    gcmParams(iv, context),
    wrappingKey,
    ciphertext,
  );
  const roundTripKey = validateAesKey(new TextDecoder().decode(roundTrip));
  if (roundTripKey !== normalizedKey) {
    throw new CotiPluginError(
      CotiErrorCode.AES_BACKUP_CRYPTO_VALIDATION_FAILED,
      'AES backup self-test failed: round-trip key mismatch.',
    );
  }

  return {
    version: BACKUP_FORMAT_VERSION,
    address: context.address.toLowerCase(),
    chainId: context.chainId,
    signatureKind: 'eip712',
    kdf: 'hkdf-sha256',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    createdAt: new Date().toISOString(),
  };
};

export const decryptAesKeyBackup = async (
  backup: EncryptedAesBackup,
  signer: AesBackupSigner,
  context: AesBackupVaultContext,
): Promise<string> => {
  if (
    backup.version !== BACKUP_FORMAT_VERSION
    || backup.signatureKind !== 'eip712'
    || backup.kdf !== 'hkdf-sha256'
  ) {
    throw new CotiPluginError(
      CotiErrorCode.AES_BACKUP_OUTDATED,
      OUTDATED_AES_BACKUP_ERROR,
    );
  }

  if (backup.address.toLowerCase() !== context.address.toLowerCase()) {
    throw new CotiPluginError(
      CotiErrorCode.AES_BACKUP_CRYPTO_VALIDATION_FAILED,
      'AES backup address does not match connected wallet.',
    );
  }

  if (backup.chainId !== context.chainId) {
    throw new CotiPluginError(
      CotiErrorCode.AES_BACKUP_CRYPTO_VALIDATION_FAILED,
      'AES backup network does not match current COTI network.',
    );
  }

  const signature = await signBackupContext(signer, context);
  const wrappingKey = await deriveCryptoKey(signature, context);
  const decrypted = await crypto.subtle.decrypt(
    gcmParams(base64ToBytes(backup.iv), context),
    wrappingKey,
    base64ToBytes(backup.ciphertext),
  );

  return validateAesKey(new TextDecoder().decode(decrypted));
};
