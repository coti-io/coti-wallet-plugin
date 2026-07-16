import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { DataType } from '@coti-io/pod-sdk';

const h = vi.hoisted(() => ({
  estimateFee: vi.fn(),
  sendFn: vi.fn(),
  encodePodMethodArguments: vi.fn(async (args: unknown[]) => args),
  getFunction: vi.fn(),
}));

vi.mock('@coti-io/pod-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@coti-io/pod-sdk')>();
  return {
    ...actual,
    PodContract: class {
      estimateFee = (...args: unknown[]) => h.estimateFee(...args);
      contract = {
        getFunction: (...args: unknown[]) => {
          h.getFunction(...args);
          const fn = Object.assign((...a: unknown[]) => h.sendFn(...a), {
            fragment: { selector: '0xabcdef01' },
          });
          return fn;
        },
      };
    },
    encodePodMethodArguments: (...args: unknown[]) => h.encodePodMethodArguments(...args),
  };
});

import {
  buildPodTransferMethodArgs,
  estimatePodTransferExecutionGasWei,
  quotePodTransferFees,
  resolvePodTransferFeeEstimationConfig,
  sendPodTransferMethod,
  POD_TRANSFER_METHOD,
  POD_TRANSFER_FORWARD_DATA_SIZE,
  POD_TRANSFER_L1_EXECUTION_GAS_FALLBACK,
} from '../../../src/chains/portal/podTransferFees';
import { POD_DEFAULT_CALLBACK_DATA_SIZE } from '../../../src/chains/podInbox';
import { SEPOLIA_CHAIN_ID } from '../../../src/chains/sepolia';

const PTOKEN = '0x' + 'b'.repeat(40);
const WALLET = '0x' + '1'.repeat(40);
const RECIPIENT = '0x' + '2'.repeat(40);

