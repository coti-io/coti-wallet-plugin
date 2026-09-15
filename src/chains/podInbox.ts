import { AVALANCHE_C_CHAIN_ID } from "./avalanche";
import { AVALANCHE_FUJI_CHAIN_ID } from "./avalancheFuji";
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from "./coti";
import { SEPOLIA_CHAIN_ID } from "./sepolia";

/**
 * PoD inbox contracts — CREATE3 families from pod-ecosystem-integration.
 *
 * Testnet (Sepolia, Fuji, COTI testnet): `pod.inbox.v2.4`.
 * Mainnet (Avalanche C-Chain, COTI mainnet): `pod.inbox.mainnet.v0.1`.
 *
 * Use {@link getPodInboxAddress} rather than a single constant. Ciphertext is bound
 * to the inbox on the encryption network; mixing families decrypts as garbage.
 */
export const POD_TESTNET_INBOX_ADDRESS = "0xB1D0D8fBfcafd16bfDc467D75B7e5fB1723B8069";

/** Shared CREATE3 inbox on Avalanche C-Chain (43114) and COTI mainnet (2632500). */
export const POD_MAINNET_INBOX_ADDRESS = "0x62B81447cf3D691cA98166225F889d4A22AF966d";

/**
 * @deprecated Testnet inbox only. Use {@link getPodInboxAddress} or {@link POD_TESTNET_INBOX_ADDRESS}.
 */
export const POD_INBOX_ADDRESS = POD_TESTNET_INBOX_ADDRESS;

/** @deprecated Use {@link POD_TESTNET_INBOX_ADDRESS}. */
export const COTI_TESTNET_POD_INBOX = POD_TESTNET_INBOX_ADDRESS;

/**
 * Default callback payload size (bytes) for inbox `estimateFee` when a chain config
 * omits `callBackDataSize`. Must be set together with `callBackGasLimit` per SDK rules.
 */
export const POD_DEFAULT_CALLBACK_DATA_SIZE = 1024n;

const POD_TESTNET_CHAIN_IDS = new Set<number>([
  SEPOLIA_CHAIN_ID,
  AVALANCHE_FUJI_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
]);

const POD_MAINNET_CHAIN_IDS = new Set<number>([
  AVALANCHE_C_CHAIN_ID,
  COTI_MAINNET_CHAIN_ID,
]);

/** True when `chainId` is Avalanche C-Chain or COTI mainnet (mainnet inbox + ES). */
export const isPodMainnetChain = (chainId: number): boolean =>
  POD_MAINNET_CHAIN_IDS.has(chainId);

/** True when `chainId` is a registered PoD tracking chain (either family). */
export const isPodTrackingChain = (chainId: number): boolean =>
  POD_TESTNET_CHAIN_IDS.has(chainId) || POD_MAINNET_CHAIN_IDS.has(chainId);

/** Inbox for fee estimate, encrypt binding, and `PodRequest` tracking. */
export const getPodInboxAddress = (chainId: number): string => {
  if (POD_MAINNET_CHAIN_IDS.has(chainId)) return POD_MAINNET_INBOX_ADDRESS;
  if (POD_TESTNET_CHAIN_IDS.has(chainId)) return POD_TESTNET_INBOX_ADDRESS;
  throw new Error(`PoD inbox is not registered for chain ${chainId}`);
};
