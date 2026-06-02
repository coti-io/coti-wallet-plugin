import { describe, it, expect } from 'vitest';
import { LIMITS } from '../../src/contracts/limits';

describe('Bridge Limits (README: Privacy Bridge)', () => {
  it('has limits for USDC.e', () => {
    expect(LIMITS['USDC.e']).toBeDefined();
    expect(LIMITS['USDC.e'].min).toBe(5);
    expect(LIMITS['USDC.e'].max).toBe(100000);
  });

  it('has limits for WETH', () => {
    expect(LIMITS['WETH']).toBeDefined();
    expect(LIMITS['WETH'].min).toBe(0.0003);
    expect(LIMITS['WETH'].max).toBe(50);
  });

  it('has limits for WBTC', () => {
    expect(LIMITS['WBTC']).toBeDefined();
    expect(LIMITS['WBTC'].min).toBe(0.01);
    expect(LIMITS['WBTC'].max).toBe(5);
  });

  it('has limits for COTI', () => {
    expect(LIMITS['COTI']).toBeDefined();
    expect(LIMITS['COTI'].min).toBe(0.1);
    expect(LIMITS['COTI'].max).toBe(250000);
  });

  it('all limits have min < max', () => {
    for (const [symbol, limit] of Object.entries(LIMITS)) {
      expect(limit.min).toBeLessThan(limit.max);
    }
  });
});
