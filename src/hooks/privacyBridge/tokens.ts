import { getPrivateTokensForChain, getPublicTokensForChain } from '../../chains';
import type { Token } from './types';

export type { Token };

export const getInitialPublicTokens = (chainId?: number): Token[] =>
  getPublicTokensForChain(chainId).map(t => ({
    symbol: t.symbol,
    name: t.name,
    balance: '0.00',
    isPrivate: false,
    icon: t.icon,
    addressKey: t.addressKey,
    bridgeAddressKey: t.bridgeAddressKey,
    decimals: t.decimals,
    isNative: t.isNative,
    supportedChainIds: t.supportedChainIds,
  }));

export const getInitialPrivateTokens = (chainId?: number): Token[] =>
  getPrivateTokensForChain(chainId).map(t => ({
    symbol: t.symbol,
    name: t.name,
    balance: '0.00',
    isPrivate: true,
    icon: t.icon,
    addressKey: t.addressKey,
    bridgeAddressKey: t.bridgeAddressKey,
    decimals: t.decimals,
    supportedChainIds: t.supportedChainIds,
  }));
