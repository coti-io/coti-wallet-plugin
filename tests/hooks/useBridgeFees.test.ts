import { describe, it, expect } from 'vitest';
import {
  computeCotiFee,
  computeErc20Fee,
  getTokenSimulationMeta,
  getRpcUrlForChainId,
} from '../../src/hooks/useBridgeFees';

describe('Bridge Fee Computation (README: Privacy Bridge)', () => {
  describe('computeCotiFee', () => {
    it('returns fixed fee when percentage fee is lower', () => {
      // 10 COTI, fixed=5 COTI, 0 bps, max=100 COTI, price=$0.10
      const fee = computeCotiFee('10', '5', '0', '100', 0.1);
      expect(parseFloat(fee)).toBe(5.0);
    });

    it('returns percentage fee when higher than fixed', () => {
      // 1000 COTI, fixed=1 COTI, 10000 bps (1%), max=100 COTI, price=$1
      const fee = computeCotiFee('1000', '1', '10000', '100', 1.0);
      expect(parseFloat(fee)).toBe(10.0);
    });

    it('caps at max fee', () => {
      // 100000 COTI, fixed=1, 100000 bps (10%), max=50, price=$1
      const fee = computeCotiFee('100000', '1', '100000', '50', 1.0);
      expect(parseFloat(fee)).toBe(50.0);
    });

    it('returns 0 when COTI price is 0', () => {
      const fee = computeCotiFee('100', '0', '10000', '100', 0);
      expect(parseFloat(fee)).toBe(0.0);
    });

    it('handles small amounts correctly', () => {
      const fee = computeCotiFee('0.1', '0.01', '10000', '100', 0.5);
      expect(parseFloat(fee)).toBeGreaterThanOrEqual(0.01);
    });
  });

  describe('computeErc20Fee', () => {
    it('computes fee for WETH (18 decimals)', () => {
      // 1 WETH, fixed=10 COTI, 5000 bps (0.5%), max=3000 COTI, WETH=$3000, COTI=$0.10
      const fee = computeErc20Fee('1', 18, '10', '5000', '3000', 3000, 0.1);
      // percentageFeeUsd = (1 * 3000 * 5000) / 1000000 = 15 USD
      // percentageFeeCoti = 15 / 0.1 = 150 COTI
      // max(150, 10) = 150, min(150, 3000) = 150
      expect(parseFloat(fee)).toBe(150.0);
    });

    it('computes fee for USDT (6 decimals)', () => {
      // 100 USDT, fixed=5 COTI, 5000 bps (0.5%), max=1000 COTI, USDT=$1, COTI=$0.10
      const fee = computeErc20Fee('100', 6, '5', '5000', '1000', 1.0, 0.1);
      // percentageFeeUsd = (100 * 1 * 5000) / 1000000 = 0.5 USD
      // percentageFeeCoti = 0.5 / 0.1 = 5 COTI
      // max(5, 5) = 5, min(5, 1000) = 5
      expect(parseFloat(fee)).toBe(5.0);
    });

    it('returns fixed fee when percentage is lower', () => {
      // 1 USDT, fixed=10 COTI, 100 bps, max=1000, USDT=$1, COTI=$0.10
      const fee = computeErc20Fee('1', 6, '10', '100', '1000', 1.0, 0.1);
      expect(parseFloat(fee)).toBe(10.0);
    });

    it('caps at max fee', () => {
      // 1000000 USDT, fixed=1, 100000 bps (10%), max=50, USDT=$1, COTI=$0.10
      const fee = computeErc20Fee('1000000', 6, '1', '100000', '50', 1.0, 0.1);
      expect(parseFloat(fee)).toBe(50.0);
    });

    it('returns 0 when COTI price is 0', () => {
      const fee = computeErc20Fee('100', 18, '0', '10000', '100', 1.0, 0);
      expect(parseFloat(fee)).toBe(0.0);
    });
  });

  describe('getTokenSimulationMeta', () => {
    it('returns correct oracle symbol for COTI', () => {
      const meta = getTokenSimulationMeta('COTI');
      expect(meta.oracleSymbol).toBe('COTI');
      expect(meta.decimals).toBe(18);
    });

    it('returns correct oracle symbol for WETH', () => {
      const meta = getTokenSimulationMeta('WETH');
      expect(meta.oracleSymbol).toBe('ETH');
      expect(meta.decimals).toBe(18);
    });

    it('returns correct oracle symbol for WBTC', () => {
      const meta = getTokenSimulationMeta('WBTC');
      expect(meta.oracleSymbol).toBe('WBTC');
      expect(meta.decimals).toBe(8);
    });

    it('returns correct oracle symbol for USDT', () => {
      const meta = getTokenSimulationMeta('USDT');
      expect(meta.oracleSymbol).toBe('USDT');
      expect(meta.decimals).toBe(6);
    });

    it('returns correct oracle symbol for USDC.e', () => {
      const meta = getTokenSimulationMeta('USDC.e');
      expect(meta.oracleSymbol).toBe('USDC');
      expect(meta.decimals).toBe(6);
    });

    it('defaults to 18 decimals for unknown tokens', () => {
      const meta = getTokenSimulationMeta('UNKNOWN');
      expect(meta.decimals).toBe(18);
    });
  });

  describe('getRpcUrlForChainId', () => {
    it('returns mainnet RPC for chain 2632500', () => {
      expect(getRpcUrlForChainId(2632500)).toBe('https://mainnet.coti.io/rpc');
    });

    it('returns testnet RPC for chain 7082400', () => {
      expect(getRpcUrlForChainId(7082400)).toBe('https://testnet.coti.io/rpc');
    });

    it('defaults to testnet for unknown chains', () => {
      expect(getRpcUrlForChainId()).toBe('https://testnet.coti.io/rpc');
    });
  });
});
