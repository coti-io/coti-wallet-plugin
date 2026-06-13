import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPodRequests, savePodRequests } from '../../pod/podPortalRequestsStorage';
import { SEPOLIA_CHAIN_ID, type PodPortalRequest } from '../../contracts/pod';
import { resolvePodRequestStatus } from '../../chains/portal/podRequestStatus';
import { logger } from '../../lib/logger';
import type { PrivacyBridgePodContextValue } from './types';

interface UsePrivacyBridgePodOptions {
  walletAddress: string;
  refreshPrivateBalances: () => Promise<boolean>;
}

/** Sepolia PoD portal request persistence and polling. */
export const usePrivacyBridgePodState = ({
  walletAddress,
  refreshPrivateBalances,
}: UsePrivacyBridgePodOptions): PrivacyBridgePodContextValue & {
  upsertPodRequest: (request: PodPortalRequest) => void;
} => {
  const [podRequests, setPodRequests] = useState<PodPortalRequest[]>(() => loadPodRequests(''));
  const completedPodRefreshesRef = useRef<Set<string>>(new Set());

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
        const next = [...prev];
        next[i] = request;
        return next;
      });
    },
    [persistPodRequests],
  );

  const updatePodRequest = useCallback(
    (id: string, patch: Partial<PodPortalRequest>) => {
      persistPodRequests(prev =>
        prev.map(r => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r)),
      );
    },
    [persistPodRequests],
  );

  const refreshBalancesAfterPodCompletion = useCallback(
    async (requestId: string) => {
      if (completedPodRefreshesRef.current.has(requestId)) return;
      completedPodRefreshesRef.current.add(requestId);

      try {
        await refreshPrivateBalances();
      } catch (e) {
        logger.warn('refreshBalancesAfterPodCompletion', e);
      } finally {
        updatePodRequest(requestId, { balanceRefreshPending: false });
      }
    },
    [refreshPrivateBalances, updatePodRequest],
  );

  const refreshPodRequest = useCallback(
    async (request: PodPortalRequest) => {
      try {
        const resolved = await resolvePodRequestStatus(request);
        if (!resolved) return;

        const shouldRefreshBalances =
          resolved.refreshPrivateBalances && !completedPodRefreshesRef.current.has(request.id);

        updatePodRequest(request.id, {
          status: resolved.status,
          message: resolved.message,
          balanceRefreshPending: shouldRefreshBalances
            ? true
            : resolved.refreshPrivateBalances
              ? false
              : request.balanceRefreshPending,
        });

        if (shouldRefreshBalances) {
          void refreshBalancesAfterPodCompletion(request.id);
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
      }
    },
    [updatePodRequest, refreshBalancesAfterPodCompletion],
  );

  useEffect(() => {
    if (!walletAddress) return;
    const active = podRequests.filter(
      r =>
        r.chainId === SEPOLIA_CHAIN_ID &&
        r.wallet.toLowerCase() === walletAddress.toLowerCase() &&
        !['succeeded', 'failed', 'callback-errored', 'burn-debt'].includes(r.status),
    );
    if (active.length === 0) return;
    active.forEach(r => {
      refreshPodRequest(r).catch(err => logger.warn('refreshPodRequest poll failed', err));
    });
    const intervalId = setInterval(() => {
      active.forEach(r => refreshPodRequest(r).catch(err => logger.warn('refreshPodRequest poll failed', err)));
    }, 10_000);
    return () => clearInterval(intervalId);
  }, [podRequests, refreshPodRequest, walletAddress]);

  return { podRequests, refreshPodRequest, upsertPodRequest };
};
