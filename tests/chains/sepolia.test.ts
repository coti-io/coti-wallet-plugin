import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getFeeConfig: vi.fn(),
  accumulatedPortalFees: vi.fn(),
  balanceOf: vi.fn(),
  getBalance: vi.fn(),
  getBlockNumber: vi.fn(),
  pauseController: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    constructor(public address: string, _abi: unknown, _runner: unknown) {}
    getFeeConfig = (...a: unknown[]) => h.getFeeConfig(this.address, ...a);
    accumulatedPortalFees = () => h.accumulatedPortalFees(this.address);
    balanceOf = (...a: unknown[]) => h.balanceOf(this.address, ...a);
    pauseController = () => h.pauseController(this.address);
  }
  class MockProvider {
    constructor(public url: string) {}
    getBlockNumber = () => h.getBlockNumber(this.url);
    getBalance = (...a: unknown[]) => h.getBalance(...a);
  }
  return {
    ...actual,
    ethers: { ...actual.ethers, Contract: MockContract, JsonRpcProvider: MockProvider },
  };
});

import { sepoliaChain, SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';
import { COTI_TESTNET_CHAIN_ID } from '../../src/chains/coti';
import { fetchPodBridgeData } from '../../src/chains/portal/podPortalAdminData';

const U128_MAX = (1n << 128n) - 1n;

describe('chains/sepolia', () => {
  it('exposes the Sepolia chain ID', () => {
    expect(SEPOLIA_CHAIN_ID).toBe(11155111);
    expect(sepoliaChain.id).toBe(SEPOLIA_CHAIN_ID);
  });
});

describe('fetchPodBridgeData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getBlockNumber.mockResolvedValue(123);
    h.getFeeConfig.mockImplementation(async (_addr: string, isDeposit: boolean) =>
      isDeposit ? [10n ** 13n, 500n, 10n ** 17n] : [2n * 10n ** 13n, 300n, U128_MAX]
    );
    h.accumulatedPortalFees.mockResolvedValue(4n * 10n ** 13n);
    h.balanceOf.mockResolvedValue(5n * 10n ** 18n);
    h.getBalance.mockResolvedValue(7n * 10n ** 18n);
    h.pauseController.mockResolvedValue('0x0000000000000000000000000000000000000000');
  });

  it('shapes live portal reads into BridgeData rows', async () => {
    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    expect(rows).toHaveLength(3);

    const mtt = rows.find(r => r.publicToken === 'MTT')!;
    expect(mtt.bridgeName).toBe('MTT PoD Portal');
    expect(mtt.bridgeAddress).toBe(sepoliaChain.addresses.PrivacyPortalMTT);
    expect(mtt.privateToken).toBe('p.MTT');
    expect(mtt.depositFixedFee).toBe('0.00001');
    expect(mtt.depositPercentageBps).toBe('500');
    expect(mtt.depositMaxFee).toBe('0.1');
    expect(mtt.withdrawFixedFee).toBe('0.00002');
    expect(mtt.withdrawPercentageBps).toBe('300');
    expect(mtt.withdrawMaxFee).toBe('0'); // uint128.max sentinel → no cap
    expect(mtt.minDepositAmount).toBe('N/A');
    expect(mtt.feeTokenSymbol).toBe('ETH');
    expect(mtt.accumulatedCotiFees).toBe('0.00004');
    expect(mtt.bridgeBalance).toBe('5.0');
    expect(mtt.isPaused).toBe(false);
    expect(mtt.error).toBeNull();

    // Native ETH row reads the portal's native balance, not an ERC-20 balance
    const eth = rows.find(r => r.publicToken === 'ETH')!;
    expect(eth.bridgeAddress).toBe(sepoliaChain.addresses.PrivacyPortalETH);
    expect(eth.bridgeBalance).toBe('7.0');
  });

  it('returns error rows when a portal read fails', async () => {
    h.getFeeConfig.mockRejectedValue(new Error('boom'));
    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    expect(rows).toHaveLength(3);
    expect(rows[0].depositFixedFee).toBe('Error');
    expect(rows[0].error).toBe('Failed to fetch portal data');
  });

  it('returns an empty list for non-PoD chains', async () => {
    expect(await fetchPodBridgeData(COTI_TESTNET_CHAIN_ID)).toEqual([]);
  });
});
