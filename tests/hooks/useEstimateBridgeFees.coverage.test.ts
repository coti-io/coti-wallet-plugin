import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  estimateDepositFee: vi.fn(),
  estimateWithdrawFee: vi.fn(),
}));

// Passthrough mock: keep ethers' real parseUnits/formatEther math while
// overriding Contract so the on-chain estimate calls are controllable.
vi.mock('ethers', async (importOriginal) => {
  const actual = (await importOriginal()) as { ethers: Record<string, unknown> };
  const real = actual.ethers;
  class Contract {
    estimateDepositFee = h.estimateDepositFee;
    estimateWithdrawFee = h.estimateWithdrawFee;
    constructor(_address: unknown, _abi: unknown, _provider: unknown) {}
  }
  return { ethers: { ...real, Contract } };
});

import { ethers } from 'ethers';
import { estimateBridgeFee } from '../../src/hooks/useEstimateBridgeFees';

const COTI_TESTNET = 7082400;
const COTI_MAINNET = 2632500; // present in CONTRACT_ADDRESSES but with empty bridge addresses
const UNKNOWN_CHAIN = 999999;

 
const providerForChain = (chainId: number) => ({
  getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(chainId) }),
   
}) as any;

describe('estimateBridgeFee (coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ERROR_ESTIMATE for a symbol without metadata', async () => {
    const res = await estimateBridgeFee('NOPE', '1', providerForChain(COTI_TESTNET));
    expect(res.depositFee).toBe('Error');
  });

  it('returns ERROR_ESTIMATE when the chain has no contract addresses', async () => {
    const res = await estimateBridgeFee('COTI', '1', providerForChain(UNKNOWN_CHAIN));
    expect(res.depositFee).toBe('Error');
  });

  it('returns ERROR_ESTIMATE when the bridge address is missing for the chain', async () => {
    const res = await estimateBridgeFee('COTI', '1', providerForChain(COTI_MAINNET));
    expect(res.depositFee).toBe('Error');
  });

  it('formats the native 3-tuple deposit and withdraw estimates', async () => {
    h.estimateDepositFee.mockResolvedValue([ethers.parseEther('1'), 5n, 9n]);
    h.estimateWithdrawFee.mockResolvedValue([ethers.parseEther('2'), 6n, 10n]);
    const res = await estimateBridgeFee('COTI', '100', providerForChain(COTI_TESTNET));
    expect(res.depositFee).toBe('1.0');
    expect(res.withdrawFee).toBe('2.0');
    expect(res.cotiLastUpdated).toBe('5');
    expect(res.tokenLastUpdated).toBe('5');
    expect(res.blockTimestamp).toBe('9');
  });

  it('uses the native [0n,0n,0n] fallback when estimate calls reject', async () => {
    h.estimateDepositFee.mockRejectedValue(new Error('rpc'));
    h.estimateWithdrawFee.mockRejectedValue(new Error('rpc'));
    const res = await estimateBridgeFee('COTI', '100', providerForChain(COTI_TESTNET));
    expect(res.depositFee).toBe('0.0');
    expect(res.cotiLastUpdated).toBe('0');
  });

  it('formats the ERC-20 4-tuple deposit and withdraw estimates', async () => {
    h.estimateDepositFee.mockResolvedValue([ethers.parseEther('1'), 5n, 7n, 9n]);
    h.estimateWithdrawFee.mockResolvedValue([ethers.parseEther('2'), 6n, 8n, 10n]);
    const res = await estimateBridgeFee('WETH', '1', providerForChain(COTI_TESTNET));
    expect(res.depositFee).toBe('1.0');
    expect(res.cotiLastUpdated).toBe('5');
    expect(res.tokenLastUpdated).toBe('7');
    expect(res.blockTimestamp).toBe('9');
  });

  it('uses the ERC-20 [0n,0n,0n,0n] fallback when estimate calls reject', async () => {
    h.estimateDepositFee.mockRejectedValue(new Error('rpc'));
    h.estimateWithdrawFee.mockRejectedValue(new Error('rpc'));
    const res = await estimateBridgeFee('USDT', '100', providerForChain(COTI_TESTNET));
    expect(res.depositFee).toBe('0.0');
    expect(res.tokenLastUpdated).toBe('0');
  });

  it('returns ERROR_ESTIMATE when provider.getNetwork throws', async () => {
     
    const provider = { getNetwork: vi.fn().mockRejectedValue(new Error('rpc down')) } as any;
    const res = await estimateBridgeFee('COTI', '1', provider);
    expect(res.depositFee).toBe('Error');
  });
});
