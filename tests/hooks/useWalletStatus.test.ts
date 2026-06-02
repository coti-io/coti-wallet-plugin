import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock wagmi hooks
const mockSwitchChainAsync = vi.fn();
const mockWagmiDisconnect = vi.fn();
let mockAccountState: any = { isConnected: false, address: undefined, chainId: undefined };

vi.mock('wagmi', () => ({
  useAccount: () => mockAccountState,
  useSwitchChain: () => ({ switchChainAsync: mockSwitchChainAsync }),
  useDisconnect: () => ({ disconnect: mockWagmiDisconnect }),
}));

import { useWalletStatus } from '../../src/hooks/useWalletStatus';

describe('useWalletStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountState = { isConnected: false, address: undefined, chainId: undefined };
  });

  it('returns disconnected state when wallet is not connected', () => {
    const { result } = renderHook(() => useWalletStatus());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBe('');
    expect(result.current.chainId).toBeNull();
    expect(result.current.isValidChain).toBe(false);
    expect(result.current.switchError).toBeNull();
  });

  it('returns connected state with valid COTI testnet chain', () => {
    mockAccountState = {
      isConnected: true,
      address: '0x1234567890abcdef1234567890abcdef12345678',
      chainId: 7082400,
    };

    const { result } = renderHook(() => useWalletStatus());
    expect(result.current.isConnected).toBe(true);
    expect(result.current.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result.current.chainId).toBe(7082400);
    expect(result.current.isValidChain).toBe(true);
  });

  it('returns isValidChain=false for unsupported chain', () => {
    mockAccountState = {
      isConnected: true,
      address: '0x1234567890abcdef1234567890abcdef12345678',
      chainId: 999,
    };

    const { result } = renderHook(() => useWalletStatus());
    expect(result.current.isValidChain).toBe(false);
  });

  it('switchChain calls switchChainAsync with correct chainId', async () => {
    mockAccountState = { isConnected: true, address: '0xabc', chainId: 999 };
    mockSwitchChainAsync.mockResolvedValue(undefined);

    const { result } = renderHook(() => useWalletStatus());

    await act(async () => {
      await result.current.switchChain(7082400);
    });

    expect(mockSwitchChainAsync).toHaveBeenCalledWith({ chainId: 7082400 });
    expect(result.current.switchError).toBeNull();
  });

  it('switchChain captures error message on failure', async () => {
    mockAccountState = { isConnected: true, address: '0xabc', chainId: 999 };
    mockSwitchChainAsync.mockRejectedValue(new Error('User rejected'));

    const { result } = renderHook(() => useWalletStatus());

    await act(async () => {
      await result.current.switchChain(7082400);
    });

    expect(result.current.switchError).toBe('User rejected');
  });

  it('switchChain uses shortMessage when available', async () => {
    mockAccountState = { isConnected: true, address: '0xabc', chainId: 999 };
    mockSwitchChainAsync.mockRejectedValue({ shortMessage: 'Chain not added', message: 'Full error' });

    const { result } = renderHook(() => useWalletStatus());

    await act(async () => {
      await result.current.switchChain(7082400);
    });

    expect(result.current.switchError).toBe('Chain not added');
  });

  it('disconnect calls wagmiDisconnect and clears switchError', async () => {
    mockAccountState = { isConnected: true, address: '0xabc', chainId: 7082400 };

    const { result } = renderHook(() => useWalletStatus());

    act(() => {
      result.current.disconnect();
    });

    expect(mockWagmiDisconnect).toHaveBeenCalled();
  });

  it('returns isValidChain=true for Sepolia when connected to testnet env', () => {
    mockAccountState = {
      isConnected: true,
      address: '0xabc',
      chainId: 11155111,
    };

    const { result } = renderHook(() => useWalletStatus());
    expect(result.current.isValidChain).toBe(true);
  });

  it('returns isValidChain=true for COTI mainnet chain', () => {
    mockAccountState = {
      isConnected: true,
      address: '0xabc',
      chainId: 2632500,
    };

    const { result } = renderHook(() => useWalletStatus());
    expect(result.current.isValidChain).toBe(true);
  });
});
