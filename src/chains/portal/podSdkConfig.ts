import type { PodSdkConfig } from "@coti-io/pod-sdk";
import { COTI_TESTNET_CHAIN_ID, SEPOLIA_CHAIN_ID } from "../../contracts/pod";
import { getPluginConfig, type CotiPluginConfig } from "../../config/plugin";
import { AVALANCHE_FUJI_CHAIN_ID, getRpcUrlForChain } from "../index";
import { POD_INBOX_ADDRESS } from "../podInbox";

/** Source/target chains registered for PoD portal cross-chain tracking. */
const POD_TRACKING_CHAIN_ORDER = [
  SEPOLIA_CHAIN_ID,
  AVALANCHE_FUJI_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
] as const;

const POD_TRACKING_CHAIN_IDS = new Set<number>(POD_TRACKING_CHAIN_ORDER);

/** Shared PoD inbox on every registered tracking chain. */
export const getPodInboxAddress = (chainId: number): string => {
  if (!POD_TRACKING_CHAIN_IDS.has(chainId)) {
    throw new Error(`PoD inbox is not registered for chain ${chainId}`);
  }
  return POD_INBOX_ADDRESS;
};

const resolvePodChainRpcUrl = (chainId: number, pluginConfig: CotiPluginConfig): string => {
  if (chainId === SEPOLIA_CHAIN_ID && pluginConfig.sepoliaRpcUrl) {
    return pluginConfig.sepoliaRpcUrl;
  }
  if (chainId === COTI_TESTNET_CHAIN_ID && pluginConfig.cotiTestnetRpcUrl) {
    return pluginConfig.cotiTestnetRpcUrl;
  }
  return getRpcUrlForChain(chainId);
};

export const getPodSdkConfig = (): PodSdkConfig => {
  const pluginConfig = getPluginConfig();
  return {
    encryptionNetwork: "testnet",
    chains: POD_TRACKING_CHAIN_ORDER.map(chainId => ({
      chainId,
      inboxAddress: POD_INBOX_ADDRESS,
      rpcUrl: resolvePodChainRpcUrl(chainId, pluginConfig),
    })),
  };
};

/** @deprecated Use getPodSdkConfig() for fresh RPC URLs from plugin config. */
export const podSdkConfig: PodSdkConfig = getPodSdkConfig();
