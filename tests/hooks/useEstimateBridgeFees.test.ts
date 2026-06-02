import { describe, it, expect, vi } from 'vitest';
import { estimateBridgeFee } from '../../src/hooks/useEstimateBridgeFees';
import { ethers } from 'ethers';

describe('estimateBridgeFee (README: Privacy Bridge Fee Estimation)', () => {
  it('returns ERROR_ESTIMATE for unknown token symbol', async () => {
    const provider = new ethers.JsonRpcProvider('http://localhost:8545');
    const result = await estimateBridgeFee('UNKNOWN_TOKEN', '100', provider);
    expect(result.depositFee).toBe('Error');
    expect(result.withdrawFee).toBe('Error');
  });

  it('returns ERROR_ESTIMATE when provider has no matching chain', async () => {
    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 999n }),
    } as any;
    const result = await estimateBridgeFee('COTI', '100', mockProvider);
    expect(result.depositFee).toBe('Error');
    expect(result.withdrawFee).toBe('Error');
  });

  it('handles COTI (native, 18 decimals) — returns fallback fees on RPC failure', async () => {
    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 7082400n }),
    } as any;
    // Token metadata is found, contract call fails silently (.catch returns 0n),
    // so formatEther(0n) = '0.0'
    const result = await estimateBridgeFee('COTI', '100', mockProvider);
    expect(result.depositFee).toBe('0.0');
    expect(result.withdrawFee).toBe('0.0');
  });

  it('handles WETH (non-native, 18 decimals) — returns fallback fees on RPC failure', async () => {
    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 7082400n }),
    } as any;
    const result = await estimateBridgeFee('WETH', '1', mockProvider);
    expect(result.depositFee).toBe('0.0');
    expect(result.withdrawFee).toBe('0.0');
  });

  it('handles WBTC (non-native, 8 decimals) — returns fallback fees on RPC failure', async () => {
    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 7082400n }),
    } as any;
    const result = await estimateBridgeFee('WBTC', '0.5', mockProvider);
    expect(result.depositFee).toBe('0.0');
    expect(result.withdrawFee).toBe('0.0');
  });

  it('handles USDT (non-native, 6 decimals) — returns fallback fees on RPC failure', async () => {
    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 7082400n }),
    } as any;
    const result = await estimateBridgeFee('USDT', '100', mockProvider);
    expect(result.depositFee).toBe('0.0');
    expect(result.withdrawFee).toBe('0.0');
  });

  it('handles USDC.e (non-native, 6 decimals) — returns fallback fees on RPC failure', async () => {
    const mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 7082400n }),
    } as any;
    const result = await estimateBridgeFee('USDC.e', '100', mockProvider);
    expect(result.depositFee).toBe('0.0');
    expect(result.withdrawFee).toBe('0.0');
  });

  it('returns ERROR_ESTIMATE when getNetwork throws', async () => {
    const mockProvider = {
      getNetwork: vi.fn().mockRejectedValue(new Error('RPC timeout')),
    } as any;
    const result = await estimateBridgeFee('COTI', '100', mockProvider);
    expect(result.depositFee).toBe('Error');
    expect(result.withdrawFee).toBe('Error');
  });
});
