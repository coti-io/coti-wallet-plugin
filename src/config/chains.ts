import { defineChain } from 'viem'

export const cotiMainnet = defineChain({
  id: 2632500,
  name: 'COTI Mainnet',
  nativeCurrency: { name: 'COTI', symbol: 'COTI', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.coti.io/rpc'] } },
  blockExplorers: { default: { name: 'CotiScan', url: 'https://mainnet.cotiscan.io' } },
})

export const cotiTestnet = defineChain({
  id: 7082400,
  name: 'COTI Testnet',
  nativeCurrency: { name: 'COTI', symbol: 'COTI', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.coti.io/rpc'] } },
  blockExplorers: { default: { name: 'CotiScan', url: 'https://testnet.cotiscan.io' } },
})

export const sepolia = defineChain({
  id: 11155111,
  name: 'Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://ethereum-sepolia-rpc.publicnode.com'] } },
  blockExplorers: { default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' } },
})

export const COTI_MAINNET_CHAIN_ID = 2632500;
export const COTI_TESTNET_CHAIN_ID = 7082400;
export const SEPOLIA_CHAIN_ID = 11155111;

export const COTI_MAINNET_RPC = 'https://mainnet.coti.io/rpc';
export const COTI_TESTNET_RPC = 'https://testnet.coti.io/rpc';
export const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

export function getRpcUrlForChainId(chainId: number): string {
  if (chainId === COTI_MAINNET_CHAIN_ID) return COTI_MAINNET_RPC;
  if (chainId === SEPOLIA_CHAIN_ID) return SEPOLIA_RPC;
  return COTI_TESTNET_RPC;
}
