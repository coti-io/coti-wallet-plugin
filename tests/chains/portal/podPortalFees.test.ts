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
  buildPodPortalTxGasOverrides,
  formatPodFeeDisplay,
  formatPortalFeeDisplay,
  getPodGasPrice,
  POD_GAS_PRICE_BUFFER_BPS,
  quotePortalFeeOnly,
  resolvePodFeeEstimationConfig,
  resolvePodPortalMethod,
  resolvePodTxGasPrice,
  estimatePodExecutionGasWei,
  sendPodPortalMethod,
} from '../../../src/chains/portal/podPortalFees';
import { POD_DEFAULT_CALLBACK_DATA_SIZE } from '../../../src/chains/podInbox';

const PORTAL = '0x' + 'a'.repeat(40);
const WALLET = '0x' + '1'.repeat(40);

const makeProvider = (opts: {
  gasPriceWei?: bigint;
  baseFeePerGas?: bigint | null;
  getBlockError?: Error;
  sendError?: Error;
} = {}) => ({
  send: vi.fn(async () => {
    if (opts.sendError) throw opts.sendError;
    const wei = opts.gasPriceWei ?? 1_000_000_000n;
    return '0x' + wei.toString(16);
  }),
  getBlock: vi.fn(async () => {
    if (opts.getBlockError) throw opts.getBlockError;
    if (opts.baseFeePerGas === null) return null;
    return {
      baseFeePerGas: opts.baseFeePerGas === undefined ? null : opts.baseFeePerGas,
    };
  }),
});

const makeSigner = (opts: Parameters<typeof makeProvider>[0] & { omitProvider?: boolean } = {}) => {
  const provider = makeProvider(opts);
  if (opts.omitProvider) {
    return provider;
  }
  return {
    getAddress: vi.fn(async () => WALLET),
    provider,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  h.estimateDepositFees.mockResolvedValue([100n, true, 2000n, 500n]);
  h.estimateWithdrawFees.mockResolvedValue([200n, false, 3000n, 600n]);
  h.estimateFee.mockResolvedValue({ totalFee: 2100n, remoteFee: 1600n, callBackFee: 500n });
  h.estimateGas.mockResolvedValue(500_000n);
  h.sendFn.mockResolvedValue({ hash: '0xtx' });
});

describe('getPodGasPrice / resolvePodTxGasPrice', () => {
  it('reads spot gas price via eth_gasPrice', async () => {
    const provider = makeProvider({ gasPriceWei: 2_000_000_000n });
    await expect(getPodGasPrice(provider as never)).resolves.toBe(2_000_000_000n);
    expect(provider.send).toHaveBeenCalledWith('eth_gasPrice', []);
  });

  it('applies the 10% buffer with integer rounding', async () => {
    const provider = makeProvider({ gasPriceWei: 999n });
    const buffered = await resolvePodTxGasPrice(provider as never);
    expect(buffered).toBe((999n * POD_GAS_PRICE_BUFFER_BPS) / 1000n);
    expect(buffered).toBe(1098n);
  });

  it('handles very low and very high gas prices', async () => {
    const low = makeProvider({ gasPriceWei: 1n });
    await expect(resolvePodTxGasPrice(low as never)).resolves.toBe(1n);

    const highWei = 1_000_000_000_000n; // 1000 gwei
    const high = makeProvider({ gasPriceWei: highWei });
    await expect(resolvePodTxGasPrice(high as never)).resolves.toBe(
      (highWei * POD_GAS_PRICE_BUFFER_BPS) / 1000n,
    );
  });

  it('propagates eth_gasPrice RPC failures', async () => {
    const provider = makeProvider({
      sendError: new Error('RPC error: method not found'),
    });
    await expect(getPodGasPrice(provider as never)).rejects.toThrow('method not found');
  });
});

