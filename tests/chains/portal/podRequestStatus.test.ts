import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for resolvePodRequestStatus. `ethers` keeps its real Interface/hexlify
 * but swaps Contract + JsonRpcProvider for controllable stubs. The PoD SDK,
 * chain helpers and contract address map are mocked so each status branch can be
 * driven deterministically.
 */
const h = vi.hoisted(() => ({
  failedRequests: vi.fn(),
  getLogs: vi.fn(),
  getBlockNumber: vi.fn(),
  trackRequest: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    constructor(..._args: unknown[]) {}
    failedRequests = (...a: unknown[]) => h.failedRequests(...a);
  }
  class MockJsonRpcProvider {
    constructor(..._args: unknown[]) {}
    getLogs = (...a: unknown[]) => h.getLogs(...a);
    getBlockNumber = (...a: unknown[]) => h.getBlockNumber(...a);
  }
  return {
    ...actual,
    ethers: { ...actual.ethers, Contract: MockContract, JsonRpcProvider: MockJsonRpcProvider },
  };
});

vi.mock('@coti/pod-sdk', () => ({
  COTI_TESTNET_DEFAULT_INBOX_ADDRESS: '0x' + '0'.repeat(40),
  SEPOLIA_DEFAULT_INBOX_ADDRESS: '0x' + '0'.repeat(40),
  DataType: { String: 2 },
  PodContract: class {
    constructor(..._args: unknown[]) {}
  },
  PodRequest: class {
    constructor(..._args: unknown[]) {}
    trackRequest = (...a: unknown[]) => h.trackRequest(...a);
  },
}));

vi.mock('../../../src/chains/portal/executePodPortalTransaction', () => ({
  getPodSdkConfig: vi.fn(() => ({
    encryptionNetwork: 'testnet',
    chains: [
      { chainId: 11155111, inboxAddress: '0x' + '1'.repeat(40), rpcUrl: 'https://sepolia.test' },
      { chainId: 7082400, inboxAddress: '0x' + '2'.repeat(40), rpcUrl: 'https://coti.test' },
    ],
  })),
}));

vi.mock('../../../src/chains/index', () => ({
  getPublicTokensForChain: vi.fn(() => [{ symbol: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18, isPrivate: false }]),
  getPrivateTokensForChain: vi.fn(() => [{ symbol: 'p.MTT', addressKey: 'p.MTT', decimals: 18 }]),
  getRpcUrlForChain: vi.fn(() => 'https://rpc.test'),
  getNetworkNameForChain: vi.fn((chainId: number) => (chainId === 11155111 ? 'Sepolia' : 'Unknown')),
}));

vi.mock('../../../src/contracts/config', () => ({
  CONTRACT_ADDRESSES: {
    11155111: { 'p.MTT': '0x' + 'c'.repeat(40), PrivacyPortalMTT: '0x' + 'a'.repeat(40) },
  },
}));

import { resolvePodRequestStatus } from '../../../src/chains/portal/podRequestStatus';
import { getPrivateTokensForChain } from '../../../src/chains/index';
import { CONTRACT_ADDRESSES } from '../../../src/contracts/config';
import { SEPOLIA_CHAIN_ID, type PodPortalRequest } from '../../../src/contracts/pod';

const baseRequest = (overrides: Partial<PodPortalRequest> = {}): PodPortalRequest => ({
  id: '0xsrc',
  kind: 'deposit',
  chainId: SEPOLIA_CHAIN_ID,
  sourceTxHash: '0xsrc',
  requestId: '0x' + '7'.repeat(64),
  wallet: '0x' + '1'.repeat(40),
  token: 'p.MTT',
  amount: '1',
  status: 'source-mined',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.failedRequests.mockResolvedValue('0x');
  h.getBlockNumber.mockResolvedValue(100_000);
  h.getLogs.mockResolvedValue([]);
  h.trackRequest.mockResolvedValue({});
  vi.mocked(getPrivateTokensForChain).mockReturnValue([
    { symbol: 'p.MTT', name: 'p.MTT', icon: '', decimals: 18, isPrivate: true, addressKey: 'p.MTT' },
  ]);
});

describe('resolvePodRequestStatus - early returns', () => {
  it('returns source-mined guidance when requestId is absent', async () => {
    expect(await resolvePodRequestStatus(baseRequest({ requestId: undefined }))).toMatchObject({
      status: 'source-mined',
      message: expect.stringContaining('request ID not found'),
    });
  });

  it('returns null for a non-Sepolia chain', async () => {
    expect(
      await resolvePodRequestStatus(baseRequest({ chainId: 999 as typeof SEPOLIA_CHAIN_ID })),
    ).toBeNull();
  });

  it('returns null when the contract address map has no Sepolia entry', async () => {
    const saved = CONTRACT_ADDRESSES[SEPOLIA_CHAIN_ID];
    delete (CONTRACT_ADDRESSES as Record<number, unknown>)[SEPOLIA_CHAIN_ID];
    try {
      expect(await resolvePodRequestStatus(baseRequest())).toBeNull();
    } finally {
      CONTRACT_ADDRESSES[SEPOLIA_CHAIN_ID] = saved;
    }
  });

  it('returns null when the pToken address cannot be resolved', async () => {
    vi.mocked(getPrivateTokensForChain).mockReturnValue([]);
    expect(await resolvePodRequestStatus(baseRequest())).toBeNull();
  });

  it('returns null when the portal address is missing', async () => {
    const saved = CONTRACT_ADDRESSES[SEPOLIA_CHAIN_ID].PrivacyPortalMTT;
    delete (CONTRACT_ADDRESSES[SEPOLIA_CHAIN_ID] as Record<string, unknown>).PrivacyPortalMTT;
    try {
      expect(await resolvePodRequestStatus(baseRequest())).toBeNull();
    } finally {
      CONTRACT_ADDRESSES[SEPOLIA_CHAIN_ID].PrivacyPortalMTT = saved;
    }
  });
});

