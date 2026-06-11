import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getPrice: vi.fn(),
  computeCotiFee: vi.fn(),
  computeErc20Fee: vi.fn(),
  depositFixedFee: vi.fn(),
  depositPercentageBps: vi.fn(),
  depositMaxFee: vi.fn(),
  withdrawFixedFee: vi.fn(),
  withdrawPercentageBps: vi.fn(),
  withdrawMaxFee: vi.fn(),
  jsonRpcCtor: vi.fn(),
  contractCtor: vi.fn(),
}));

// Passthrough mock: keep ethers' real fixed-point math (parseEther/formatEther/
// parseUnits/WeiPerEther) so the pure fee-computation helpers run for real,
// while overriding Contract/providers so on-chain calls are controllable.
vi.mock('ethers', async (importOriginal) => {
  const actual = (await importOriginal()) as { ethers: Record<string, unknown> };
  const real = actual.ethers;
  class JsonRpcProvider {
    constructor(url: unknown) {
      h.jsonRpcCtor(url);
    }
  }
  class BrowserProvider {
    constructor(_p: unknown) {}
  }
  class Contract {
    getPrice = h.getPrice;
    computeCotiFee = h.computeCotiFee;
    computeErc20Fee = h.computeErc20Fee;
    depositFixedFee = h.depositFixedFee;
    depositPercentageBps = h.depositPercentageBps;
    depositMaxFee = h.depositMaxFee;
    withdrawFixedFee = h.withdrawFixedFee;
    withdrawPercentageBps = h.withdrawPercentageBps;
    withdrawMaxFee = h.withdrawMaxFee;
    constructor(address: unknown, abi: unknown, provider: unknown) {
      h.contractCtor(address, abi, provider);
    }
  }
  return { ethers: { ...real, JsonRpcProvider, BrowserProvider, Contract } };
});

import { ethers } from 'ethers';
import {
  fetchTokenUsdPrice,
  fetchBridgeFees,
  simulateFeeOnChain,
  computeCotiFee,
  computeErc20Fee,
  getTokenSimulationMeta,
} from '../../src/hooks/useBridgeFees';

const COTI_TESTNET = 7082400;
const ADDR = '0xbridge';
 
const anyProvider = {} as any;

