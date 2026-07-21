import { ethers, type TypedDataDomain, type TypedDataField } from 'ethers';
import type { EncryptedAesBackup } from '../config/plugin';
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

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const getDomain = (chainId: number): TypedDataDomain => ({
  name: BACKUP_DOMAIN_NAME,
  version: BACKUP_DOMAIN_VERSION,
  chainId,
  salt: BACKUP_DOMAIN_SALT,
});

const getMessage = ({ address, chainId }: AesBackupVaultContext) => ({
  purpose:
    'WARNING: signing derives the key that DECRYPTS your private COTI AES key backup. Only sign on the official COTI app.',
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
    toArrayBuffer(signatureBytes),
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(HKDF_SALT),
      info: toArrayBuffer(buildHkdfInfo(context)),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const signBackupContext = (signer: AesBackupSigner, context: AesBackupVaultContext) =>
  signer.signTypedData(getDomain(context.chainId), BACKUP_TYPES, getMessage(context));

const gcmParams = (iv: Uint8Array, context: AesBackupVaultContext): AesGcmParams => ({
  name: 'AES-GCM',
  iv: toArrayBuffer(iv),
  additionalData: toArrayBuffer(buildAdditionalData(context)),
});

/**
 * Maps an on-chain AesKeyBackupVault.getBackup() tuple into EncryptedAesBackup.
 * address and chainId must come from restore context (contract does not store them).
 */
export function backupFromChainTuple(params: {
  address: string;
  chainId: number;
  version: number;
  iv: string | Uint8Array;
  ciphertext: string | Uint8Array;
  updatedAt: number;
  keyEpoch?: number;
}): EncryptedAesBackup {
  if (params.version !== BACKUP_FORMAT_VERSION) {
    throw new Error(OUTDATED_AES_BACKUP_ERROR);
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
    createdAt: new Date(params.updatedAt * 1000).toISOString(),
    ...(params.keyEpoch !== undefined ? { keyEpoch: params.keyEpoch } : {}),
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
    throw new Error('AES backup self-test failed: round-trip key mismatch.');
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
    throw new Error(OUTDATED_AES_BACKUP_ERROR);
  }

  if (backup.address.toLowerCase() !== context.address.toLowerCase()) {
    throw new Error('AES backup address does not match connected wallet.');
  }

  if (backup.chainId !== context.chainId) {
    throw new Error('AES backup network does not match current COTI network.');
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
