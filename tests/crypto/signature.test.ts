import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { signDigest, buildItSignature, normalizeSignature } from '../../src/crypto/signature';

describe('Signature Utilities (README: AES Key Management)', () => {
  // Use a fixed private key to avoid randomness issues in jsdom
  const testPrivateKey = '0x' + 'ab'.repeat(32);
  const testWallet = new ethers.Wallet(testPrivateKey);
  const contractAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const functionSelector = '0x12345678';

  describe('signDigest', () => {
    it('produces a valid signature with r, s, v', () => {
      const digest = ethers.keccak256('0x1234');
      const sig = signDigest(testWallet.privateKey, digest);
      expect(sig.r).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(sig.s).toMatch(/^0x[0-9a-f]{64}$/i);
      expect([27, 28]).toContain(sig.v);
    });

    it('produces deterministic signatures', () => {
      const digest = ethers.keccak256('0xabcd');
      const sig1 = signDigest(testWallet.privateKey, digest);
      const sig2 = signDigest(testWallet.privateKey, digest);
      expect(sig1.r).toBe(sig2.r);
      expect(sig1.s).toBe(sig2.s);
      expect(sig1.v).toBe(sig2.v);
    });
  });

  describe('buildItSignature', () => {
    it('returns a 65-byte hex string (132 chars with 0x)', () => {
      const sig = buildItSignature(
        testWallet.address,
        contractAddress,
        functionSelector,
        12345n,
        testWallet.privateKey,
      );
      expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
    });

    it('normalizes v to 0x00 or 0x01', () => {
      const sig = buildItSignature(
        testWallet.address,
        contractAddress,
        functionSelector,
        12345n,
        testWallet.privateKey,
      );
      const vByte = sig.slice(-2);
      expect(['00', '01']).toContain(vByte);
    });
  });

  describe('normalizeSignature', () => {
    it('converts v=27 to 0x00', () => {
      const sig = { r: '0x' + 'a'.repeat(64), s: '0x' + 'b'.repeat(64), v: 27 };
      const result = normalizeSignature(sig);
      expect(result.endsWith('00')).toBe(true);
    });

    it('converts v=28 to 0x01', () => {
      const sig = { r: '0x' + 'a'.repeat(64), s: '0x' + 'b'.repeat(64), v: 28 };
      const result = normalizeSignature(sig);
      expect(result.endsWith('01')).toBe(true);
    });

    it('produces a 65-byte hex string', () => {
      const sig = { r: '0x' + 'a'.repeat(64), s: '0x' + 'b'.repeat(64), v: 27 };
      const result = normalizeSignature(sig);
      // 0x + 64 + 64 + 2 = 132 chars
      expect(result.length).toBe(132);
    });
  });
});
