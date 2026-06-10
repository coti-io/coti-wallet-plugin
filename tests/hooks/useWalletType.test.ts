import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { mapConnectorIdToWalletType, useWalletType } from '../../src/hooks/useWalletType';

const useAccountMock = vi.fn();
vi.mock('wagmi', () => ({
  useAccount: () => useAccountMock(),
}));

const SNAP_ID = 'npm:@coti-io/coti-snap';

describe('Wallet Type Detection (README: Multi-Wallet Support)', () => {
  describe('mapConnectorIdToWalletType', () => {
    // Exact matches
    it('maps "metaMask" to metamask', () => {
      expect(mapConnectorIdToWalletType('metaMask')).toBe('metamask');
    });

    it('maps "io.metamask" to metamask', () => {
      expect(mapConnectorIdToWalletType('io.metamask')).toBe('metamask');
    });

    it('maps "io.metamask.flask" to metamask', () => {
      expect(mapConnectorIdToWalletType('io.metamask.flask')).toBe('metamask');
    });

    it('maps "coinbaseWalletSDK" to coinbase', () => {
      expect(mapConnectorIdToWalletType('coinbaseWalletSDK')).toBe('coinbase');
    });

    it('maps "walletConnect" to walletconnect', () => {
      expect(mapConnectorIdToWalletType('walletConnect')).toBe('walletconnect');
    });

    it('maps "rainbow" to rainbow', () => {
      expect(mapConnectorIdToWalletType('rainbow')).toBe('rainbow');
    });

    it('maps "phantom" to phantom', () => {
      expect(mapConnectorIdToWalletType('phantom')).toBe('phantom');
    });

    it('maps "trust-extension" to trust', () => {
      expect(mapConnectorIdToWalletType('trust-extension')).toBe('trust');
    });

    it('maps "trustWallet" to trust', () => {
      expect(mapConnectorIdToWalletType('trustWallet')).toBe('trust');
    });

    it('maps "rabby" to rabby', () => {
      expect(mapConnectorIdToWalletType('rabby')).toBe('rabby');
    });

    it('maps "ledger" to ledger', () => {
      expect(mapConnectorIdToWalletType('ledger')).toBe('ledger');
    });

    // Case-insensitive partial matches
    it('partial match: "com.metamask.custom" resolves to metamask', () => {
      expect(mapConnectorIdToWalletType('com.metamask.custom')).toBe('metamask');
    });

    it('partial match: "app.coinbase.wallet" resolves to coinbase', () => {
      expect(mapConnectorIdToWalletType('app.coinbase.wallet')).toBe('coinbase');
    });

    it('partial match: "io.walletconnect.v2" resolves to walletconnect', () => {
      expect(mapConnectorIdToWalletType('io.walletconnect.v2')).toBe('walletconnect');
    });

    it('partial match: "app.phantom.evm" resolves to phantom', () => {
      expect(mapConnectorIdToWalletType('app.phantom.evm')).toBe('phantom');
    });

    it('partial match: "io.trust.wallet" resolves to trust', () => {
      expect(mapConnectorIdToWalletType('io.trust.wallet')).toBe('trust');
    });

    it('partial match: "io.rabby.extension" resolves to rabby', () => {
      expect(mapConnectorIdToWalletType('io.rabby.extension')).toBe('rabby');
    });

    it('partial match: "app.rainbow.me" resolves to rainbow', () => {
      expect(mapConnectorIdToWalletType('app.rainbow.me')).toBe('rainbow');
    });

    it('partial match: "com.ledger.live" resolves to ledger', () => {
      expect(mapConnectorIdToWalletType('com.ledger.live')).toBe('ledger');
    });

    // Fallback
    it('returns "unknown" for unrecognized connector ID', () => {
      expect(mapConnectorIdToWalletType('com.okex.wallet')).toBe('unknown');
    });

    it('returns "unknown" for undefined', () => {
      expect(mapConnectorIdToWalletType(undefined)).toBe('unknown');
    });

    it('returns "unknown" for empty string', () => {
      expect(mapConnectorIdToWalletType('')).toBe('unknown');
    });
  });

  describe('useWalletType hook', () => {
    beforeEach(() => {
      useAccountMock.mockReset();
    });

    it('returns disconnected state when no connector is present', () => {
      useAccountMock.mockReturnValue({ connector: undefined });
      const { result } = renderHook(() => useWalletType());
      expect(result.current).toEqual({
        isMetaMaskWithSnap: false,
        walletType: 'unknown',
        connectorId: undefined,
      });
    });

    it('reports walletType for a non-metamask connector and never flags snap', async () => {
      useAccountMock.mockReturnValue({
        connector: { id: 'coinbaseWalletSDK', getProvider: vi.fn() },
      });
      const { result } = renderHook(() => useWalletType());
      expect(result.current.walletType).toBe('coinbase');
      expect(result.current.connectorId).toBe('coinbaseWalletSDK');
      expect(result.current.isMetaMaskWithSnap).toBe(false);
    });

    it('detects an installed COTI snap for a metamask connector', async () => {
      const request = vi.fn().mockResolvedValue({ [SNAP_ID]: { version: '1.0.0' } });
      useAccountMock.mockReturnValue({
        connector: { id: 'metaMask', getProvider: vi.fn().mockResolvedValue({ request }) },
      });

      const { result } = renderHook(() => useWalletType());

      await waitFor(() => expect(result.current.isMetaMaskWithSnap).toBe(true));
      expect(request).toHaveBeenCalledWith({ method: 'wallet_getSnaps' });
    });

    it('detects snap via the id field of an enumerated snap', async () => {
      const request = vi.fn().mockResolvedValue({ someKey: { id: SNAP_ID } });
      useAccountMock.mockReturnValue({
        connector: { id: 'metaMask', getProvider: vi.fn().mockResolvedValue({ request }) },
      });

      const { result } = renderHook(() => useWalletType());
      await waitFor(() => expect(result.current.isMetaMaskWithSnap).toBe(true));
    });

    it('leaves snap false when the snap is not installed', async () => {
      const request = vi.fn().mockResolvedValue({});
      useAccountMock.mockReturnValue({
        connector: { id: 'metaMask', getProvider: vi.fn().mockResolvedValue({ request }) },
      });

      const { result } = renderHook(() => useWalletType());
      // allow the effect to run
      await waitFor(() => expect(request).toHaveBeenCalled());
      expect(result.current.isMetaMaskWithSnap).toBe(false);
    });

    it('swallows errors from wallet_getSnaps and keeps snap false', async () => {
      const request = vi.fn().mockRejectedValue(new Error('not supported'));
      useAccountMock.mockReturnValue({
        connector: { id: 'metaMask', getProvider: vi.fn().mockResolvedValue({ request }) },
      });

      const { result } = renderHook(() => useWalletType());
      await waitFor(() => expect(request).toHaveBeenCalled());
      expect(result.current.isMetaMaskWithSnap).toBe(false);
    });
  });
});
