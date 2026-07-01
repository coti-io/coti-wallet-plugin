import { describe, it, expect } from "vitest";
import {
  AVALANCHE_C_CHAIN_ID,
  getTargetCotiChainName,
  resolveCotiSnapEnvironment,
  resolveTargetCotiChainId,
} from "../../src/chains/resolveTargetCotiChainId";
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from "../../src/chains/coti";
import { SEPOLIA_CHAIN_ID } from "../../src/chains/sepolia";
import { AVALANCHE_FUJI_CHAIN_ID } from "../../src/chains/avalancheFuji";
import { ETHEREUM_MAINNET_CHAIN_ID } from "../../src/chains/viemChains";

describe("resolveTargetCotiChainId", () => {
  it("maps COTI chains to themselves", () => {
    expect(resolveTargetCotiChainId(COTI_MAINNET_CHAIN_ID)).toBe(COTI_MAINNET_CHAIN_ID);
    expect(resolveTargetCotiChainId(COTI_TESTNET_CHAIN_ID)).toBe(COTI_TESTNET_CHAIN_ID);
  });

  it("maps host testnets to COTI testnet", () => {
    expect(resolveTargetCotiChainId(SEPOLIA_CHAIN_ID)).toBe(COTI_TESTNET_CHAIN_ID);
    expect(resolveTargetCotiChainId(AVALANCHE_FUJI_CHAIN_ID)).toBe(COTI_TESTNET_CHAIN_ID);
  });

  it("maps host mainnets to COTI mainnet", () => {
    expect(resolveTargetCotiChainId(ETHEREUM_MAINNET_CHAIN_ID)).toBe(COTI_MAINNET_CHAIN_ID);
    expect(resolveTargetCotiChainId(AVALANCHE_C_CHAIN_ID)).toBe(COTI_MAINNET_CHAIN_ID);
  });

  it("defaults unknown chains to COTI testnet", () => {
    expect(resolveTargetCotiChainId(999999)).toBe(COTI_TESTNET_CHAIN_ID);
  });

  it("derives Snap environment from host chain", () => {
    expect(resolveCotiSnapEnvironment(SEPOLIA_CHAIN_ID)).toBe("testnet");
    expect(resolveCotiSnapEnvironment(ETHEREUM_MAINNET_CHAIN_ID)).toBe("mainnet");
    expect(resolveCotiSnapEnvironment(COTI_MAINNET_CHAIN_ID)).toBe("mainnet");
  });

  it("returns human-readable target chain names", () => {
    expect(getTargetCotiChainName(SEPOLIA_CHAIN_ID)).toBe("COTI Testnet");
    expect(getTargetCotiChainName(ETHEREUM_MAINNET_CHAIN_ID)).toBe("COTI Mainnet");
  });
});
