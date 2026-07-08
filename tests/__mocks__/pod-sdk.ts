/**
 * Mock for @coti-io/pod-sdk used in tests.
 */
import { vi } from 'vitest';

export const DataType = {
  Bool: 'bool',
  Uint8: 'uint8',
  Uint16: 'uint16',
  Uint32: 'uint32',
  Uint64: 'uint64',
  Uint128: 'uint128',
  Uint256: 'uint256',
  String: 'string',
};

const estimateFee = vi.fn(async () => ({
  totalFee: 2100n,
  remoteFee: 1600n,
  callBackFee: 500n,
}));

const callMethod = vi.fn(async () => ({
  hash: '0xmock',
  wait: async () => ({ status: 1, blockNumber: 1, logs: [] }),
}));

export class PodContract {
  contract = {
    getFunction: vi.fn(() => vi.fn(async () => ({
      hash: '0xmock',
      wait: async () => ({ status: 1, blockNumber: 1, logs: [] }),
    }))),
  };

  constructor(..._args: unknown[]) {}

  estimateFee = estimateFee;
  callMethod = callMethod;
  encryptAndCallMethod = callMethod;
}

export const encodePodMethodArguments = vi.fn(async (args: unknown[]) =>
  args.map(arg => ({ ...(arg as object) })),
);

export class PodRequest {
  constructor(..._args: unknown[]) {}
  trackRequest = vi.fn();
}

export const SEPOLIA_DEFAULT_INBOX_ADDRESS = '0x0000000000000000000000000000000000000000';
export const COTI_TESTNET_DEFAULT_INBOX_ADDRESS = '0x0000000000000000000000000000000000000000';
