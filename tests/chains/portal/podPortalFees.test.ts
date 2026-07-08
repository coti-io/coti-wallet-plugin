import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

const h = vi.hoisted(() => ({
  estimateDepositFees: vi.fn(),
  estimateWithdrawFees: vi.fn(),
  estimateFee: vi.fn(),
  estimateGas: vi.fn(),
  sendFn: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    constructor(_address: string, _abi: unknown, _runner: unknown) {}
    estimateDepositFees = (...a: unknown[]) => h.estimateDepositFees(...a);
    estimateWithdrawFees = (...a: unknown[]) => h.estimateWithdrawFees(...a);
    deposit = { estimateGas: (...a: unknown[]) => h.estimateGas(...a) };
    depositNative = { estimateGas: (...a: unknown[]) => h.estimateGas(...a) };
    requestWithdrawWithPermit = { estimateGas: (...a: unknown[]) => h.estimateGas(...a) };
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
    contract = { getFunction: () => (...a: unknown[]) => h.sendFn(...a) };
  },
  encodePodMethodArguments: vi.fn(async (args: unknown[]) => args),
}));

import {
  buildPodMethodArgs,
  formatPodFeeDisplay,
  formatPortalFeeDisplay,
  quotePortalFeeOnly,
  resolvePodFeeEstimationConfig,
  resolvePodPortalMethod,
  estimatePodExecutionGasWei,
  sendPodPortalMethod,
} from '../../../src/chains/portal/podPortalFees';
import { POD_DEFAULT_CALLBACK_DATA_SIZE } from '../../../src/chains/podInbox';

const PORTAL = '0x' + 'a'.repeat(40);
const WALLET = '0x' + '1'.repeat(40);

