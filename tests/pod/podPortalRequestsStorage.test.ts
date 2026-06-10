import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadPodRequests,
  savePodRequests,
  podRequestsStorageKey,
} from '../../src/pod/podPortalRequestsStorage';
import type { PodPortalRequest } from '../../src/contracts/pod';

const makeRequest = (id: string): PodPortalRequest => ({
  requestId: id,
  chainId: 11155111,
  kind: 'deposit',
  token: 'p.WETH',
  amount: '1',
  status: 'pod-pending',
  createdAt: 1,
  updatedAt: 1,
});

describe('podPortalRequestsStorage', () => {
  beforeEach(() => localStorage.clear());

  describe('podRequestsStorageKey', () => {
    it('lowercases the wallet and namespaces the key', () => {
      expect(podRequestsStorageKey('0xABC')).toBe('pod-portal-requests:v1:0xabc');
    });

    it('handles an undefined wallet', () => {
      expect(podRequestsStorageKey()).toBe('pod-portal-requests:v1:');
    });
  });

  describe('loadPodRequests', () => {
    it('returns [] when nothing is stored', () => {
      expect(loadPodRequests('0xabc')).toEqual([]);
    });

    it('returns the stored requests', () => {
      const reqs = [makeRequest('0x1'), makeRequest('0x2')];
      localStorage.setItem(podRequestsStorageKey('0xabc'), JSON.stringify(reqs));
      expect(loadPodRequests('0xabc')).toEqual(reqs);
    });

    it('caps results at 20', () => {
      const reqs = Array.from({ length: 30 }, (_, i) => makeRequest('0x' + i));
      localStorage.setItem(podRequestsStorageKey('0xabc'), JSON.stringify(reqs));
      expect(loadPodRequests('0xabc')).toHaveLength(20);
    });

    it('returns [] for malformed JSON', () => {
      localStorage.setItem(podRequestsStorageKey('0xabc'), '{not json');
      expect(loadPodRequests('0xabc')).toEqual([]);
    });

    it('returns [] when the stored value is not an array', () => {
      localStorage.setItem(podRequestsStorageKey('0xabc'), JSON.stringify({ foo: 1 }));
      expect(loadPodRequests('0xabc')).toEqual([]);
    });

    it('is case-insensitive on the wallet address', () => {
      const reqs = [makeRequest('0x1')];
      savePodRequests('0xABC', reqs);
      expect(loadPodRequests('0xabc')).toEqual(reqs);
    });
  });

  describe('savePodRequests', () => {
    it('round-trips through loadPodRequests', () => {
      const reqs = [makeRequest('0x1')];
      savePodRequests('0xabc', reqs);
      expect(loadPodRequests('0xabc')).toEqual(reqs);
    });

    it('caps stored requests at 20', () => {
      const reqs = Array.from({ length: 25 }, (_, i) => makeRequest('0x' + i));
      savePodRequests('0xabc', reqs);
      const raw = localStorage.getItem(podRequestsStorageKey('0xabc'))!;
      expect(JSON.parse(raw)).toHaveLength(20);
    });

    it('does not throw when localStorage.setItem fails', () => {
      const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      expect(() => savePodRequests('0xabc', [makeRequest('0x1')])).not.toThrow();
      spy.mockRestore();
    });
  });
});