describe('resolvePodFeeEstimationConfig', () => {
  it('pairs callBackGasLimit with default callBackDataSize', () => {
    const cfg = resolvePodFeeEstimationConfig(11155111, 'to-private', 1_000_000_000n);
    expect(cfg.forwardGasLimit).toBe(850_000n);
    expect(cfg.callBackGasLimit).toBe(2_000_000n);
    expect(cfg.callBackDataSize).toBe(POD_DEFAULT_CALLBACK_DATA_SIZE);
    expect(cfg.gasPrice).toBe(1_000_000_000n);
  });

  it('uses withdraw limits for to-public direction', () => {
    const cfg = resolvePodFeeEstimationConfig(11155111, 'to-public', 5n);
    expect(cfg.forwardGasLimit).toBe(900_000n);
    expect(cfg.callBackGasLimit).toBe(2_000_000n);
    expect(cfg.gasPrice).toBe(5n);
  });

  it('throws for chains without PoD fee estimation config', () => {
    expect(() => resolvePodFeeEstimationConfig(1, 'to-private', 1n)).toThrow(
      'PoD fee estimation is not configured for chain 1',
    );
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

  it('uses an explicit gasPrice snapshot when provided', async () => {
    const signer = makeSigner({ gasPriceWei: 9_999n });
    const quote = await quotePortalFeeOnly(
      signer as never,
      PORTAL,
      0n,
      'to-private',
      42_000n,
    );
    expect(quote.gasPrice).toBe(42_000n);
    expect(signer.provider.send).not.toHaveBeenCalled();
  });

  it('resolves gas price from the runner provider when omitted', async () => {
    const signer = makeSigner({ gasPriceWei: 1_000n });
    const quote = await quotePortalFeeOnly(signer as never, PORTAL, 1n, 'to-private');
    expect(quote.gasPrice).toBe(1100n);
    expect(signer.provider.send).toHaveBeenCalledWith('eth_gasPrice', []);
  });

  it('works when the runner is the provider itself', async () => {
    const provider = makeProvider({ gasPriceWei: 2_000n });
    const quote = await quotePortalFeeOnly(provider as never, PORTAL, 1n, 'to-public', 77n);
    expect(quote.gasPrice).toBe(77n);
    expect(quote.portalFee).toBe(200n);
  });
});

describe('formatters', () => {
  it('formats portal and pod fees', () => {
    expect(formatPortalFeeDisplay(ethers.parseEther('0.05'), true)).toBe('0.05');
    expect(formatPodFeeDisplay(ethers.parseEther('0.0009'))).toBe('0.0009');
  });

  it('formats zero and strips trailing zeros', () => {
    expect(formatPortalFeeDisplay(0n)).toBe('0');
    expect(formatPodFeeDisplay(0n)).toBe('0');
    expect(formatPortalFeeDisplay(ethers.parseEther('1'))).toBe('1');
    expect(formatPodFeeDisplay(ethers.parseEther('1.5000'))).toBe('1.5');
  });

  it('formats very small and very large wei amounts', () => {
    expect(formatPortalFeeDisplay(1n)).toBe('0.000000000000000001');
    expect(formatPodFeeDisplay(ethers.parseEther('1000000'))).toBe('1000000');
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

  it('includes zero portal fees and max uint-sized amounts', () => {
    const maxUint = 2n ** 256n - 1n;
    const args = buildPodMethodArgs({
      direction: 'to-private',
      wallet: WALLET,
      amountWei: maxUint,
      portalFee: 0n,
    });
    expect(args[1].value).toBe(maxUint.toString());
    expect(args[2].value).toBe('0');
  });

  it('uses a real withdraw permit when wallet and amount match', () => {
    const permit = {
      wallet: WALLET,
      pTokenAddress: '0x' + '2'.repeat(40),
      portalAddress: PORTAL,
      amountWei: '1000',
      deadline: '1700000000',
      v: 28,
      r: '0x' + '3'.repeat(64),
      s: '0x' + '4'.repeat(64),
    };
    const args = buildPodMethodArgs({
      direction: 'to-public',
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 200n,
      withdrawPermit: permit,
      remoteFee: 1600n,
    });
    expect(args).toHaveLength(9);
    expect(args[3].value).toBe('1600');
    expect(args[5].value).toBe('1700000000');
    expect(args[6].value).toBe('28');
    expect(args[7].value).toBe(permit.r);
    expect(args[8].value).toBe(permit.s);
  });

  it('falls back to placeholder permit fields when permit does not match', () => {
    const args = buildPodMethodArgs({
      direction: 'to-public',
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 200n,
      withdrawPermit: {
        wallet: '0x' + '9'.repeat(40),
        pTokenAddress: '0x' + '2'.repeat(40),
        portalAddress: PORTAL,
        amountWei: '999',
        deadline: '1700000000',
        v: 27,
        r: '0x' + '3'.repeat(64),
        s: '0x' + '4'.repeat(64),
      },
    });
    expect(args[5].value).not.toBe('1700000000');
    expect(args[6].value).toBe('0');
    expect(args[7].value).toBe(ethers.ZeroHash);
    expect(args[8].value).toBe(ethers.ZeroHash);
  });

  it('treats wallet case differences as matching for withdraw permits', () => {
    const upperWallet = WALLET.toUpperCase();
    const args = buildPodMethodArgs({
      direction: 'to-public',
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 1n,
      withdrawPermit: {
        wallet: upperWallet,
        pTokenAddress: '0x' + '2'.repeat(40),
        portalAddress: PORTAL,
        amountWei: '1000',
        deadline: '42',
        v: 27,
        r: '0x' + '3'.repeat(64),
        s: '0x' + '4'.repeat(64),
      },
    });
    expect(args[5].value).toBe('42');
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

describe('buildPodPortalTxGasOverrides', () => {
  it('uses legacy gasPrice when EIP-1559 is unavailable', async () => {
    const overrides = await buildPodPortalTxGasOverrides(makeSigner() as never, 1_000_000_000n);
    expect(overrides).toEqual({ gasPrice: 1_000_000_000n });
  });

  it('uses EIP-1559 fields equivalent to gasPrice when supported', async () => {
    const overrides = await buildPodPortalTxGasOverrides(
      makeSigner({ baseFeePerGas: 1_000_000_000n }) as never,
      1_100_000_000n,
    );
    expect(overrides).toEqual({
      type: 2,
      maxFeePerGas: 1_100_000_000n,
      maxPriorityFeePerGas: 1_100_000_000n,
    });
    expect(overrides.gasPrice).toBeUndefined();
  });

  it('falls back to legacy gasPrice when getBlock throws (e.g. MetaMask -32601)', async () => {
    const runner = makeSigner({
      getBlockError: new Error('RPC error: -32601 eth_getBlockByNumber not supported'),
    });
    const overrides = await buildPodPortalTxGasOverrides(runner as never, 5n);
    expect(overrides).toEqual({ gasPrice: 5n });
    expect(runner.provider.getBlock).toHaveBeenCalledWith('latest');
  });

  it('falls back to legacy gasPrice when latest block is missing', async () => {
    const overrides = await buildPodPortalTxGasOverrides(
      makeSigner({ baseFeePerGas: null }) as never,
      1n,
    );
    expect(overrides).toEqual({ gasPrice: 1n });
  });

  it('treats baseFeePerGas of 0 as EIP-1559 support', async () => {
    const overrides = await buildPodPortalTxGasOverrides(
      makeSigner({ baseFeePerGas: 0n }) as never,
      1_000_000_000_000n,
    );
    expect(overrides).toEqual({
      type: 2,
      maxFeePerGas: 1_000_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000_000n,
    });
  });

  it('works when the runner is the provider itself', async () => {
    const provider = makeProvider({ baseFeePerGas: 7n });
    const overrides = await buildPodPortalTxGasOverrides(provider as never, 99n);
    expect(overrides.type).toBe(2);
    expect(overrides.maxFeePerGas).toBe(99n);
  });

  it('does not call getFeeData', async () => {
    const runner = makeSigner({ baseFeePerGas: 1n });
    const provider = runner.provider as { getFeeData?: () => unknown };
    provider.getFeeData = vi.fn();
    await buildPodPortalTxGasOverrides(runner as never, 1n);
    expect(provider.getFeeData).not.toHaveBeenCalled();
  });
});

describe('sendPodPortalMethod', () => {
  it('sets withdraw transferFee to the full PoD fee and pins EIP-1559 fees to the estimate', async () => {
    const args = buildPodMethodArgs({
      direction: 'to-public',
      wallet: WALLET,
      amountWei: 1000n,
      portalFee: 200n,
    });
    await sendPodPortalMethod({
      runner: makeSigner({ baseFeePerGas: 1_000_000_000n }) as never,
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
    expect(overrides.type).toBe(2);
    expect(overrides.maxFeePerGas).toBe(1_000_000_000n);
    expect(overrides.maxPriorityFeePerGas).toBe(1_000_000_000n);
    expect(overrides.gasPrice).toBeUndefined();
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
