import { ethers } from "ethers";
import { normalizeAesKey as normalizeSdkAesKey } from "./aesKey";

const VAULT_PREFIX = "pod:aes-key";
const SIGN_MESSAGE = "COTI Privacy Portal: unlock local AES key cache";

interface StoredAesKeyRecord {
  version: 1;
  address: string;
  iv: string;
  ciphertext: string;
}

const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const base64ToBytes = (value: string) =>
  Uint8Array.from(atob(value), char => char.charCodeAt(0));

const storageKey = (address: string) => `${VAULT_PREFIX}:${address.toLowerCase()}`;

const normalizeAddress = (address: string) => address.trim().toLowerCase();

const isStoredAesKeyRecord = (value: unknown): value is StoredAesKeyRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredAesKeyRecord>;
  return (
    record.version === 1 &&
    typeof record.address === "string" &&
    typeof record.iv === "string" &&
    typeof record.ciphertext === "string"
  );
};

const readCachedRecord = (address: string) => {
  if (typeof window === "undefined") return null;

  const normalizedAddress = normalizeAddress(address);
  const raw = window.localStorage.getItem(storageKey(normalizedAddress));
  if (!raw) return null;

  try {
    const record = JSON.parse(raw) as unknown;
    if (!isStoredAesKeyRecord(record)) return null;
    if (normalizeAddress(record.address) !== normalizedAddress) return null;
    return record;
  } catch {
    return null;
  }
};

const normalizeAesKey = (aesKey: string) => {
  const trimmedKey = aesKey.trim();
  return normalizeSdkAesKey(trimmedKey);
};

const getSignature = async (address: string): Promise<string> => {
  if (!window.ethereum) throw new Error("MetaMask is required to unlock the AES key cache.");

  return window.ethereum.request({
    method: "personal_sign",
    params: [SIGN_MESSAGE, address],
  }) as Promise<string>;
};

const deriveCryptoKey = async (signature: string): Promise<CryptoKey> => {
  const signatureHash = ethers.keccak256(ethers.toUtf8Bytes(signature));
  const keyBytes = ethers.getBytes(signatureHash);
  const rawKey = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength
  ) as ArrayBuffer;
  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
};

const getRandomHex = (size = 16) => {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
};

export const hasCachedAesKey = (address: string) => !!readCachedRecord(address);

export const saveAesKeyLocally = async (address: string, aesKey: string) => {
  const normalizedKey = normalizeAesKey(aesKey);

  const signature = await getSignature(address);
  const key = await deriveCryptoKey(signature);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(`${normalizedKey}-${getRandomHex()}`);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload));

  const record: StoredAesKeyRecord = {
    version: 1,
    address: normalizeAddress(address),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };

  window.localStorage.setItem(storageKey(address), JSON.stringify(record));
  return normalizedKey;
};

export const unlockCachedAesKey = async (address: string) => {
  const record = readCachedRecord(address);
  if (!record) return null;

  const signature = await getSignature(address);
  const key = await deriveCryptoKey(signature);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(record.iv) },
    key,
    base64ToBytes(record.ciphertext)
  );

  const payload = new TextDecoder().decode(decrypted);
  const separator = payload.lastIndexOf("-");
  return separator === -1 ? payload : payload.slice(0, separator);
};

export const clearCachedAesKey = (address: string) => {
  window.localStorage.removeItem(storageKey(address));
};
