import { beforeEach, describe, expect, it } from 'vitest';
import type { PodPortalRequest } from '../../../src/contracts/pod';
import { SEPOLIA_CHAIN_ID } from '../../../src/contracts/pod';
import {
  diagnoseBlockingPodRequest,
  summarizeInFlightLocalPodRequests,
} from '../../../src/chains/portal/podPTokenBlockingDiagnostics';

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
});