const makeSigner = (opts: {
  gasPriceWei?: bigint;
  baseFeePerGas?: bigint | null;
  getBlockError?: Error;
} = {}) => ({
  getAddress: vi.fn(async () => WALLET),
  provider: {
    send: vi.fn(async () => {
      const wei = opts.gasPriceWei ?? 1_000_000_000n;
      return '0x' + wei.toString(16);
    }),
    getBlock: vi.fn(async () => {
      if (opts.getBlockError) throw opts.getBlockError;
      if (opts.baseFeePerGas === null) return null;
      return {
        baseFeePerGas: opts.baseFeePerGas === undefined ? 1_000_000_000n : opts.baseFeePerGas,
      };
    }),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.estimateFee.mockResolvedValue({ totalFee: 2100n, remoteFee: 1600n, callBackFee: 500n });
  h.sendFn.mockResolvedValue({ hash: '0xtx' });
  h.encodePodMethodArguments.mockImplementation(async (args: unknown[]) => args);
});

describe('resolvePodTransferFeeEstimationConfig', () => {
  it('uses transfer limits, encrypted forwardDataSize, and default callback data size', () => {
    const cfg = resolvePodTransferFeeEstimationConfig(SEPOLIA_CHAIN_ID, 1_000_000_000n);
    expect(cfg.forwardGasLimit).toBe(850_000n);
    expect(cfg.callBackGasLimit).toBe(2_000_000n);
    expect(cfg.callBackDataSize).toBe(POD_DEFAULT_CALLBACK_DATA_SIZE);
    expect(cfg.forwardDataSize).toBe(512n);
    expect(cfg.gasPrice).toBe(1_000_000_000n);
  });
});

describe('buildPodTransferMethodArgs', () => {
  it('builds recipient + itUint256 amount + callback fee slot', () => {
    const args = buildPodTransferMethodArgs({
      recipient: RECIPIENT,
      amountWei: 1_000_000_000_000_000_000n,
    });
    expect(args).toHaveLength(3);
    expect(args[0]).toEqual({
      type: DataType.String,
      value: RECIPIENT,
      isCallBackFee: false,
    });
    expect(args[1].type).toBe(DataType.itUint256);
    expect(args[1].value).toBe('1000000000000000000');
    expect(args[2].isCallBackFee).toBe(true);
    expect(args[2].value).toBe('0');
  });
});

describe('estimatePodTransferExecutionGasWei', () => {
  it('uses L1 execution fallback × gasPrice (not inbox forwardGasLimit)', () => {
    const wei = estimatePodTransferExecutionGasWei(SEPOLIA_CHAIN_ID, 2n);
    expect(wei).toBe(POD_TRANSFER_L1_EXECUTION_GAS_FALLBACK * 2n);
    expect(POD_TRANSFER_L1_EXECUTION_GAS_FALLBACK).toBe(2_000_000n);
    expect(POD_TRANSFER_FORWARD_DATA_SIZE).toBe(512n);
  });
});

describe('quotePodTransferFees', () => {
  it('quotes inbox fee and L1 gas under one gasPrice', async () => {
    const quote = await quotePodTransferFees({
      runner: makeSigner() as never,
      chainId: SEPOLIA_CHAIN_ID,
      pTokenAddress: PTOKEN,
      recipient: RECIPIENT,
      amountWei: ethers.parseEther('1'),
      gasPrice: 1_000_000_000n,
    });

    expect(h.estimateFee).toHaveBeenCalledWith(
      POD_TRANSFER_METHOD,
      expect.any(Array),
      expect.objectContaining({
        forwardGasLimit: 850_000n,
        gasPrice: 1_000_000_000n,
        forwardDataSize: 512n,
      }),
    );
    expect(quote.podInboxFeeWei).toBe(2100n);
    expect(quote.podCallbackFeeWei).toBe(500n);
    expect(quote.l1ExecutionGasWei).toBe(POD_TRANSFER_L1_EXECUTION_GAS_FALLBACK * 1_000_000_000n);
    expect(quote.display.feeSymbol).toBe('ETH');
  });

  it('resolves gas price from eth_gasPrice when not provided', async () => {
    const signer = makeSigner({ gasPriceWei: 2_000n });
    const quote = await quotePodTransferFees({
      runner: signer as never,
      chainId: SEPOLIA_CHAIN_ID,
      pTokenAddress: PTOKEN,
      recipient: RECIPIENT,
      amountWei: 0n,
      gasPrice: undefined,
    });

    expect(quote.gasPrice).toBe(2200n);
    expect(signer.provider.send).toHaveBeenCalledWith('eth_gasPrice', []);
    expect(quote.l1ExecutionGasWei).toBe(POD_TRANSFER_L1_EXECUTION_GAS_FALLBACK * 2200n);
  });

  it('uses an explicit gasPrice override for very large values', async () => {
    const hugeGasPrice = 1_000_000_000_000n;
    const quote = await quotePodTransferFees({
      runner: makeSigner() as never,
      chainId: SEPOLIA_CHAIN_ID,
      pTokenAddress: PTOKEN,
      recipient: RECIPIENT,
      amountWei: ethers.MaxUint256,
      gasPrice: hugeGasPrice,
    });

    expect(quote.gasPrice).toBe(hugeGasPrice);
    expect(quote.l1ExecutionGasWei).toBe(POD_TRANSFER_L1_EXECUTION_GAS_FALLBACK * hugeGasPrice);
  });
});

describe('sendPodTransferMethod', () => {
  it('encrypts args, injects callback fee, and sends value = totalFee', async () => {
    await sendPodTransferMethod({
      runner: makeSigner() as never,
      pTokenAddress: PTOKEN,
      chainId: SEPOLIA_CHAIN_ID,
      args: buildPodTransferMethodArgs({
        recipient: RECIPIENT,
        amountWei: 1000n,
      }),
      gasPrice: 1_000_000_000n,
      gasLimit: 900_000n,
      fee: { totalFee: 2100n, remoteFee: 1600n, callBackFee: 500n },
    });

    expect(h.encodePodMethodArguments).toHaveBeenCalledWith(
      expect.any(Array),
      'testnet',
      true,
      expect.objectContaining({
        contractAddress: PTOKEN,
        functionSelector: '0xabcdef01',
        userAddress: WALLET,
      }),
    );

    const sendArgs = h.sendFn.mock.calls[0];
    expect(sendArgs[2]).toBe(500n); // callback fee patched
    expect(sendArgs[3]).toEqual(
      expect.objectContaining({
        value: 2100n,
        gasLimit: 900_000n,
      }),
    );
  });

  it('exposes 2M L1 gas fallback for estimateGas failure path', () => {
    // sendPodTransferMethod catches simulation failures and assigns this limit;
    // covered here as a constant contract (ESM prevents spying JsonRpcProvider).
    expect(POD_TRANSFER_L1_EXECUTION_GAS_FALLBACK).toBe(2_000_000n);
  });

  it('falls back to legacy gasPrice when getBlock fails', async () => {
    await sendPodTransferMethod({
      runner: makeSigner({
        getBlockError: new Error('RPC error: -32601 eth_getBlockByNumber not supported'),
      }) as never,
      pTokenAddress: PTOKEN,
      chainId: SEPOLIA_CHAIN_ID,
      args: buildPodTransferMethodArgs({
        recipient: RECIPIENT,
        amountWei: 1n,
      }),
      gasPrice: 3n,
      fee: { totalFee: 1n, remoteFee: 1n, callBackFee: 0n },
    });

    const overrides = h.sendFn.mock.calls[0][3] as Record<string, unknown>;
    expect(overrides.gasPrice).toBe(3n);
    expect(overrides.type).toBeUndefined();
  });

  it('pins EIP-1559 fees when baseFeePerGas is present', async () => {
    await sendPodTransferMethod({
      runner: makeSigner({ baseFeePerGas: 500n }) as never,
      pTokenAddress: PTOKEN,
      chainId: SEPOLIA_CHAIN_ID,
      args: buildPodTransferMethodArgs({
        recipient: RECIPIENT,
        amountWei: 1000n,
      }),
      gasPrice: 1_000_000_000n,
      fee: { totalFee: 2100n, remoteFee: 1600n, callBackFee: 500n },
    });

    const overrides = h.sendFn.mock.calls[0][3] as Record<string, unknown>;
    expect(overrides.type).toBe(2);
    expect(overrides.maxFeePerGas).toBe(1_000_000_000n);
    expect(overrides.maxPriorityFeePerGas).toBe(1_000_000_000n);
    expect(overrides.gasPrice).toBeUndefined();
  });
});
