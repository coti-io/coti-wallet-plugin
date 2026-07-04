import { ethers, type Eip1193Provider } from 'ethers';
import type { EncryptedAesBackup } from '../config/plugin';
import { getPluginConfig } from '../config/plugin';
import { getRpcUrlForChainId } from '../config/chains';

const AES_KEY_BACKUP_VAULT_ABI = [
  'function getBackup(address user) view returns (bool exists, uint8 version, bytes iv, bytes ciphertext, uint64 updatedAt)',
  'function setBackup(uint8 version, bytes iv, bytes ciphertext)',
];

const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const base64ToHex = (value: string) =>
  ethers.hexlify(Uint8Array.from(atob(value), char => char.charCodeAt(0)));

const bytesLikeToBase64 = (value: ethers.BytesLike) =>
  bytesToBase64(ethers.getBytes(value));

const localBackupKey = (address: string, chainId: number) =>
  `coti-wallet-plugin:aes-backup:${chainId}:${address.toLowerCase()}`;

const legacyExampleBackupKey = (address: string, chainId: number) =>
  `coti-example:aes-backup:${chainId}:${address.toLowerCase()}`;

const getLocalStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  return window.localStorage ?? null;
};

const fetchEncryptedAesBackupFromLocalStorage = (
  address: string,
  chainId: number,
): EncryptedAesBackup | null => {
  const storage = getLocalStorage();
  if (!storage) return null;

  const raw =
    storage.getItem(localBackupKey(address, chainId)) ??
    storage.getItem(legacyExampleBackupKey(address, chainId));
  if (!raw) return null;

  return JSON.parse(raw) as EncryptedAesBackup;
};

const saveEncryptedAesBackupToLocalStorage = (
  address: string,
  chainId: number,
  backup: EncryptedAesBackup,
): void => {
  const storage = getLocalStorage();
  if (!storage) return;
  storage.setItem(localBackupKey(address, chainId), JSON.stringify(backup));
};

export const getConfiguredAesKeyBackupVaultAddress = (): string | null => {
  const address = getPluginConfig().aesKeyBackupVaultAddress;
  if (!address) return null;
  if (!ethers.isAddress(address)) {
    throw new Error('Invalid AES backup vault address configured via aesKeyBackupVaultAddress.');
  }
  return address;
};

export async function fetchEncryptedAesBackupFromContract(
  address: string,
  chainId: number,
): Promise<EncryptedAesBackup | null> {
  const localBackup = fetchEncryptedAesBackupFromLocalStorage(address, chainId);
  if (localBackup) return localBackup;

  const vaultAddress = getConfiguredAesKeyBackupVaultAddress();
  if (!vaultAddress) return null;

  const provider = new ethers.JsonRpcProvider(getRpcUrlForChainId(chainId), chainId);
  const vault = new ethers.Contract(vaultAddress, AES_KEY_BACKUP_VAULT_ABI, provider);
  const backup = await vault.getBackup(address);

  if (!backup.exists) return null;

  return {
    version: Number(backup.version) as 1,
    address: address.toLowerCase(),
    chainId,
    signatureKind: 'eip712',
    iv: bytesLikeToBase64(backup.iv),
    ciphertext: bytesLikeToBase64(backup.ciphertext),
    createdAt: new Date(Number(backup.updatedAt) * 1000).toISOString(),
  };
}

export async function saveEncryptedAesBackupToContract(params: {
  address: string;
  chainId: number;
  backup: EncryptedAesBackup;
  provider: Eip1193Provider;
}): Promise<string | null> {
  const { address, chainId, backup, provider: eip1193 } = params;
  saveEncryptedAesBackupToLocalStorage(address, chainId, backup);

  const vaultAddress = getConfiguredAesKeyBackupVaultAddress();
  if (!vaultAddress) return null;

  const contractInterface = new ethers.Interface(AES_KEY_BACKUP_VAULT_ABI);
  const data = contractInterface.encodeFunctionData('setBackup', [
    backup.version,
    base64ToHex(backup.iv),
    base64ToHex(backup.ciphertext),
  ]);

  const txHash = await eip1193.request({
    method: 'eth_sendTransaction',
    params: [{ from: address, to: vaultAddress, data }],
  }) as string;

  const browserProvider = new ethers.BrowserProvider(eip1193);
  const receipt = await browserProvider.waitForTransaction(txHash);
  if (!receipt || receipt.status !== 1) {
    throw new Error('Encrypted AES backup transaction failed.');
  }

  return txHash;
}
