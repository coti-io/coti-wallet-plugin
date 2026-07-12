import { describe, expect, it } from 'vitest';
import { getWalletDisplayName } from '../../src/lib/walletDisplayName';

describe('walletDisplayName', () => {
  it('formats known wallet names', () => {
    expect(getWalletDisplayName('coinbase')).toBe('Coinbase Wallet');
    expect(getWalletDisplayName('walletconnect')).toBe('WalletConnect');
    expect(getWalletDisplayName('metamask')).toBe('MetaMask');
    expect(getWalletDisplayName('rainbow')).toBe('Rainbow Wallet');
  });

  it('falls back to a generic wallet name', () => {
    expect(getWalletDisplayName('unknown')).toBe('your wallet');
  });
});
