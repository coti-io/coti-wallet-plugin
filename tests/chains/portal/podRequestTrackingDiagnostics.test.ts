import { describe, it, expect, vi } from 'vitest';
import {
  explainPodPendingReason,
  logPodTrackingDiagnostics,
  serializeTrackingResponse,
} from '../../../src/chains/portal/podRequestTrackingDiagnostics';
import type { RequestTrackingResponse } from '@coti-io/pod-sdk';
import { logger } from '../../../src/lib/logger';

const baseTracking = (
  overrides: Partial<RequestTrackingResponse> = {},
): RequestTrackingResponse => ({
  timestamp: 1_700_000_000n,
  sourceChainId: 11155111n,
  targetChainId: 7082400n,
  requestId: '0x' + 'a'.repeat(64),
  minedOnTarget: false,
  isTwoWay: true,
  response: null,
  localGasLimit: 100_000n,
  remoteGasLimit: 8_000_000n,
  execution: null,
  ...overrides,
});

describe('serializeTrackingResponse', () => {
  it('serializes bigint fields as strings', () => {
    const serialized = serializeTrackingResponse(
      baseTracking({
        minedOnTarget: true,
        response: baseTracking({ requestId: '0x' + 'b'.repeat(64), minedOnTarget: false }),
      }),
    );
    expect(serialized.sourceChainId).toBe('11155111');
    expect(serialized.targetChainId).toBe('7082400');
    expect(serialized.response?.requestId).toBe('0x' + 'b'.repeat(64));
  });

  it('uses unknown placeholders when tracking fields are missing', () => {
    const serialized = serializeTrackingResponse({
      requestId: undefined,
      sourceChainId: undefined,
      targetChainId: undefined,
      timestamp: undefined,
      minedOnTarget: undefined,
      isTwoWay: undefined,
      localGasLimit: undefined,
      remoteGasLimit: undefined,
      execution: { errorCode: 3n, errorMessage: undefined, errorMessageRaw: '0x' },
      response: null,
    } as unknown as RequestTrackingResponse);

    expect(serialized.requestId).toBe('unknown');
    expect(serialized.sourceChainId).toBe('unknown');
    expect(serialized.execution?.errorCode).toBe('3');
    expect(serialized.execution?.errorMessage).toBe('');
  });
});

describe('explainPodPendingReason', () => {
  it('explains waiting for target inbox when minedOnTarget is false', () => {
    const reason = explainPodPendingReason(baseTracking(), 'deposit');
    expect(reason).toContain('relayer has not mined it on the target chain');
    expect(reason).toContain('7082400');
  });

  it('explains target execution failures', () => {
    const reason = explainPodPendingReason(
      baseTracking({
        execution: { errorCode: 1n, errorMessage: 'revert', errorMessageRaw: '0x' },
      }),
      'deposit',
    );
    expect(reason).toContain('target execution failed');
    expect(reason).toContain('revert');
  });

  it('explains missing callback after target mined', () => {
    const reason = explainPodPendingReason(
      baseTracking({ minedOnTarget: true, response: null }),
      'deposit',
    );
    expect(reason).toContain('callback response has not been generated');
  });

  it('explains a deposit callback that is still pending on Sepolia', () => {
    const reason = explainPodPendingReason(
      baseTracking({
        minedOnTarget: true,
        response: baseTracking({ minedOnTarget: false, requestId: '0x' + 'c'.repeat(64) }),
      }),
      'deposit',
    );
    expect(reason).toContain('mint callback pending on source chain');
  });

  it('explains a non-deposit callback that has not completed on the source chain', () => {
    const reason = explainPodPendingReason(
      baseTracking({
        minedOnTarget: true,
        isTwoWay: false,
        response: baseTracking({ minedOnTarget: false, requestId: '0x' + 'c'.repeat(64) }),
      }),
      'withdraw',
    );
    expect(reason).toContain('has not completed on the source chain yet');
  });

  it('falls back when the tracker reports no progress fields', () => {
    const reason = explainPodPendingReason(
      baseTracking({
        minedOnTarget: true,
        isTwoWay: false,
        response: baseTracking({ minedOnTarget: true, requestId: '0x' + 'c'.repeat(64) }),
      }),
      'deposit',
    );
    expect(reason).toContain('no progress fields');
  });
});

describe('logPodTrackingDiagnostics', () => {
  it('logs SDK config once, then a pending resolution with the next expected step', () => {
    const log = vi.spyOn(logger, 'log');
    const sdkConfig = {
      encryptionNetwork: 'testnet' as const,
      chains: [
        { chainId: 11155111, inboxAddress: '0x' + '1'.repeat(40), rpcUrl: 'https://sepolia.test' },
        { chainId: 7082400, inboxAddress: '0x' + '2'.repeat(40), rpcUrl: 'https://coti.test' },
      ],
    };

    const request = {
      id: 'tx-1',
      kind: 'deposit' as const,
      chainId: 43113,
      sourceTxHash: '0xsource',
      requestId: '0x' + 'd'.repeat(64),
      wallet: '0x' + '1'.repeat(40),
      token: 'USDC',
      amount: '1',
      status: 'pod-pending' as const,
      createdAt: 1,
      updatedAt: 2,
    };

    logPodTrackingDiagnostics({
      request,
      tracking: baseTracking(),
      sdkConfig,
      resolution: 'pod-pending',
    });
    logPodTrackingDiagnostics({
      request: { ...request, chainId: 99, requestId: undefined },
      tracking: baseTracking({ minedOnTarget: true, response: baseTracking() }),
      sdkConfig,
      resolution: 'callback-generated',
      failedHex: '0x',
    });

    const sdkLogs = log.mock.calls.filter(call => String(call[0]).includes('SDK inbox config'));
    expect(sdkLogs).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(
      '[PoD][trackRequest] status resolution',
      expect.objectContaining({
        pendingReason: expect.stringContaining('relayer has not mined'),
        explorerUrl: expect.stringContaining('fuji'),
        nextExpected: 'target-mined (minedOnTarget=true on COTI inbox)',
      }),
    );
  });
});
