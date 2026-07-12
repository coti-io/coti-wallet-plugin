import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  estimateDepositFees: vi.fn(),
  estimateFee: vi.fn(),
  estimateGas: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    constructor(_address: string, _abi: unknown, _runner: unknown) {}
    estimateDepositFees = (...a: unknown[]) => h.estimateDepositFees(...a);
    deposit = { estimateGas: (...a: unknown[]) => h.estimateGas(...a) };
    depositNative = { estimateGas: (...a: unknown[]) => h.estimateGas(...a) };
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: MockContract } };
});

vi.mock('@coti-io/pod-sdk', () => ({
  DataType: {
    String: 'string',
    Uint256: 'uint256',
    Uint8: 'uint8',
  },
  PodContract: class {
    estimateFee = (...args: unknown[]) => h.estimateFee(...args);
    contract = { getFunction: () => vi.fn() };
  },
  encodePodMethodArguments: vi.fn(async (args: unknown[]) => args),
}));

import { quotePodPortalTransactionFees } from '../../../src/chains/portal/fees';

const PORTAL = '0x' + 'a'.repeat(40);
const WALLET = '0x' + '1'.repeat(40);

const makeSigner = () => ({
  getAddress: vi.fn(async () => WALLET),
  provider: {
    send: vi.fn(async () => '0x' + (2_000_000_000).toString(16)),
    getFeeData: vi.fn(async () => ({ gasPrice: 2_000_000_000n })),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.estimateDepositFees.mockResolvedValue([100n, true, 2000n, 500n]);
  h.estimateFee.mockResolvedValue({ totalFee: 2100n, remoteFee: 1600n, callBackFee: 500n });
  h.estimateGas.mockResolvedValue(400_000n);
});

describe('quotePodPortalTransactionFees', () => {
  it('returns all fee components from a single gasPrice snapshot', async () => {
    const quote = await quotePodPortalTransactionFees({
      runner: makeSigner() as never,
      chainId: 11155111,
      portalAddress: PORTAL,
      pubTok: { symbol: 'ETH', name: 'Ether', icon: '', decimals: 18, isPrivate: false, isNative: true },
      amount: '1',
      direction: 'to-private',
    });

    expect(quote.portalFeeWei).toBe(100n);
    expect(quote.podInboxFeeWei).toBe(2100n);
    expect(quote.podCallbackFeeWei).toBe(500n);
    expect(quote.gasPrice).toBe(2_200_000_000n); // 10% buffer on 2 gwei
    expect(quote.l1ExecutionGasWei).toBe(400_000n * 2_200_000_000n);
    expect(quote.display.portalFee).toBe('0.0000000000000001');
    expect(quote.display.podInboxFee).toBe('0.0000000000000021');
    expect(quote.display.portalFeeSymbol).toBe('ETH');
    expect(h.estimateFee).toHaveBeenCalledTimes(1);
  });
});
