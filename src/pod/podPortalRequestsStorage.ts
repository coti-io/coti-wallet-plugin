import type { PodPortalRequest } from "../contracts/pod";
import { logger } from "../lib/logger";

const STORAGE_PREFIX = "pod-portal-requests:v1";

export const podRequestsStorageKey = (wallet?: string) =>
  `${STORAGE_PREFIX}:${(wallet ?? "").toLowerCase()}`;

export function loadPodRequests(wallet?: string): PodPortalRequest[] {
  try {
    const raw = localStorage.getItem(podRequestsStorageKey(wallet));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PodPortalRequest[];
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function savePodRequests(wallet: string | undefined, requests: PodPortalRequest[]) {
  try {
    localStorage.setItem(podRequestsStorageKey(wallet), JSON.stringify(requests.slice(0, 20)));
  } catch (e) {
    logger.warn('savePodRequests failed', e);
  }
}