const makeSigner = () => ({
  getAddress: vi.fn(async () => WALLET),
  provider: {
    send: vi.fn(async () => '0x' + (1_000_000_000).toString(16)),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.estimateDepositFees.mockResolvedValue([100n, true, 2000n, 500n]);
  h.estimateWithdrawFees.mockResolvedValue([200n, false, 3000n, 600n]);
  h.estimateFee.mockResolvedValue({ totalFee: 2100n, remoteFee: 1600n, callBackFee: 500n });
  h.estimateGas.mockResolvedValue(500_000n);
  h.sendFn.mockResolvedValue({ hash: '0xtx' });
});

describe('resolvePodFeeEstimationConfig', () => {
  it('pairs callBackGasLimit with default callBackDataSize', () => {
    const cfg = resolvePodFeeEstimationConfig(11155111, 'to-private', 1_000_000_000n);
    expect(cfg.forwardGasLimit).toBe(850_000n);
    expect(cfg.callBackGasLimit).toBe(2_000_000n);
    expect(cfg.callBackDataSize).toBe(POD_DEFAULT_CALLBACK_DATA_SIZE);
    expect(cfg.gasPrice).toBe(1_000_000_000n);
  });
});

describe('quotePortalFeeOnly', () => {
  it('reads deposit portal fee only', async () => {
    const quote = await quotePortalFeeOnly(makeSigner() as never, PORTAL, 1000n, 'to-private');
    expect(quote.portalFee).toBe(100n);
    expect(quote.usedDynamicPricing).toBe(true);
  });

  it('reads withdraw portal fee only', async () => {
    const quote = await quotePortalFeeOnly(makeSigner() as never, PORTAL, 1000n, 'to-public');
    expect(quote.portalFee).toBe(200n);
    expect(quote.usedDynamicPricing).toBe(false);
  });
});

describe('formatters', () => {
  it('formats portal and pod fees', () => {
    expect(formatPortalFeeDisplay(ethers.parseEther('0.05'), true)).toBe('0.05');
    expect(formatPodFeeDisplay(ethers.parseEther('0.0009'))).toBe('0.0009');
  });
});

describe('buildPodMethodArgs', () => {
  it('marks mint callback fee for deposits', () => {
    const args = buildPodMethodArgs({
      direction: 'to-private',
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 100n,
    });
    expect(args).toHaveLength(4);
    expect(args[3].isCallBackFee).toBe(true);
  });

  it('resolves portal methods', () => {
    expect(resolvePodPortalMethod('to-private', false)).toBe('deposit');
    expect(resolvePodPortalMethod('to-private', true)).toBe('depositNative');
    expect(resolvePodPortalMethod('to-public', false)).toBe('requestWithdrawWithPermit');
  });
});

describe('estimatePodExecutionGasWei', () => {
  it('returns gasLimit × gasPrice for deposits', async () => {
    const cost = await estimatePodExecutionGasWei({
      chainId: 11155111,
      portalAddress: PORTAL,
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 100n,
      direction: 'to-private',
      isNativeDeposit: false,
      gasPrice: 1_000_000_000n,
      podFee: { totalFee: 2100n, remoteFee: 1600n, callBackFee: 500n },
    });
    expect(cost).toBe(500_000_000_000_000n);
    // Simulation must fund the PoD fee on top of the portal fee or it reverts.
    const [, , , cbFee, overrides] = h.estimateGas.mock.calls[0] as [unknown, unknown, unknown, bigint, { value: bigint }];
    expect(cbFee).toBe(500n);
    expect(overrides.value).toBe(100n + 2100n);
  });

  it('simulates withdraws with transferFee equal to the full PoD fee', async () => {
    await estimatePodExecutionGasWei({
      chainId: 11155111,
      portalAddress: PORTAL,
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 200n,
      direction: 'to-public',
      isNativeDeposit: false,
      gasPrice: 1_000_000_000n,
      podFee: { totalFee: 2100n, remoteFee: 1600n, callBackFee: 500n },
      withdrawPermit: {
        wallet: WALLET,
        pTokenAddress: '0x' + '2'.repeat(40),
        portalAddress: PORTAL,
        amountWei: '1000',
        deadline: '999',
        v: 27,
        r: '0x' + '3'.repeat(64),
        s: '0x' + '4'.repeat(64),
      },
    });
    const call = h.estimateGas.mock.calls[0] as unknown[];
    expect(call[3]).toBe(2100n); // transferFee = remote + callback
    expect(call[4]).toBe(500n); // transferCallbackFee
    expect((call[9] as { value: bigint }).value).toBe(200n + 2100n);
  });

  it('falls back to configured gas limit when estimation reverts', async () => {
    h.estimateGas.mockRejectedValueOnce(new Error('revert'));
    const cost = await estimatePodExecutionGasWei({
      chainId: 11155111,
      portalAddress: PORTAL,
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 100n,
      direction: 'to-private',
      isNativeDeposit: false,
      gasPrice: 1_000_000_000n,
      podFee: { totalFee: 2100n, remoteFee: 1600n, callBackFee: 500n },
    });
    expect(cost).toBe(850_000_000_000_000n);
  });
});

describe('sendPodPortalMethod', () => {
  it('sets withdraw transferFee to the full PoD fee and lets the wallet price gas', async () => {
    const args = buildPodMethodArgs({
      direction: 'to-public',
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 200n,
    });
    await sendPodPortalMethod({
      runner: makeSigner() as never,
      portalAddress: PORTAL,
      chainId: 11155111,
      direction: 'to-public',
      method: 'requestWithdrawWithPermit',
      args,
      gasPrice: 1_000_000_000n,
      portalFee: 200n,
      gasLimit: 3_000_000n,
    });
    const call = h.sendFn.mock.calls[0] as unknown[];
    const overrides = call[call.length - 1] as Record<string, unknown>;
    expect(call[3]).toBe(2100n); // transferFee = msg.value - portalFee
    expect(call[4]).toBe(500n); // transferCallbackFee
    expect(overrides.value).toBe(200n + 2100n);
    expect(overrides.gasLimit).toBe(3_000_000n);
    // No gasPrice pin — a spot eth_gasPrice cap strands the tx when base fee rises.
    expect('gasPrice' in overrides).toBe(false);
  });

  it('funds deposits with native amount + portal fee + PoD fee', async () => {
    const args = buildPodMethodArgs({
      direction: 'to-private',
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 100n,
      isNativeDeposit: true,
    });
    await sendPodPortalMethod({
      runner: makeSigner() as never,
      portalAddress: PORTAL,
      chainId: 11155111,
      direction: 'to-private',
      method: 'depositNative',
      args,
      gasPrice: 1_000_000_000n,
      portalFee: 100n,
      amountWei: 1000n,
      isNativeDeposit: true,
    });
    const call = h.sendFn.mock.calls[0] as unknown[];
    const overrides = call[call.length - 1] as Record<string, unknown>;
    expect(call[3]).toBe(500n); // mintCallbackFee from the estimate
    expect(overrides.value).toBe(1000n + 100n + 2100n);
  });

  it('reuses a precomputed PoD fee without re-estimating', async () => {
    const args = buildPodMethodArgs({
      direction: 'to-private',
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 100n,
    });
    await sendPodPortalMethod({
      runner: makeSigner() as never,
      portalAddress: PORTAL,
      chainId: 11155111,
      direction: 'to-private',
      method: 'deposit',
      args,
      gasPrice: 1_000_000_000n,
      portalFee: 100n,
      fee: { totalFee: 42n, remoteFee: 40n, callBackFee: 2n },
    });
    expect(h.estimateFee).not.toHaveBeenCalled();
    const call = h.sendFn.mock.calls[0] as unknown[];
    expect(call[3]).toBe(2n);
    expect((call[call.length - 1] as { value: bigint }).value).toBe(100n + 42n);
  });
});
