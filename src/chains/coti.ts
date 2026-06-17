import { getConfiguredChain } from "./config";

export const COTI_TESTNET_CHAIN_ID = 7082400;
export const COTI_MAINNET_CHAIN_ID = 2632500;

export const cotiTestnetChain = getConfiguredChain(COTI_TESTNET_CHAIN_ID);
export const cotiMainnetChain = getConfiguredChain(COTI_MAINNET_CHAIN_ID);
