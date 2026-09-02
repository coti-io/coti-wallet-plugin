import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ethers } from 'ethers';
import type { PodPortalRequest } from '../../../src/contracts/pod';
import {
  COTI_TESTNET_CHAIN_ID,
  POD_PTOKEN_ABI,
  PRIVACY_PORTAL_ABI,
  SEPOLIA_CHAIN_ID,
} from '../../../src/contracts/pod';
import { AVALANCHE_FUJI_CHAIN_ID } from '../../../src/chains';
import {
  diagnoseBlockingPodRequest,
  formatBlockingPodLogSummary,
  summarizeInFlightLocalPodRequests,
} from '../../../src/chains/portal/podPTokenBlockingDiagnostics';

const h = vi.hoisted(() => ({
  trackRequest: vi.fn(),
}));

vi.mock('@coti-io/pod-sdk', () => ({
  PodRequest: class {
    trackRequest = (...args: unknown[]) => h.trackRequest(...args);
  },
}));

const WALLET = '0x' + '1'.repeat(40);
const PTOKEN = '0x' + 'c'.repeat(40);
const PORTAL = '0x' + 'a'.repeat(40);
const REQUEST_ID = '0x' + '9'.repeat(64);

const makeRequest = (overrides: Partial<PodPortalRequest> = {}): PodPortalRequest => ({
  id: 'tx-1',
  kind: 'deposit',
  chainId: SEPOLIA_CHAIN_ID,
  sourceTxHash: '0xsource',
  requestId: REQUEST_ID,
  wallet: WALLET,
  token: 'MTT',
  amount: '1',
  status: 'pod-pending',
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

describe('podPTokenBlockingDiagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
    h.trackRequest.mockReset();
  });

  it('identifies the newest matching in-flight local request as blockingRequest', async () => {
    localStorage.setItem(
      `pod-portal-requests:v1:${WALLET.toLowerCase()}`,
      JSON.stringify([
        makeRequest({ id: 'older', requestId: '0x' + '8'.repeat(64), updatedAt: 1 }),
        makeRequest({ id: 'newer', requestId: REQUEST_ID, updatedAt: 99, token: 'MTT' }),
      ]),
    );

    const diagnostics = await diagnoseBlockingPodRequest({
      account: WALLET,
      pTokenAddress: PTOKEN,
      blockedAction: 'deposit',
      portalAddress: PORTAL,
      tokenSymbol: 'MTT',
      chainId: SEPOLIA_CHAIN_ID,
    });

    expect(diagnostics.blockingRequest?.requestId).toBe(REQUEST_ID);
    expect(diagnostics.blockingRequest?.source).toBe('local-storage');
    expect(diagnostics.blockingRequest?.explorerUrl).toContain(REQUEST_ID.slice(2));
    expect(summarizeInFlightLocalPodRequests(WALLET)).toHaveLength(2);
  });

  it('returns null blockingRequest when no in-flight local or on-chain candidates exist', async () => {
    const diagnostics = await diagnoseBlockingPodRequest({
      account: WALLET,
      pTokenAddress: PTOKEN,
      blockedAction: 'deposit',
      chainId: SEPOLIA_CHAIN_ID,
    });

    expect(diagnostics.blockingRequest).toBeNull();
    expect(diagnostics.candidateRequests).toEqual([]);
  });

  it('summarizes a resolved blocking request and the unresolved fallback', () => {
    expect(formatBlockingPodLogSummary(null, 'deposit')).toContain('no requestId was resolved');
    expect(formatBlockingPodLogSummary({
      source: 'portal-deposit-event',
      confidence: 'medium',
      kind: 'deposit',
      requestId: REQUEST_ID,
      token: 'MTT',
      amount: '2',
      withdrawalId: '0xwd',
      sourceTxHash: '0xsource',
      explorerUrl: 'https://explorer.example/r',
    }, 'deposit')).toContain(`blocked by request ${REQUEST_ID}`);
  });

  it('drops terminal local requests, matches p. prefix tokens, and builds Fuji explorer URLs', async () => {
    localStorage.setItem(
      `pod-portal-requests:v1:${WALLET.toLowerCase()}`,
      JSON.stringify([
        makeRequest({ id: 'done', status: 'succeeded' }),
        makeRequest({
          id: 'fuji-pending',
          token: 'p.USDC',
          chainId: AVALANCHE_FUJI_CHAIN_ID,
          requestId: '0x' + 'f'.repeat(64),
        }),
      ]),
    );

    const diagnostics = await diagnoseBlockingPodRequest({
      account: WALLET,
      pTokenAddress: PTOKEN,
      blockedAction: 'deposit',
      tokenSymbol: 'USDC',
      chainId: AVALANCHE_FUJI_CHAIN_ID,
    });

    expect(diagnostics.inFlightLocalPodRequests).toHaveLength(1);
    expect(diagnostics.blockingRequest?.chainId).toBe(AVALANCHE_FUJI_CHAIN_ID);
    expect(diagnostics.blockingRequest?.explorerUrl).toContain('fuji');
  });

  it('scans portal and pToken events, retries a failed lookback, and prefers callback failures', async () => {
    const pTokenIface = new ethers.Interface(POD_PTOKEN_ABI);
    const portalIface = new ethers.Interface(PRIVACY_PORTAL_ABI);
    const transferId = '0x' + '2'.repeat(64);
    const callbackId = '0x' + '3'.repeat(64);
    const depositId = '0x' + '4'.repeat(64);
    const withdrawId = '0x' + '5'.repeat(64);
    const recipient = '0x' + '2'.repeat(40);

    const encode = (
      iface: ethers.Interface,
      name: string,
      args: unknown[],
      extras: { address: string; blockNumber: number; tx: string },
    ) => {
      const encoded = iface.encodeEventLog(iface.getEvent(name)!, args);
      return {
        address: extras.address,
        topics: encoded.topics as string[],
        data: encoded.data,
        blockNumber: extras.blockNumber,
        transactionHash: extras.tx,
      };
    };

    const logs = [
      encode(pTokenIface, 'TransferRequestSubmitted', [WALLET, recipient, transferId], {
        address: PTOKEN,
        blockNumber: 12,
        tx: '0x' + 'a'.repeat(64),
      }),
      encode(pTokenIface, 'RequestCallbackFailed', [WALLET, recipient, callbackId, '0x'], {
        address: PTOKEN,
        blockNumber: 11,
        tx: '0x' + 'b'.repeat(64),
      }),
      encode(portalIface, 'DepositRequested', [WALLET, recipient, 1n, depositId], {
        address: PORTAL,
        blockNumber: 10,
        tx: '0x' + 'c'.repeat(64),
      }),
      encode(portalIface, 'WithdrawalRequested', [withdrawId, WALLET, recipient, 2n, '0x' + '6'.repeat(64)], {
        address: PORTAL,
        blockNumber: 9,
        tx: '0x' + 'd'.repeat(64),
      }),
    ];

    let lookbackAttempts = 0;
    const provider = {
      getBlockNumber: async () => 20_000,
      getLogs: async (filter: { fromBlock?: bigint; address?: string; topics?: (string | null)[] }) => {
        if (filter.fromBlock === 10_000n) {
          lookbackAttempts += 1;
          throw new Error('range too large');
        }
        return logs.filter(log =>
          log.address.toLowerCase() === String(filter.address).toLowerCase()
          && log.topics[0] === filter.topics?.[0]
        );
      },
    };

    h.trackRequest.mockResolvedValue({
      minedOnTarget: true,
      response: { minedOnTarget: false },
      execution: null,
    });

    const diagnostics = await diagnoseBlockingPodRequest({
      account: WALLET,
      pTokenAddress: PTOKEN,
      blockedAction: 'withdraw',
      portalAddress: PORTAL,
      chainId: SEPOLIA_CHAIN_ID,
      provider: provider as never,
      callbackErrored: true,
    });

    expect(lookbackAttempts).toBeGreaterThan(0);
    expect(diagnostics.eventScan?.providerAvailable).toBe(true);
    expect(diagnostics.eventScan?.pTokenCallbackFailures).toBeGreaterThan(0);
    expect(diagnostics.eventScan?.portalDeposits).toBe(1);
    expect(diagnostics.eventScan?.portalWithdraws).toBe(1);
    expect(diagnostics.eventScan?.errors.some(error => error.includes('range too large'))).toBe(true);
    expect(diagnostics.blockingRequest?.source).toBe('pToken-callback-failed-event');
    expect(diagnostics.blockingRequest?.confidence).toBe('high');
  });

  it('keeps a candidate when PoD tracking throws and picks a matching transfer event', async () => {
    const pTokenIface = new ethers.Interface(POD_PTOKEN_ABI);
    const transferId = '0x' + '7'.repeat(64);
    const encoded = pTokenIface.encodeEventLog(
      pTokenIface.getEvent('TransferRequestSubmitted')!,
      [WALLET, '0x' + '2'.repeat(40), transferId],
    );
    const provider = {
      getBlockNumber: async () => 5,
      getLogs: async (filter: { address?: string; topics?: (string | null)[] }) => {
        if (filter.address?.toLowerCase() !== PTOKEN.toLowerCase()) return [];
        if (filter.topics?.[0] !== encoded.topics[0]) return [];
        if (filter.topics?.[2]) return [];
        return [{
          address: PTOKEN,
          topics: encoded.topics,
          data: encoded.data,
          blockNumber: 3,
          transactionHash: '0x' + 'e'.repeat(64),
        }];
      },
    };
    h.trackRequest.mockRejectedValue(new Error('tracker down'));

    const diagnostics = await diagnoseBlockingPodRequest({
      account: WALLET,
      pTokenAddress: PTOKEN,
      blockedAction: 'transfer',
      chainId: COTI_TESTNET_CHAIN_ID,
      provider: provider as never,
    });

    expect(diagnostics.blockingRequest?.requestId).toBe(transferId);
    expect(diagnostics.blockingRequest?.kind).toBe('transfer');
  });
});
