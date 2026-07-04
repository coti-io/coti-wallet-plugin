/**
 * @deprecated Import viem chains and RPC helpers from `../chains` or `../chains/viemChains` instead.
 * Re-exported for backward compatibility with existing `config/chains` import paths.
 */
export {
  cotiMainnet,
  cotiTestnet,
  sepolia,
  avalancheFuji,
  ethereumMainnet,
  ETHEREUM_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_RPC,
  COTI_MAINNET_RPC,
  COTI_TESTNET_RPC,
  SEPOLIA_RPC,
  SEPOLIA_RPC_FALLBACK,
  AVALANCHE_FUJI_RPC,
  AVALANCHE_FUJI_RPC_FALLBACK,
  getRpcUrlForChainId,
  chainConfigToViemChain,
} from '../chains/viemChains';

export { getRpcUrlsForChain } from '../chains';

export {
  COTI_MAINNET_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from '../chains';
