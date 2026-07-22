import { ethers, type TypedDataDomain, type TypedDataField } from 'ethers';
import { CotiErrorCode, CotiPluginError } from '../errors';

/**
 * Separate EIP-712 authentication for remote AES backup storage APIs.
 *
 * IMPORTANT: Never reuse the backup-wrapping signature (or its EIP-712 domain)
 * as an API bearer token. Auth signatures must use this distinct domain/purpose
 * and must be challenge-bound (nonce + expiry + audience + operation).
 *
 * See https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/aes-backup-security
 * and https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/aes-backup-remote-storage.
 */

export const AES_BACKUP_STORAGE_AUTH_DOMAIN_NAME = 'COTI AES Backup Storage Auth';
export const AES_BACKUP_STORAGE_AUTH_DOMAIN_VERSION = '1';
export const AES_BACKUP_STORAGE_AUTH_DOMAIN_SALT = ethers.keccak256(
  ethers.toUtf8Bytes('coti-aes-backup-storage-auth:v1'),
);

export type AesBackupStorageOperation = 'fetch' | 'save' | 'replace' | 'delete';

export interface AesBackupStorageAuthChallenge {
  /** Cryptographically random server nonce (hex, preferably ≥ 128 bits). */
  nonce: string;
  /** Unix timestamp (seconds) when the challenge was issued. */
  issuedAt: number;
  /** Unix timestamp (seconds) when the challenge expires. */
  expiresAt: number;
  /** API audience binding, e.g. `https://backups.example.com`. */
  audience: string;
  /** Wallet address that must authorize the operation. */
  address: string;
  /** COTI chain ID that owns the backup. */
  chainId: number;
  /** HTTP method the client will call (e.g. `GET`, `PUT`, `DELETE`). */
  method: string;
  /** Requested resource path or logical resource id. */
  resource: string;
  /** High-level storage operation. */
  operation: AesBackupStorageOperation;
}

export type AesBackupStorageAuthSigner = {
  signTypedData: (
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ) => Promise<string>;
};

const STORAGE_AUTH_TYPES = {
  AesBackupStorageAuth: [
    { name: 'purpose', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'audience', type: 'string' },
    { name: 'address', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'method', type: 'string' },
    { name: 'resource', type: 'string' },
    { name: 'operation', type: 'string' },
  ],
} satisfies Record<string, TypedDataField[]>;

const STORAGE_AUTH_PURPOSE =
  'Authorize one remote AES backup storage request. This is NOT the COTI privacy key backup unlock signature.';

export function getAesBackupStorageAuthDomain(): TypedDataDomain {
  return {
    name: AES_BACKUP_STORAGE_AUTH_DOMAIN_NAME,
    version: AES_BACKUP_STORAGE_AUTH_DOMAIN_VERSION,
    salt: AES_BACKUP_STORAGE_AUTH_DOMAIN_SALT,
  };
}

export function buildAesBackupStorageAuthMessage(
  challenge: AesBackupStorageAuthChallenge,
): Record<string, unknown> {
  return {
    purpose: STORAGE_AUTH_PURPOSE,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    audience: challenge.audience,
    address: challenge.address,
    chainId: challenge.chainId,
    method: challenge.method.toUpperCase(),
    resource: challenge.resource,
    operation: challenge.operation,
  };
}

export function buildAesBackupStorageAuthTypedData(
  challenge: AesBackupStorageAuthChallenge,
): {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  message: Record<string, unknown>;
} {
  assertAesBackupStorageAuthChallengeShape(challenge);
  return {
    domain: getAesBackupStorageAuthDomain(),
    types: STORAGE_AUTH_TYPES,
    message: buildAesBackupStorageAuthMessage(challenge),
  };
}

/**
 * Client helper: sign a server-issued storage auth challenge.
 * The resulting signature is a single-use authorization proof for that challenge only.
 */
export async function signAesBackupStorageAuthChallenge(
  signer: AesBackupStorageAuthSigner,
  challenge: AesBackupStorageAuthChallenge,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  assertAesBackupStorageAuthChallengeFresh(challenge, nowSeconds);
  const { domain, types, message } = buildAesBackupStorageAuthTypedData(challenge);
  return signer.signTypedData(domain, types, message);
}

/**
 * Server-side freshness checks before accepting a signed challenge.
 * Callers must also enforce single-use nonces (replay protection).
 */
export function assertAesBackupStorageAuthChallengeFresh(
  challenge: AesBackupStorageAuthChallenge,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  skewSeconds = 30,
): void {
  assertAesBackupStorageAuthChallengeShape(challenge);

  if (challenge.expiresAt <= challenge.issuedAt) {
    throw new CotiPluginError(
      CotiErrorCode.VALIDATION_ERROR,
      'AES backup storage auth challenge expiresAt must be after issuedAt.',
    );
  }
  if (nowSeconds + skewSeconds < challenge.issuedAt) {
    throw new CotiPluginError(
      CotiErrorCode.VALIDATION_ERROR,
      'AES backup storage auth challenge issuedAt is in the future.',
    );
  }
  if (nowSeconds - skewSeconds > challenge.expiresAt) {
    throw new CotiPluginError(
      CotiErrorCode.VALIDATION_ERROR,
      'AES backup storage auth challenge has expired.',
    );
  }
}

function assertAesBackupStorageAuthChallengeShape(
  challenge: AesBackupStorageAuthChallenge,
): void {
  const operations: AesBackupStorageOperation[] = ['fetch', 'save', 'replace', 'delete'];
  if (!operations.includes(challenge.operation)) {
    throw new CotiPluginError(
      CotiErrorCode.VALIDATION_ERROR,
      `Unsupported AES backup storage operation: ${String(challenge.operation)}`,
    );
  }
  if (!challenge.nonce?.trim()) {
    throw new CotiPluginError(
      CotiErrorCode.VALIDATION_ERROR,
      'AES backup storage auth challenge requires a nonce.',
    );
  }
  if (!challenge.audience?.trim()) {
    throw new CotiPluginError(
      CotiErrorCode.VALIDATION_ERROR,
      'AES backup storage auth challenge requires an audience.',
    );
  }
  if (!challenge.resource?.trim()) {
    throw new CotiPluginError(
      CotiErrorCode.VALIDATION_ERROR,
      'AES backup storage auth challenge requires a resource.',
    );
  }
  if (!challenge.method?.trim()) {
    throw new CotiPluginError(
      CotiErrorCode.VALIDATION_ERROR,
      'AES backup storage auth challenge requires an HTTP method.',
    );
  }
  if (!Number.isFinite(challenge.issuedAt) || !Number.isFinite(challenge.expiresAt)) {
    throw new CotiPluginError(
      CotiErrorCode.VALIDATION_ERROR,
      'AES backup storage auth challenge timestamps must be finite numbers.',
    );
  }
}
