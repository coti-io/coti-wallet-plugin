import { describe, it, expect, vi, beforeEach } from 'vitest';

// `ethers` is a frozen ESM namespace, so `vi.spyOn` cannot replace `Contract`.
// Mock the module, preserving the real surface but swapping in a controllable Contract.
const { mockEstimateFee } = vi.hoisted(() => ({ mockEstimateFee: vi.fn() }));
vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    constructor(..._args: unknown[]) {}
    estimateFee(...args: unknown[]) {
      return mockEstimateFee(...args);
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: MockContract } };
});

import { ethers } from 'ethers';
import {
  readPodEstimateFeeWei,
  parseMintRequestIdFromPodDeposit,
} from '../../../src/chains/portal/podFees';
import { getPrivateTokensForChain } from '../../../src/chains';
import {
  PRIVACY_PORTAL_ABI,
  SEPOLIA_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
} from '../../../src/contracts/pod';

function findChainWithPrivateToken() {
  for (const chainId of [SEPOLIA_CHAIN_ID, COTI_TESTNET_CHAIN_ID]) {
    const priv = getPrivateTokensForChain(chainId).find((t) => t.addressKey);
    if (priv) return { chainId, priv };
  }
  return null;
}

describe('podFees', () => {
  beforeEach(() => mockEstimateFee.mockReset());

  describe('readPodEstimateFeeWei', () => {
    const provider = {} as ethers.Provider;

    it('returns zero fees when no private token matches the symbol', async () => {
      const res = await readPodEstimateFeeWei(provider, SEPOLIA_CHAIN_ID, {}, 'NOPE');
      expect(res).toEqual({ totalFeeWei: 0n, callbackFeeWei: 0n });
    });

    it('returns zero fees when the address is missing from the addresses map', async () => {
      const found = findChainWithPrivateToken();
      if (!found) return;
      const symbol = found.priv.symbol.replace(/^p\./, '');
      const res = await readPodEstimateFeeWei(provider, found.chainId, {}, symbol);
      expect(res).toEqual({ totalFeeWei: 0n, callbackFeeWei: 0n });
    });

    it('reads totalFeeWei and callbackFeeWei from the pToken contract', async () => {
      const found = findChainWithPrivateToken();
      if (!found) return;
      const symbol = found.priv.symbol.replace(/^p\./, '');
      const addresses = { [found.priv.addressKey!]: '0x' + '1'.repeat(40) };
      mockEstimateFee.mockResolvedValue([100n, 50n, 25n]);
      const res = await readPodEstimateFeeWei(provider, found.chainId, addresses, symbol);
      expect(res).toEqual({ totalFeeWei: 100n, callbackFeeWei: 25n });
    });

    it('returns zero fees when the contract call returns an unexpected shape', async () => {
      const found = findChainWithPrivateToken();
      if (!found) return;
      const symbol = found.priv.symbol.replace(/^p\./, '');
      const addresses = { [found.priv.addressKey!]: '0x' + '1'.repeat(40) };
      // Malformed fee tuple makes the SUT's own `fee[0]` access throw inside its try/catch.
      mockEstimateFee.mockResolvedValue(undefined);
      const res = await readPodEstimateFeeWei(provider, found.chainId, addresses, symbol);
      expect(res).toEqual({ totalFeeWei: 0n, callbackFeeWei: 0n });
    });
  });

  describe('parseMintRequestIdFromPodDeposit', () => {
    const portal = '0x' + 'a'.repeat(40);
    const iface = new ethers.Interface(PRIVACY_PORTAL_ABI);
    const mintId = '0x' + '7'.repeat(64);

    const makeDepositLog = (address: string) => {
      const encoded = iface.encodeEventLog('DepositRequested', [
        '0x' + '1'.repeat(40),
        '0x' + '2'.repeat(40),
        1000n,
        mintId,
      ]);
      return { address, topics: encoded.topics, data: encoded.data };
    };

    it('extracts mintRequestId from a matching portal log', () => {
      const receipt = { logs: [makeDepositLog(portal)] } as unknown as ethers.TransactionReceipt;
      expect(parseMintRequestIdFromPodDeposit(receipt, portal)).toBe(mintId);
    });

    it('ignores logs emitted by other addresses', () => {
      const receipt = {
        logs: [makeDepositLog('0x' + 'b'.repeat(40))],
      } as unknown as ethers.TransactionReceipt;
      expect(parseMintRequestIdFromPodDeposit(receipt, portal)).toBeUndefined();
    });

    it('ignores logs that do not match the event shape', () => {
      const receipt = {
        logs: [{ address: portal, topics: ['0x' + '9'.repeat(64)], data: '0x' }],
      } as unknown as ethers.TransactionReceipt;
      expect(parseMintRequestIdFromPodDeposit(receipt, portal)).toBeUndefined();
    });

    it('returns undefined when there are no logs', () => {
      const receipt = { logs: [] } as unknown as ethers.TransactionReceipt;
      expect(parseMintRequestIdFromPodDeposit(receipt, portal)).toBeUndefined();
    });
  });
});
