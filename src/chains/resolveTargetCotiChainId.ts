import {
  cotiMainnetChain,
  cotiTestnetChain,
  COTI_MAINNET_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
} from "./coti";
import { SEPOLIA_CHAIN_ID } from "./sepolia";
import { AVALANCHE_FUJI_CHAIN_ID } from "./avalancheFuji";
import { AVALANCHE_C_CHAIN_ID } from "./avalancheCChain";
import { ETHEREUM_MAINNET_CHAIN_ID } from "./ethereumMainnetPortal";
import type { WalletNetworkConfig } from "./types";

export { AVALANCHE_C_CHAIN_ID } from "./avalancheCChain";

/** Host chains whose AES keys live on COTI mainnet. */
const HOST_MAINNET_CHAIN_IDS = new Set<number>([
  ETHEREUM_MAINNET_CHAIN_ID,
  AVALANCHE_C_CHAIN_ID,
  COTI_MAINNET_CHAIN_ID,
]);

/** Host testnets whose AES keys live on COTI testnet. */
const HOST_TESTNET_CHAIN_IDS = new Set<number>([
  SEPOLIA_CHAIN_ID,
  AVALANCHE_FUJI_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
]);

/**
 * Maps the wallet's current host chain to the COTI chain whose AES key environment applies.
 *
 * - On COTI mainnet or testnet → same chain
 * - Host testnets (Sepolia, Fuji, …) → COTI testnet
 * - Host mainnets (Ethereum, Avalanche C, …) → COTI mainnet
 */
export function resolveTargetCotiChainId(hostChainId: number): number {
  if (hostChainId === COTI_MAINNET_CHAIN_ID) return COTI_MAINNET_CHAIN_ID;
  if (hostChainId === COTI_TESTNET_CHAIN_ID) return COTI_TESTNET_CHAIN_ID;
  if (HOST_MAINNET_CHAIN_IDS.has(hostChainId)) return COTI_MAINNET_CHAIN_ID;
  if (HOST_TESTNET_CHAIN_IDS.has(hostChainId)) return COTI_TESTNET_CHAIN_ID;
  return COTI_TESTNET_CHAIN_ID;
}

/** Snap `set-environment` value for a host chain. */
export function resolveCotiSnapEnvironment(hostChainId: number): "mainnet" | "testnet" {
  return resolveTargetCotiChainId(hostChainId) === COTI_MAINNET_CHAIN_ID ? "mainnet" : "testnet";
}

/** Wallet `wallet_addEthereumChain` params for the target COTI network. */
export function getTargetCotiWalletNetwork(hostChainId: number): WalletNetworkConfig {
  const targetChainId = resolveTargetCotiChainId(hostChainId);
  return targetChainId === COTI_MAINNET_CHAIN_ID
    ? cotiMainnetChain.walletNetwork
    : cotiTestnetChain.walletNetwork;
}

export function getTargetCotiChainName(hostChainId: number): string {
  const targetChainId = resolveTargetCotiChainId(hostChainId);
  return targetChainId === COTI_MAINNET_CHAIN_ID ? "COTI Mainnet" : "COTI Testnet";
}
