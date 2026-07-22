import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getFeeConfig: vi.fn(),
  accumulatedPortalFees: vi.fn(),
  balanceOf: vi.fn(),
  getBalance: vi.fn(),
  getBlockNumber: vi.fn(),
  getCode: vi.fn(),
  pauseController: vi.fn(),
  depositsPaused: vi.fn(),
  withdrawalsPaused: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    constructor(public address: string, _abi: unknown, _runner: unknown) {}
    getFeeConfig = (...a: unknown[]) => h.getFeeConfig(this.address, ...a);
    accumulatedPortalFees = () => h.accumulatedPortalFees(this.address);
    balanceOf = (...a: unknown[]) => h.balanceOf(this.address, ...a);
    pauseController = () => h.pauseController(this.address);
    depositsPaused = () => h.depositsPaused(this.address);
    withdrawalsPaused = () => h.withdrawalsPaused(this.address);
  }
  class MockProvider {
    constructor(public url: string) {}
    getBlockNumber = () => h.getBlockNumber(this.url);
    getBalance = (...a: unknown[]) => h.getBalance(...a);
    getCode = (...a: unknown[]) => h.getCode(...a);
  }
  return {
    ...actual,
    ethers: { ...actual.ethers, Contract: MockContract, JsonRpcProvider: MockProvider },
  };
});

import { sepoliaChain, SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';
import { COTI_TESTNET_CHAIN_ID } from '../../src/chains/coti';
import { fetchPodBridgeData } from '../../src/chains/portal/podPortalAdminData';

const FACTORY_ADDRESS = sepoliaChain.addresses.PrivacyPortalFactory;
const CODELESS_CONTROLLER = '0x1111111111111111111111111111111111111111';
const badDataError = () => Object.assign(new Error('could not decode result data'), { code: 'BAD_DATA' });

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
    h.depositsPaused.mockResolvedValue(false);
    h.withdrawalsPaused.mockResolvedValue(false);
    h.getCode.mockResolvedValue('0x1234');
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

  it('reads real depositsPaused/withdrawalsPaused off the factory controller, once per chain', async () => {
    h.pauseController.mockResolvedValue(FACTORY_ADDRESS);
    h.depositsPaused.mockResolvedValue(true);
    h.withdrawalsPaused.mockResolvedValue(false);

    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.depositsPaused).toBe(true);
      expect(row.withdrawalsPaused).toBe(false);
      expect(row.isPaused).toBe(true); // either flag paused -> isPaused
    }
    // Promise-cached per controller: 3 portals share one factory, one read each.
    expect(h.depositsPaused).toHaveBeenCalledTimes(1);
    expect(h.withdrawalsPaused).toHaveBeenCalledTimes(1);
  });

  it('reports unpaused when both factory flags are false', async () => {
    h.pauseController.mockResolvedValue(FACTORY_ADDRESS);
    h.depositsPaused.mockResolvedValue(false);
    h.withdrawalsPaused.mockResolvedValue(false);

    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    for (const row of rows) {
      expect(row.depositsPaused).toBe(false);
      expect(row.withdrawalsPaused).toBe(false);
      expect(row.isPaused).toBe(false);
    }
  });

  it('fails closed only for the flag whose read rejects, when the controller has code', async () => {
    h.pauseController.mockResolvedValue(FACTORY_ADDRESS);
    h.depositsPaused.mockRejectedValue(new Error('rpc timeout'));
    h.withdrawalsPaused.mockResolvedValue(false);
    h.getCode.mockResolvedValue('0xabc123'); // controller has code

    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    for (const row of rows) {
      expect(row.depositsPaused).toBe(true); // unobservable -> fail closed
      expect(row.withdrawalsPaused).toBe(false); // this one answered fine
      expect(row.isPaused).toBe(true);
    }
  });

  it('fails closed on both flags when the controller has code but neither call answers', async () => {
    h.pauseController.mockResolvedValue(FACTORY_ADDRESS);
    h.depositsPaused.mockRejectedValue(new Error('rpc timeout'));
    h.withdrawalsPaused.mockRejectedValue(new Error('rpc timeout'));
    h.getCode.mockResolvedValue('0xabc123');

    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    for (const row of rows) {
      expect(row.depositsPaused).toBe(true);
      expect(row.withdrawalsPaused).toBe(true);
      expect(row.isPaused).toBe(true);
    }
  });

  it('treats a code-less controller as unpaused even when both flag calls fail', async () => {
    h.pauseController.mockResolvedValue(CODELESS_CONTROLLER);
    h.depositsPaused.mockRejectedValue(new Error('no such contract'));
    h.withdrawalsPaused.mockRejectedValue(new Error('no such contract'));
    h.getCode.mockResolvedValue('0x'); // no bytecode at this address

    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    for (const row of rows) {
      expect(row.depositsPaused).toBe(false);
      expect(row.withdrawalsPaused).toBe(false);
      expect(row.isPaused).toBe(false);
    }
  });

  it('fails closed when getCode itself cannot be read (still unknown, not code-less)', async () => {
    h.pauseController.mockResolvedValue(FACTORY_ADDRESS);
    h.depositsPaused.mockRejectedValue(new Error('rpc timeout'));
    h.withdrawalsPaused.mockRejectedValue(new Error('rpc timeout'));
    h.getCode.mockRejectedValue(new Error('rpc down'));

    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    for (const row of rows) {
      expect(row.depositsPaused).toBe(true);
      expect(row.withdrawalsPaused).toBe(true);
      expect(row.isPaused).toBe(true);
    }
  });

  it('treats a BAD_DATA pauseController() call as "no pause mechanism" (unpaused)', async () => {
    h.pauseController.mockRejectedValue(badDataError());

    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    for (const row of rows) {
      expect(row.depositsPaused).toBe(false);
      expect(row.withdrawalsPaused).toBe(false);
      expect(row.isPaused).toBe(false);
    }
    // Genuinely no controller to read -> factory flags never touched.
    expect(h.depositsPaused).not.toHaveBeenCalled();
    expect(h.withdrawalsPaused).not.toHaveBeenCalled();
  });

  it('fails closed when pauseController() throws a non-BAD_DATA error', async () => {
    h.pauseController.mockRejectedValue(Object.assign(new Error('call reverted'), { code: 'CALL_EXCEPTION' }));

    const rows = await fetchPodBridgeData(SEPOLIA_CHAIN_ID);
    for (const row of rows) {
      expect(row.depositsPaused).toBe(true);
      expect(row.withdrawalsPaused).toBe(true);
      expect(row.isPaused).toBe(true);
    }
  });
});
