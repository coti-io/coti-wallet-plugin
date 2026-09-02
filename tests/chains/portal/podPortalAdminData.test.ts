import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { COTI_TESTNET_CHAIN_ID } from '../../../src/chains/coti';
import { SEPOLIA_CHAIN_ID } from '../../../src/chains/sepolia';
import { POD_NO_MAX_FEE_SENTINEL } from '../../../src/chains/portal/podPortalAdminData';

const h = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  getBalance: vi.fn(),
  getFeeConfig: vi.fn(),
  accumulatedPortalFees: vi.fn(),
  paused: vi.fn(),
  isDepositEnabled: vi.fn(),
  minDepositAmount: vi.fn(),
  maxDepositAmount: vi.fn(),
  minWithdrawAmount: vi.fn(),
  maxWithdrawAmount: vi.fn(),
  balanceOf: vi.fn(),
  oracle: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class JsonRpcProvider {
    getBlockNumber = h.getBlockNumber;
    getBalance = h.getBalance;
  }
  class Contract {
    getFeeConfig = h.getFeeConfig;
    accumulatedPortalFees = h.accumulatedPortalFees;
    paused = h.paused;
    isDepositEnabled = h.isDepositEnabled;
    minDepositAmount = h.minDepositAmount;
    maxDepositAmount = h.maxDepositAmount;
    minWithdrawAmount = h.minWithdrawAmount;
    maxWithdrawAmount = h.maxWithdrawAmount;
    balanceOf = h.balanceOf;
  }
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider,
      Contract,
    },
  };
});

vi.mock('../../../src/chains/podPriceOracle', () => ({
  fetchPodOracleTokenUsdPrice: (...args: unknown[]) => h.oracle(...args),
}));

import {
  fetchPodBridgeData,
  simulatePodPortalFee,
} from '../../../src/chains/portal/podPortalAdminData';

describe('simulatePodPortalFee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unsupported-chain and unknown-token placeholders', async () => {
    await expect(simulatePodPortalFee(1, 'ETH', '1', '0', '0', '0')).resolves.toEqual({
      fee: '—',
      explanation: 'Unsupported chain',
    });
    await expect(simulatePodPortalFee(SEPOLIA_CHAIN_ID, 'NOPE', '1', '0', '0', '0')).resolves.toEqual({
      fee: '—',
      explanation: 'Unknown token',
    });
  });

  it('applies the native fixed-fee floor and a max-fee cap', async () => {
    const floor = await simulatePodPortalFee(SEPOLIA_CHAIN_ID, 'ETH', '1', '0.01', '0', '0');
    expect(floor).toEqual({ fee: '0.010000', explanation: 'Fixed fee floor applied' });

    const capped = await simulatePodPortalFee(SEPOLIA_CHAIN_ID, 'ETH', '100', '0.01', '50000', '0.02');
    expect(capped.explanation).toBe('Max fee cap applied');
    expect(capped.fee).toBe('0.020000');
  });

  it('uses oracle prices for ERC-20 amounts and falls back to the fixed fee when prices are missing', async () => {
    h.oracle.mockResolvedValueOnce(2).mockResolvedValueOnce(2000);
    const priced = await simulatePodPortalFee(SEPOLIA_CHAIN_ID, 'USDC', '1000', '0.001', '10000', '0');
    expect(priced.explanation).toBe('Percentage fee applied');
    expect(Number(priced.fee)).toBeGreaterThan(0);

    h.oracle.mockResolvedValue(null);
    const fallback = await simulatePodPortalFee(SEPOLIA_CHAIN_ID, 'USDC', '1', '0.05', '0', '0.01');
    expect(fallback).toEqual({
      fee: '0.010000',
      explanation: 'Fixed fee applied (no live oracle price)',
    });
  });

  it('returns a simulation-failed placeholder on invalid input', async () => {
    await expect(simulatePodPortalFee(SEPOLIA_CHAIN_ID, 'ETH', 'not-a-number', '0', '0', '0')).resolves.toEqual({
      fee: '—',
      explanation: 'Simulation failed',
    });
  });
});

describe('fetchPodBridgeData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getBlockNumber.mockResolvedValue(10);
    h.getBalance.mockResolvedValue(3n * 10n ** 18n);
    h.getFeeConfig.mockImplementation(async (isDeposit: boolean) => (
      isDeposit
        ? [10n ** 15n, 500n, POD_NO_MAX_FEE_SENTINEL]
        : [2n * 10n ** 15n, 250n, 10n ** 16n]
    ));
    h.accumulatedPortalFees.mockResolvedValue(10n ** 16n);
    h.paused.mockResolvedValue(false);
    h.isDepositEnabled.mockResolvedValue(true);
    h.minDepositAmount.mockResolvedValue(1n);
    h.maxDepositAmount.mockResolvedValue(POD_NO_MAX_FEE_SENTINEL);
    h.minWithdrawAmount.mockResolvedValue(2n);
    h.maxWithdrawAmount.mockResolvedValue(3n);
    h.balanceOf.mockResolvedValue(5n * 10n ** 18n);
  });

  it('returns an empty list for non-PoD chains', async () => {
    await expect(fetchPodBridgeData(COTI_TESTNET_CHAIN_ID)).resolves.toEqual([]);
  });

  it('maps portal fee configs and the no-cap sentinel onto BridgeData rows', async () => {
    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    expect(rows.length).toBeGreaterThan(0);
    const mtt = rows.find(row => row.publicToken === 'MTT');
    expect(mtt).toMatchObject({
      depositPercentageBps: '500',
      depositMaxFee: '0',
      withdrawMaxFee: ethers.formatEther(10n ** 16n),
      maxDepositAmount: '0',
      error: null,
    });
    expect(mtt?.bridgeBalance).toBe(ethers.formatUnits(5n * 10n ** 18n, 18));
  });

  it('tries the next RPC after a probe failure and returns [] when every RPC fails', async () => {
    h.getBlockNumber
      .mockRejectedValueOnce(new Error('primary down'))
      .mockResolvedValueOnce(11);
    const recovered = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    expect(recovered.length).toBeGreaterThan(0);

    h.getBlockNumber.mockRejectedValue(new Error('all down'));
    await expect(fetchPodBridgeData(SEPOLIA_CHAIN_ID)).resolves.toEqual([]);
  });

  it('returns Error fee fields when a portal row cannot be read', async () => {
    h.getFeeConfig.mockRejectedValue(new Error('portal reverted'));
    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    expect(rows[0]?.error).toBe('Failed to fetch portal data');
    expect(rows[0]?.depositFixedFee).toBe('Error');
  });
});
