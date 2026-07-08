import { describe, it, expect } from 'vitest';
import {
  explainPodPendingReason,
  serializeTrackingResponse,
} from '../../../src/chains/portal/podRequestTrackingDiagnostics';
import type { RequestTrackingResponse } from '@coti-io/pod-sdk';

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
});
