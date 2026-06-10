/**
 * Mock for @coti/pod-sdk used in tests.
 */
import { vi } from 'vitest';

export const DataType = {
  uint256: 0,
  uint64: 1,
  string: 2,
};

export class PodContract {
  constructor(..._args: any[]) {}
  getFunction = vi.fn(() => vi.fn());
}

export const SEPOLIA_DEFAULT_INBOX_ADDRESS = '0x0000000000000000000000000000000000000000';
