import type { Token } from './types';

export interface UsePrivacyBridgeGasOptions {
  isConnected: boolean;
  walletAddress?: string;
  chainId?: number;
  publicTokens: Token[];
  selectedTokenIndex: number;
  direction: 'to-private' | 'to-public';
  amount: string;
}
