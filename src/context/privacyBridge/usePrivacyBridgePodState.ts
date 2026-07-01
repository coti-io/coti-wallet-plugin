import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPodRequests, savePodRequests } from '../../pod/podPortalRequestsStorage';
import { type PodPortalRequest } from '../../contracts/pod';
import { resolvePodRequestStatus } from '../../chains/portal/podRequestStatus';
import { CHAIN_CONFIGS } from '../../chains/index';
import { logger } from '../../lib/logger';
import type { PrivacyBridgePodContextValue } from './types';

const POD_PORTAL_CHAIN_IDS = new Set(
  Object.values(CHAIN_CONFIGS)
    .filter(c => c.portalStrategy === 'pod-privacy-portal')
    .map(c => c.id),
);

const TERMINAL_POD_STATUSES = new Set<PodPortalRequest['status']>([
  'failed',
  'callback-errored',
  'burn-debt',
]);

interface UsePrivacyBridgePodOptions {
  walletAddress: string;
  refreshPrivateBalances: () => Promise<boolean>;
}

/** PoD portal request persistence and polling. */
export const usePrivacyBridgePodState = ({
  walletAddress,
  refreshPrivateBalances,
}: UsePrivacyBridgePodOptions): PrivacyBridgePodContextValue & {
  upsertPodRequest: (request: PodPortalRequest) => void;
} => {
  const [podRequests, setPodRequests] = useState<PodPortalRequest[]>(() => loadPodRequests(''));
  const completedPodRefreshesRef = useRef<Set<string>>(new Set());
  const inFlightRefreshRef = useRef<Set<string>>(new Set());
  const podRequestsRef = useRef(podRequests);
  podRequestsRef.current = podRequests;

  const persistPodRequests = useCallback(
    (updater: (prev: PodPortalRequest[]) => PodPortalRequest[]) => {
      setPodRequests(prev => {
        const next = updater(prev);
        savePodRequests(walletAddress, next);
        return next;
      });
    },
    [walletAddress],
  );

  useEffect(() => {
    setPodRequests(loadPodRequests(walletAddress));
  }, [walletAddress]);

  const upsertPodRequest = useCallback(
    (request: PodPortalRequest) => {
      persistPodRequests(prev => {
        const i = prev.findIndex(r => r.id === request.id);
        if (i === -1) return [request, ...prev].slice(0, 20);
        const current = prev[i];
        const unchanged =
          current.status === request.status &&
          current.message === request.message &&
          current.requestId === request.requestId &&
          current.balanceRefreshPending === request.balanceRefreshPending;
        if (unchanged) return prev;
        const next = [...prev];
        next[i] = { ...request, updatedAt: Date.now() };
        return next;
      });
    },
    [persistPodRequests],
  );

  const updatePodRequest = useCallback(
    (id: string, patch: Partial<PodPortalRequest>) => {
      persistPodRequests(prev => {
        const i = prev.findIndex(r => r.id === id);
        if (i === -1) return prev;
        const current = prev[i];
        const nextFields = { ...current, ...patch };
        const unchanged =
          current.status === nextFields.status &&
          current.message === nextFields.message &&
          current.balanceRefreshPending === nextFields.balanceRefreshPending;
        if (unchanged) return prev;
        const next = [...prev];
        next[i] = { ...nextFields, updatedAt: Date.now() };
        return next;
      });
    },
    [persistPodRequests],
  );

  const refreshBalancesAfterPodCompletion = useCallback(
    async (requestId: string) => {
      if (completedPodRefreshesRef.current.has(requestId)) return;

      const attemptRefresh = async () => refreshPrivateBalances();

      try {
        let success = await attemptRefresh();
        if (!success) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          success = await attemptRefresh();
        }

        if (success) {
          completedPodRefreshesRef.current.add(requestId);
          updatePodRequest(requestId, { balanceRefreshPending: false });
          return;
        }

        logger.warn('PoD completion balance refresh failed — will retry on next poll', { requestId });
        updatePodRequest(requestId, { balanceRefreshPending: true });
      } catch (e) {
        logger.warn('refreshBalancesAfterPodCompletion', e);
        updatePodRequest(requestId, { balanceRefreshPending: true });
      }
    },
    [refreshPrivateBalances, updatePodRequest],
  );

  const refreshBalancesAfterPodCompletionRef = useRef(refreshBalancesAfterPodCompletion);
  refreshBalancesAfterPodCompletionRef.current = refreshBalancesAfterPodCompletion;

  const refreshPodRequest = useCallback(
    async (request: PodPortalRequest) => {
      if (inFlightRefreshRef.current.has(request.id)) return;

      inFlightRefreshRef.current.add(request.id);
      try {
        const latest =
          podRequestsRef.current.find(r => r.id === request.id) ?? request;

        if (
          latest.status === 'succeeded' &&
          latest.balanceRefreshPending &&
          !completedPodRefreshesRef.current.has(latest.id)
        ) {
          await refreshBalancesAfterPodCompletionRef.current(latest.id);
          return;
        }

        const resolved = await resolvePodRequestStatus(latest);
        if (!resolved) return;

        if (resolved.status === latest.status && resolved.message === latest.message) {
          logger.debug("[PoD][poll] status unchanged", {
            id: latest.id,
            status: latest.status,
            requestId: latest.requestId,
            message: latest.message,
          });
          return;
        }

        logger.log("[PoD][poll] status change", {
          id: latest.id,
          requestId: latest.requestId,
          from: latest.status,
          to: resolved.status,
          message: resolved.message,
        });

        const shouldRefreshBalances =
          resolved.refreshPrivateBalances && !completedPodRefreshesRef.current.has(latest.id);

        updatePodRequest(latest.id, {
          status: resolved.status,
          message: resolved.message,
          balanceRefreshPending: shouldRefreshBalances ? true : latest.balanceRefreshPending,
        });

        if (shouldRefreshBalances) {
          await refreshBalancesAfterPodCompletionRef.current(latest.id);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes('not found')) {
          updatePodRequest(request.id, {
            status: 'pod-pending',
            message: 'PoD request is waiting to be indexed.',
          });
          return;
        }
        logger.warn('refreshPodRequest', e);
      } finally {
        inFlightRefreshRef.current.delete(request.id);
      }
    },
    [updatePodRequest],
  );

  const refreshPodRequestRef = useRef(refreshPodRequest);
  refreshPodRequestRef.current = refreshPodRequest;

  const pollActiveRequests = useCallback(() => {
    if (!walletAddress) return;
    const active = podRequestsRef.current.filter(
      r =>
        POD_PORTAL_CHAIN_IDS.has(r.chainId) &&
        r.wallet.toLowerCase() === walletAddress.toLowerCase() &&
        (r.balanceRefreshPending ||
          (!TERMINAL_POD_STATUSES.has(r.status) && r.status !== 'succeeded')),
    );
    if (active.length === 0) return;
    active.forEach(r => {
      refreshPodRequestRef.current(r).catch(err =>
        logger.warn('refreshPodRequest poll failed', err),
      );
    });
  }, [walletAddress]);

  const activeRequestIdsRef = useRef('');

  useEffect(() => {
    if (!walletAddress) return;

    const active = podRequests.filter(
      r =>
        POD_PORTAL_CHAIN_IDS.has(r.chainId) &&
        r.wallet.toLowerCase() === walletAddress.toLowerCase() &&
        (r.balanceRefreshPending ||
          (!TERMINAL_POD_STATUSES.has(r.status) && r.status !== 'succeeded')),
    );
    const ids = active
      .map(r => r.id)
      .sort()
      .join(',');
    if (ids !== activeRequestIdsRef.current) {
      activeRequestIdsRef.current = ids;
      if (active.length > 0) pollActiveRequests();
    }
  }, [podRequests, walletAddress, pollActiveRequests]);

  useEffect(() => {
    if (!walletAddress) return;

    pollActiveRequests();
    const intervalId = setInterval(pollActiveRequests, 10_000);
    return () => clearInterval(intervalId);
  }, [walletAddress, pollActiveRequests]);

  return { podRequests, refreshPodRequest, upsertPodRequest };
};