describe('useBridgeFees on-chain helpers (coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Pure fee computation (real ethers math) ────────────────────────────

  describe('computeCotiFee / computeErc20Fee branch coverage', () => {
    it('returns the fixed fee floor when the percentage fee is lower', () => {
      expect(parseFloat(computeCotiFee('10', '5', '0', '100', 0.1))).toBe(5.0);
    });

    it('returns the percentage fee when it exceeds the fixed floor', () => {
      expect(parseFloat(computeCotiFee('1000', '1', '10000', '100', 1.0))).toBe(10.0);
    });

    it('caps the COTI fee at the max', () => {
      expect(parseFloat(computeCotiFee('100000', '1', '100000', '50', 1.0))).toBe(50.0);
    });

    it('returns 0 when the COTI price is 0', () => {
      expect(parseFloat(computeCotiFee('100', '0', '10000', '100', 0))).toBe(0.0);
    });

    it('computes ERC-20 fees, caps at max, and handles zero price', () => {
      expect(parseFloat(computeErc20Fee('1', 18, '10', '5000', '3000', 3000, 0.1))).toBe(150.0);
      expect(parseFloat(computeErc20Fee('1000000', 6, '1', '100000', '50', 1.0, 0.1))).toBe(50.0);
      expect(parseFloat(computeErc20Fee('100', 18, '0', '10000', '100', 1.0, 0))).toBe(0.0);
    });
  });

  describe('getTokenSimulationMeta', () => {
    it('maps known symbols', () => {
      expect(getTokenSimulationMeta('WETH')).toEqual({ oracleSymbol: 'ETH', decimals: 18 });
      expect(getTokenSimulationMeta('WBTC')).toEqual({ oracleSymbol: 'WBTC', decimals: 8 });
    });

    it('falls back to the raw symbol and 18 decimals for unknown tokens', () => {
      expect(getTokenSimulationMeta('ZZZ')).toEqual({ oracleSymbol: 'ZZZ', decimals: 18 });
    });
  });

  // ─── fetchTokenUsdPrice ────────────────────────────────────────────────

  describe('fetchTokenUsdPrice', () => {
    it('returns null for an unmapped symbol', async () => {
      expect(await fetchTokenUsdPrice('NOPE')).toBeNull();
    });

    it('returns the parsed price using a provided provider and known chain', async () => {
      h.getPrice.mockResolvedValue(ethers.parseEther('2.5'));
      const price = await fetchTokenUsdPrice('WETH', anyProvider, COTI_TESTNET);
      expect(price).toBe(2.5);
      expect(h.jsonRpcCtor).not.toHaveBeenCalled();
      expect(h.getPrice).toHaveBeenCalledWith('ETH');
    });

    it('creates a JsonRpcProvider when none is supplied and falls back to the testnet oracle for an unknown chain', async () => {
      h.getPrice.mockResolvedValue(ethers.parseEther('1'));
      const price = await fetchTokenUsdPrice('COTI', undefined, 999999);
      expect(price).toBe(1);
      expect(h.jsonRpcCtor).toHaveBeenCalledTimes(1);
    });

    it('returns null and decodes a StaleOracleData revert', async () => {
      h.getPrice.mockRejectedValue({ revert: { name: 'StaleOracleData', args: [111n, 222n] } });
      expect(await fetchTokenUsdPrice('USDT', anyProvider, COTI_TESTNET)).toBeNull();
    });

    it('returns null using shortMessage when a non-revert error occurs', async () => {
      h.getPrice.mockRejectedValue({ shortMessage: 'execution reverted' });
      expect(await fetchTokenUsdPrice('WBTC', anyProvider, COTI_TESTNET)).toBeNull();
    });

    it('returns null using message when neither revert nor shortMessage is present', async () => {
      h.getPrice.mockRejectedValue({ message: 'boom' });
      expect(await fetchTokenUsdPrice('USDC', anyProvider, COTI_TESTNET)).toBeNull();
    });

    it('returns null with the generic fallback message for an opaque error', async () => {
      h.getPrice.mockRejectedValue({});
      expect(await fetchTokenUsdPrice('WADA', anyProvider, COTI_TESTNET)).toBeNull();
    });
  });

  // ─── fetchBridgeFees ───────────────────────────────────────────────────

  describe('fetchBridgeFees', () => {
    function setAllFees() {
      h.depositFixedFee.mockResolvedValue(ethers.parseEther('1'));
      h.depositPercentageBps.mockResolvedValue(50n);
      h.depositMaxFee.mockResolvedValue(ethers.parseEther('2'));
      h.withdrawFixedFee.mockResolvedValue(ethers.parseEther('3'));
      h.withdrawPercentageBps.mockResolvedValue(60n);
      h.withdrawMaxFee.mockResolvedValue(ethers.parseEther('4'));
    }

    it('returns formatted fees for the native bridge', async () => {
      setAllFees();
      const fees = await fetchBridgeFees(ADDR, true, anyProvider);
      expect(fees.depositPercentageBps).toBe('50');
      expect(fees.withdrawPercentageBps).toBe('60');
      expect(fees.depositFixedFee).toBe('1.0');
      expect(fees.withdrawMaxFee).toBe('4.0');
    });

    it('uses "0" fallbacks when every fee call fails (covers all six .catch arrows)', async () => {
      for (const key of [
        'depositFixedFee',
        'depositPercentageBps',
        'depositMaxFee',
        'withdrawFixedFee',
        'withdrawPercentageBps',
        'withdrawMaxFee',
      ] as const) {
        h[key].mockRejectedValue(new Error('rpc fail'));
      }
      const fees = await fetchBridgeFees(ADDR, false, anyProvider);
      expect(fees.depositFixedFee).toBe('0.0');
      expect(fees.depositPercentageBps).toBe('0');
      expect(fees.withdrawPercentageBps).toBe('0');
    });

    it('returns ERROR_FEES when an unexpected error is thrown', async () => {
      h.depositFixedFee.mockImplementation(() => {
        throw new Error('sync blow up');
      });
      const fees = await fetchBridgeFees(ADDR, true, anyProvider);
      expect(fees.depositFixedFee).toBe('Error');
      expect(fees.withdrawMaxFee).toBe('Error');
    });
  });

  // ─── simulateFeeOnChain ────────────────────────────────────────────────

  describe('simulateFeeOnChain', () => {
    it('applies the max fee cap explanation for the native bridge', async () => {
      h.computeCotiFee.mockResolvedValue(ethers.parseEther('3000'));
      const res = await simulateFeeOnChain(ADDR, '1', '10', '500', '3000', 'COTI', 18, anyProvider);
      expect(res.explanation).toBe('Max fee cap applied');
      expect(res.fee).toBe('3000.0000');
      expect(h.computeCotiFee).toHaveBeenCalled();
    });

    it('applies the fixed fee floor explanation', async () => {
      h.computeCotiFee.mockResolvedValue(ethers.parseEther('10'));
      const res = await simulateFeeOnChain(ADDR, '1', '10', '500', '3000', 'COTI', 18, anyProvider);
      expect(res.explanation).toBe('Fixed fee floor applied');
    });

    it('applies the percentage fee explanation for an ERC-20 bridge', async () => {
      h.computeErc20Fee.mockResolvedValue(ethers.parseEther('250'));
      const res = await simulateFeeOnChain(ADDR, '5', '10', '500', '3000', 'ETH', 18, anyProvider);
      expect(res.explanation).toBe('Percentage fee applied');
      expect(h.computeErc20Fee).toHaveBeenCalled();
    });

    it('handles empty fee inputs via the "0" defaults', async () => {
      h.computeErc20Fee.mockResolvedValue(ethers.parseEther('7'));
      const res = await simulateFeeOnChain(ADDR, '1', '', '', '', 'ETH', 6, anyProvider);
      expect(res.explanation).toBe('Percentage fee applied');
      expect(res.fee).toBe('7.0000');
    });

    it('returns the failure result when the contract call throws', async () => {
      h.computeCotiFee.mockRejectedValue(new Error('call reverted'));
      const res = await simulateFeeOnChain(ADDR, '1', '10', '500', '3000', 'COTI', 18, anyProvider);
      expect(res.fee).toBe('—');
      expect(res.explanation).toBe('Contract call failed');
    });
  });
});