describe('resolvePodRequestStatus - callback errored', () => {
  it('flags callback-errored when failedRequests returns non-empty hex', async () => {
    h.failedRequests.mockResolvedValue('0xdeadbeef');
    const res = await resolvePodRequestStatus(baseRequest());
    expect(res).toMatchObject({ status: 'callback-errored', refreshPrivateBalances: false });
  });

  it('hexlifies a non-string failedRequests result', async () => {
    h.failedRequests.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const res = await resolvePodRequestStatus(baseRequest());
    expect(res?.status).toBe('callback-errored');
  });

  it('treats a reverting failedRequests call as no failure (0x)', async () => {
    h.failedRequests.mockRejectedValue(new Error('revert'));
    h.trackRequest.mockResolvedValue({});
    const res = await resolvePodRequestStatus(baseRequest());
    expect(res).toMatchObject({ status: 'pod-pending' });
  });
});

describe('resolvePodRequestStatus - tracking results', () => {
  it('returns failed when the PoD execution reports a non-zero error code', async () => {
    h.trackRequest.mockResolvedValue({ execution: { errorCode: 5, errorMessage: 'boom' } });
    const res = await resolvePodRequestStatus(baseRequest());
    expect(res).toMatchObject({ status: 'failed', message: 'boom' });
  });

  it('uses a default message when the execution error has no message', async () => {
    h.trackRequest.mockResolvedValue({ execution: { errorCode: 7 } });
    const res = await resolvePodRequestStatus(baseRequest());
    expect(res?.message).toContain('execution failed');
  });

  it('ignores a zero error code (no failure)', async () => {
    h.trackRequest.mockResolvedValue({ execution: { errorCode: 0 } });
    const res = await resolvePodRequestStatus(baseRequest());
    expect(res).toMatchObject({ status: 'pod-pending' });
  });

  it('marks a deposit succeeded when minedOnTarget is set on the response', async () => {
    h.trackRequest.mockResolvedValue({ response: { minedOnTarget: true } });
    const res = await resolvePodRequestStatus(baseRequest({ kind: 'deposit' }));
    expect(res).toMatchObject({ status: 'succeeded', refreshPrivateBalances: true });
  });

  it('marks a withdraw succeeded when a WithdrawalReleased log is found', async () => {
    h.getLogs.mockResolvedValue([{ data: '0x' }]);
    const res = await resolvePodRequestStatus(
      baseRequest({ kind: 'withdraw', withdrawalId: '0x' + '9'.repeat(64), fromBlock: 10 }),
    );
    expect(res).toMatchObject({ status: 'succeeded', refreshPrivateBalances: true });
  });

  it('computes a default fromBlock window when none is provided', async () => {
    h.getLogs.mockResolvedValue([]);
    h.trackRequest.mockResolvedValue({ response: { minedOnTarget: false } });
    const res = await resolvePodRequestStatus(
      baseRequest({ kind: 'withdraw', withdrawalId: '0x' + '9'.repeat(64) }),
    );
    // No release log; response present -> callback-generated
    expect(res).toMatchObject({ status: 'callback-generated' });
    expect(h.getBlockNumber).toHaveBeenCalled();
  });

  it('returns callback-generated when a response exists but is not a mined deposit', async () => {
    h.trackRequest.mockResolvedValue({ response: { minedOnTarget: false } });
    const res = await resolvePodRequestStatus(baseRequest({ kind: 'deposit' }));
    expect(res).toMatchObject({ status: 'callback-generated', refreshPrivateBalances: false });
  });

  it('returns target-mined when mined on COTI without a callback response', async () => {
    h.trackRequest.mockResolvedValue({ minedOnTarget: true });
    const res = await resolvePodRequestStatus(baseRequest());
    expect(res).toMatchObject({ status: 'target-mined' });
  });

  it('returns pod-pending when nothing has progressed yet from source-mined', async () => {
    h.trackRequest.mockResolvedValue({});
    const res = await resolvePodRequestStatus(baseRequest());
    expect(res).toMatchObject({ status: 'pod-pending' });
  });

  it('handles a null/undefined execution object', async () => {
    h.trackRequest.mockResolvedValue({ execution: null });
    const res = await resolvePodRequestStatus(baseRequest());
    expect(res).toMatchObject({ status: 'pod-pending' });
  });

  it('treats a null error code as no execution error', async () => {
    h.trackRequest.mockResolvedValue({ execution: { errorCode: null } });
    const res = await resolvePodRequestStatus(baseRequest());
    expect(res).toMatchObject({ status: 'pod-pending' });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
