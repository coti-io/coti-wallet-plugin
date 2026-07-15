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
} from '../../../src/chains/portal/podTransferFees';
import { POD_DEFAULT_CALLBACK_DATA_SIZE } from '../../../src/chains/podInbox';
import { SEPOLIA_CHAIN_ID } from '../../../src/chains/sepolia';

const PTOKEN = '0x' + 'b'.repeat(40);
const WALLET = '0x' + '1'.repeat(40);
const RECIPIENT = '0x' + '2'.repeat(40);

const makeSigner = () => ({
  getAddress: vi.fn(async () => WALLET),
  provider: {
    send: vi.fn(async () => '0x' + (1_000_000_000).toString(16)),
    getFeeData: vi.fn(async () => ({
      gasPrice: 1_000_000_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    })),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.estimateFee.mockResolvedValue({ totalFee: 2100n, remoteFee: 1600n, callBackFee: 500n });
  h.sendFn.mockResolvedValue({ hash: '0xtx' });
  h.encodePodMethodArguments.mockImplementation(async (args: unknown[]) => args);
});

describe('resolvePodTransferFeeEstimationConfig', () => {
  it('uses transfer limits and default callback data size', () => {
    const cfg = resolvePodTransferFeeEstimationConfig(SEPOLIA_CHAIN_ID, 1_000_000_000n);
    expect(cfg.forwardGasLimit).toBe(850_000n);
    expect(cfg.callBackGasLimit).toBe(2_000_000n);
    expect(cfg.callBackDataSize).toBe(POD_DEFAULT_CALLBACK_DATA_SIZE);
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
  it('uses configured forward gas × gasPrice', () => {
    const wei = estimatePodTransferExecutionGasWei(SEPOLIA_CHAIN_ID, 2n);
    expect(wei).toBe(850_000n * 2n);
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
      }),
    );
    expect(quote.podInboxFeeWei).toBe(2100n);
    expect(quote.podCallbackFeeWei).toBe(500n);
    expect(quote.l1ExecutionGasWei).toBe(850_000n * 1_000_000_000n);
    expect(quote.display.feeSymbol).toBe('ETH');
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
});
