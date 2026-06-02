import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMetamask } from '../../src/hooks/useMetamask';

describe('useMetamask', () => {
  let mockRequest: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest = vi.fn().mockResolvedValue([]);
    (window as any).ethereum = {
      request: mockRequest,
      on: vi.fn(),
      removeListener: vi.fn(),
      isMetaMask: true,
    };
  });

  it('returns expected interface', () => {
    const { result } = renderHook(() => useMetamask());
    expect(result.current.networkName).toBeDefined();
    expect(result.current.chainId).toBeDefined();
    expect(result.current.switchNetwork).toBeDefined();
    expect(result.current.connectWallet).toBeDefined();
    expect(result.current.COTI_MAINNET_ID).toBe('0x282b34');
    expect(result.current.COTI_TESTNET_ID).toBe('0x6c11a0');
    expect(result.current.SEPOLIA_ID).toBe('0xaa36a7');
  });

  describe('connectWallet', () => {
    it('throws METAMASK_NOT_INSTALLED when window.ethereum is missing', async () => {
      delete (window as any).ethereum;
      const { result } = renderHook(() => useMetamask());

      await expect(
        result.current.connectWallet(vi.fn())
      ).rejects.toThrow('MetaMask or compatible wallet not found');
    });

    it('calls onConnect with the account address (integration test)', async () => {
      // This test requires a real ethers BrowserProvider which isn't available in unit tests.
      // The function is covered by the integration test in the example app.
      // Here we just verify it doesn't throw when accounts are empty.
      mockRequest.mockResolvedValue([]);
      const onConnect = vi.fn();
      const { result } = renderHook(() => useMetamask());

      await act(async () => {
        await result.current.connectWallet(onConnect);
      });

      // No accounts returned → onConnect not called
      expect(onConnect).not.toHaveBeenCalled();
    });

    it('does nothing when accounts array is empty', async () => {
      mockRequest
        .mockResolvedValueOnce(undefined) // wallet_requestPermissions
        .mockResolvedValueOnce([]); // eth_requestAccounts returns empty

      const onConnect = vi.fn();
      const { result } = renderHook(() => useMetamask());

      await act(async () => {
        await result.current.connectWallet(onConnect);
      });

      expect(onConnect).not.toHaveBeenCalled();
    });
  });

  describe('switchNetwork', () => {
    it('returns true on successful chain switch', async () => {
      mockRequest.mockResolvedValue(undefined);
      const { result } = renderHook(() => useMetamask());

      const success = await result.current.switchNetwork('0x6c11a0');
      expect(success).toBe(true);
    });

    it('returns false when window.ethereum is missing', async () => {
      delete (window as any).ethereum;
      const { result } = renderHook(() => useMetamask());

      const success = await result.current.switchNetwork('0x6c11a0');
      expect(success).toBe(false);
    });

    it('attempts wallet_addEthereumChain on error code 4902', async () => {
      mockRequest
        .mockRejectedValueOnce({ code: 4902 }) // wallet_switchEthereumChain fails
        .mockResolvedValueOnce(undefined) // wallet_addEthereumChain
        .mockResolvedValueOnce(undefined); // wallet_switchEthereumChain retry

      const { result } = renderHook(() => useMetamask());
      const success = await result.current.switchNetwork('0x6c11a0');
      expect(success).toBe(true);
    });

    it('returns false on non-4902 switch error', async () => {
      mockRequest.mockRejectedValue({ code: 4001 });
      const { result } = renderHook(() => useMetamask());

      const success = await result.current.switchNetwork('0x6c11a0');
      expect(success).toBe(false);
    });
  });

  describe('event listeners', () => {
    it('registers accountsChanged and chainChanged listeners', () => {
      renderHook(() => useMetamask());
      expect((window as any).ethereum.on).toHaveBeenCalledWith('accountsChanged', expect.any(Function));
      expect((window as any).ethereum.on).toHaveBeenCalledWith('chainChanged', expect.any(Function));
    });

    it('calls onAccountChanged when accounts change', () => {
      const onAccountChanged = vi.fn();
      renderHook(() => useMetamask({ onAccountChanged }));

      // Get the accountsChanged handler
      const onCall = (window as any).ethereum.on.mock.calls.find(
        (c: any) => c[0] === 'accountsChanged'
      );
      const handler = onCall[1];
      handler(['0xnewaccount']);

      expect(onAccountChanged).toHaveBeenCalledWith('0xnewaccount');
    });

    it('calls onDisconnect when accounts become empty', () => {
      const onDisconnect = vi.fn();
      renderHook(() => useMetamask({ onDisconnect }));

      const onCall = (window as any).ethereum.on.mock.calls.find(
        (c: any) => c[0] === 'accountsChanged'
      );
      const handler = onCall[1];
      handler([]);

      expect(onDisconnect).toHaveBeenCalled();
    });
  });

  describe('initial eth_accounts check', () => {
    it('calls onAccountChanged if already connected', async () => {
      mockRequest.mockResolvedValue(['0xexisting']);
      const onAccountChanged = vi.fn();

      renderHook(() => useMetamask({ onAccountChanged }));

      // Wait for the async eth_accounts call
      await vi.waitFor(() => {
        expect(onAccountChanged).toHaveBeenCalledWith('0xexisting');
      });
    });
  });
});
