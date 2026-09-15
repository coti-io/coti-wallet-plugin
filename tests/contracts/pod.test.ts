import { describe, it, expect } from 'vitest';
import {
  buildPodExplorerRequestUrl,
  chainIdToPodExplorerSlug,
  DEFAULT_POD_EXPLORER_BASE_URL,
  DEFAULT_POD_BALANCE_STATE,
  SEPOLIA_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
} from '../../src/contracts/pod';
import { AVALANCHE_C_CHAIN_ID } from '../../src/chains/avalanche';
import { AVALANCHE_FUJI_CHAIN_ID } from '../../src/chains/avalancheFuji';
import { COTI_MAINNET_CHAIN_ID } from '../../src/chains/coti';

describe('contracts/pod', () => {
  describe('buildPodExplorerRequestUrl', () => {
    it('uses the default chain slug and base url', () => {
      expect(buildPodExplorerRequestUrl('abc123')).toBe(
        `${DEFAULT_POD_EXPLORER_BASE_URL}/#/request/sepolia/abc123`,
      );
    });

    it('strips a leading 0x from the request id', () => {
      expect(buildPodExplorerRequestUrl('0xabc123')).toBe(
        `${DEFAULT_POD_EXPLORER_BASE_URL}/#/request/sepolia/abc123`,
      );
    });

    it('strips a single trailing slash from the base url', () => {
      expect(
        buildPodExplorerRequestUrl('abc123', 'sepolia', 'https://example.com/'),
      ).toBe('https://example.com/#/request/sepolia/abc123');
    });

    it('respects a custom chain slug', () => {
      expect(buildPodExplorerRequestUrl('0xdef', 'coti', 'https://x.io')).toBe(
        'https://x.io/#/request/coti/def',
      );
    });

    it('leaves a request id without a 0x prefix unchanged', () => {
      expect(buildPodExplorerRequestUrl('plainid', 'sepolia', 'https://x.io')).toBe(
        'https://x.io/#/request/sepolia/plainid',
      );
    });
  });

  describe('chainIdToPodExplorerSlug', () => {
    it('maps testnet and mainnet PoD chains to explorer slugs', () => {
      expect(chainIdToPodExplorerSlug(SEPOLIA_CHAIN_ID)).toBe('sepolia');
      expect(chainIdToPodExplorerSlug(COTI_TESTNET_CHAIN_ID)).toBe('coti');
      expect(chainIdToPodExplorerSlug(COTI_MAINNET_CHAIN_ID)).toBe('coti-mainnet');
      expect(chainIdToPodExplorerSlug(AVALANCHE_FUJI_CHAIN_ID)).toBe('fuji');
      expect(chainIdToPodExplorerSlug(AVALANCHE_C_CHAIN_ID)).toBe('avalanche');
    });

    it('accepts bigint chain ids and falls back to the numeric id', () => {
      expect(chainIdToPodExplorerSlug(43114n)).toBe('avalanche');
      expect(chainIdToPodExplorerSlug(99)).toBe('99');
    });
  });

  describe('constants', () => {
    it('exposes the default balance state', () => {
      expect(DEFAULT_POD_BALANCE_STATE).toEqual({
        status: 'unknown',
        pending: false,
        callbackErrored: false,
      });
    });

    it('exposes chain id constants', () => {
      expect(SEPOLIA_CHAIN_ID).toBe(11155111);
      expect(COTI_TESTNET_CHAIN_ID).toBe(7082400);
    });
  });
});
