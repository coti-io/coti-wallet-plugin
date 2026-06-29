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

const BACKUP_DOMAIN_NAME = 'COTI AES Backup';
const BACKUP_DOMAIN_VERSION = '1';

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

const getDomain = (): TypedDataDomain => ({
  name: BACKUP_DOMAIN_NAME,
  version: BACKUP_DOMAIN_VERSION,
});

const getMessage = ({ address, chainId }: AesBackupVaultContext) => ({
  purpose: 'Encrypt and decrypt your COTI AES key backup',
  address,
  chainId,
  version: 1,
});

const deriveCryptoKey = async (signature: string): Promise<CryptoKey> => {
  const signatureHash = ethers.keccak256(ethers.toUtf8Bytes(signature));
  const keyBytes = ethers.getBytes(signatureHash);
  const rawKey = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength,
  ) as ArrayBuffer;

  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
};

const signBackupContext = (signer: AesBackupSigner, context: AesBackupVaultContext) =>
  signer.signTypedData(getDomain(), BACKUP_TYPES, getMessage(context));

export const encryptAesKeyBackup = async (
  aesKey: string,
  signer: AesBackupSigner,
  context: AesBackupVaultContext,
): Promise<EncryptedAesBackup> => {
  const normalizedKey = validateAesKey(aesKey);
  const signature = await signBackupContext(signer, context);
  const wrappingKey = await deriveCryptoKey(signature);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      wrappingKey,
      new TextEncoder().encode(normalizedKey),
    ),
  );

  return {
    version: 1,
    address: context.address.toLowerCase(),
    chainId: context.chainId,
    signatureKind: 'eip712',
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
  if (backup.version !== 1 || backup.signatureKind !== 'eip712') {
    throw new Error('Unsupported AES backup format.');
  }

  if (backup.address.toLowerCase() !== context.address.toLowerCase()) {
    throw new Error('AES backup address does not match connected wallet.');
  }

  if (backup.chainId !== context.chainId) {
    throw new Error('AES backup network does not match current COTI network.');
  }

  const signature = await signBackupContext(signer, context);
  const wrappingKey = await deriveCryptoKey(signature);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(backup.iv) },
    wrappingKey,
    base64ToBytes(backup.ciphertext),
  );

  return validateAesKey(new TextDecoder().decode(decrypted));
};

