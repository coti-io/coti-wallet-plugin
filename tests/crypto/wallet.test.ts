import { describe, it, expect } from 'vitest';
import { deriveWallet } from '../../src/crypto/wallet';

describe('Wallet Derivation (README: AES Key Management)', () => {
  const validKey = 'a'.repeat(32);
  const validAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const chainId = '2632500';

  it('derives a deterministic wallet from AES key, address, and chain ID', () => {
    const wallet1 = deriveWallet(validKey, validAddress, chainId);
    const wallet2 = deriveWallet(validKey, validAddress, chainId);
    expect(wallet1.address).toBe(wallet2.address);
    expect(wallet1.privateKey).toBe(wallet2.privateKey);
  });

  it('produces different wallets for different AES keys', () => {
    const wallet1 = deriveWallet('a'.repeat(32), validAddress, chainId);
    const wallet2 = deriveWallet('b'.repeat(32), validAddress, chainId);
    expect(wallet1.address).not.toBe(wallet2.address);
  });

  it('produces different wallets for different chain IDs', () => {
    const wallet1 = deriveWallet(validKey, validAddress, '2632500');
    const wallet2 = deriveWallet(validKey, validAddress, '7082400');
    expect(wallet1.address).not.toBe(wallet2.address);
  });

  it('produces different wallets for different addresses', () => {
    const wallet1 = deriveWallet(validKey, '0x1111111111111111111111111111111111111111', chainId);
    const wallet2 = deriveWallet(validKey, '0x2222222222222222222222222222222222222222', chainId);
    expect(wallet1.address).not.toBe(wallet2.address);
  });

  it('throws for invalid Ethereum address', () => {
    expect(() => deriveWallet(validKey, 'not-an-address', chainId)).toThrow('Invalid Ethereum address');
  });

  it('throws for invalid AES key', () => {
    expect(() => deriveWallet('invalid', validAddress, chainId)).toThrow();
  });

  it('accepts 0x-prefixed AES key', () => {
    const wallet = deriveWallet('0x' + validKey, validAddress, chainId);
    expect(wallet.address).toBeDefined();
  });
});
