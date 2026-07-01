import { describe, it, expect } from "vitest";
import { ethereumMainnetPortalChain } from "../../src/chains/ethereumMainnetPortal";
import { avalancheCChain } from "../../src/chains/avalancheCChain";
import {
  AVALANCHE_C_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  getPodPortalHostChainIds,
  getPodTrackingChainIds,
  getChainConfig,
} from "../../src/chains/index";
import { resolveTargetCotiChainId } from "../../src/chains/resolveTargetCotiChainId";
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from "../../src/chains/coti";
import { SEPOLIA_CHAIN_ID } from "../../src/chains/sepolia";

describe("mainnet PoD portal host chains", () => {
  it("registers Ethereum and Avalanche C with pod-privacy-portal strategy", () => {
    expect(getChainConfig(ETHEREUM_MAINNET_CHAIN_ID)?.portalStrategy).toBe("pod-privacy-portal");
    expect(getChainConfig(AVALANCHE_C_CHAIN_ID)?.portalStrategy).toBe("pod-privacy-portal");
    expect(ethereumMainnetPortalChain.unlockStrategy).toBe("manual-aes-key");
    expect(avalancheCChain.unlockStrategy).toBe("manual-aes-key");
  });

  it("lists all portal host chains including mainnet hosts", () => {
    const hosts = getPodPortalHostChainIds();
    expect(hosts).toContain(ETHEREUM_MAINNET_CHAIN_ID);
    expect(hosts).toContain(AVALANCHE_C_CHAIN_ID);
    expect(hosts).toContain(SEPOLIA_CHAIN_ID);
  });

  it("tracks only chains with configured inboxes plus their COTI targets", () => {
    const tracking = getPodTrackingChainIds();
    expect(tracking).toContain(SEPOLIA_CHAIN_ID);
    expect(tracking).toContain(COTI_TESTNET_CHAIN_ID);
    expect(tracking).not.toContain(ETHEREUM_MAINNET_CHAIN_ID);
    expect(tracking).not.toContain(COTI_MAINNET_CHAIN_ID);
  });

  it("maps mainnet portal hosts to COTI mainnet AES environment", () => {
    expect(resolveTargetCotiChainId(ETHEREUM_MAINNET_CHAIN_ID)).toBe(COTI_MAINNET_CHAIN_ID);
    expect(resolveTargetCotiChainId(AVALANCHE_C_CHAIN_ID)).toBe(COTI_MAINNET_CHAIN_ID);
  });
});
