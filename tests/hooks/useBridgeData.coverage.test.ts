import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useBridgeData } from '../../src/hooks/useBridgeData';

const h = vi.hoisted(() => ({
  fetchBridgeFees: vi.fn(),
  formatUnits: vi.fn(),
  formatEther: vi.fn(),
  throwOnProvider: false,
  supportedTokensOverride: null as null | typeof import('../../src/contracts/config').SUPPORTED_TOKENS,
  contractMethods: {
    accumulatedCotiFees: vi.fn(),
    paused: vi.fn(),
    isDepositEnabled: vi.fn(),
    minDepositAmount: vi.fn(),
    maxDepositAmount: vi.fn(),
    minWithdrawAmount: vi.fn(),
    maxWithdrawAmount: vi.fn(),
    getBridgeBalance: vi.fn(),
    balanceOf: vi.fn(),
  },
}));

vi.mock('../../src/hooks/useBridgeFees', () => ({
  fetchBridgeFees: (...args: unknown[]) => h.fetchBridgeFees(...args),
}));

vi.mock('../../src/contracts/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/contracts/config')>();
  return {
    ...actual,
    get SUPPORTED_TOKENS() {
      return h.supportedTokensOverride ?? actual.SUPPORTED_TOKENS;
    },
  };
});

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class JsonRpcProvider {
    constructor(..._args: unknown[]) {
      if (h.throwOnProvider) throw 'rpc unavailable';
    }
  }
  class Contract {
    accumulatedCotiFees = h.contractMethods.accumulatedCotiFees;
    paused = h.contractMethods.paused;
    isDepositEnabled = h.contractMethods.isDepositEnabled;
    minDepositAmount = h.contractMethods.minDepositAmount;
    maxDepositAmount = h.contractMethods.maxDepositAmount;
    minWithdrawAmount = h.contractMethods.minWithdrawAmount;
    maxWithdrawAmount = h.contractMethods.maxWithdrawAmount;
    getBridgeBalance = h.contractMethods.getBridgeBalance;
    balanceOf = h.contractMethods.balanceOf;
    constructor(..._args: unknown[]) {}
  }
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider,
      Contract,
      formatUnits: h.formatUnits,
      formatEther: h.formatEther,
    },
  };
});

describe('useBridgeData (error-path coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.throwOnProvider = false;
    h.supportedTokensOverride = null;
    h.fetchBridgeFees.mockResolvedValue({
      depositFixedFee: '0',
      depositPercentageBps: '0',
      depositMaxFee: '0',
      withdrawFixedFee: '0',
      withdrawPercentageBps: '0',
      withdrawMaxFee: '0',
    });
    h.formatUnits.mockReturnValue('1');
    h.formatEther.mockReturnValue('0');
    h.contractMethods.accumulatedCotiFees.mockResolvedValue(0n);
    h.contractMethods.paused.mockResolvedValue(false);
    h.contractMethods.isDepositEnabled.mockResolvedValue(true);
    h.contractMethods.minDepositAmount.mockResolvedValue(0n);
    h.contractMethods.maxDepositAmount.mockResolvedValue(0n);
    h.contractMethods.minWithdrawAmount.mockResolvedValue(0n);
    h.contractMethods.maxWithdrawAmount.mockResolvedValue(0n);
    h.contractMethods.getBridgeBalance.mockResolvedValue(0n);
    h.contractMethods.balanceOf.mockResolvedValue(0n);
  });

  it('records per-token bridge errors when formatting fails (lines 127-128)', async () => {
    h.formatUnits.mockImplementation(() => {
      throw new Error('format exploded');
    });

    const { result } = renderHook(() => useBridgeData(7082400));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.bridgesData.some(b => b.depositFixedFee === 'Error')).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('sets top-level error when supported token list access throws (lines 159-160)', async () => {
    const config = await import('../../src/contracts/config');
    const tokensSpy = vi.spyOn(config, 'SUPPORTED_TOKENS', 'get').mockImplementation(() => {
      throw new Error('supported tokens unavailable');
    });

    const { result } = renderHook(() => useBridgeData(7082400));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('supported tokens unavailable');
    tokensSpy.mockRestore();
  });

  it('invokes refresh to bump the fetch trigger (line 35)', async () => {
    const { result } = renderHook(() => useBridgeData(7082400));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(h.fetchBridgeFees.mock.calls.length).toBeGreaterThan(1);
  });

  it('skips tokens whose bridge address is empty (lines 70-71)', async () => {
    const config = await import('../../src/contracts/config');
    const original = config.CONTRACT_ADDRESSES[7082400];
    (config.CONTRACT_ADDRESSES as Record<number, Record<string, string>>)[7082400] = {
      ...original,
      PrivacyBridgeWETH: '',
    };

    const { result } = renderHook(() => useBridgeData(7082400));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.bridgesData.every(b => b.publicToken !== 'WETH')).toBe(true);
  });

  it('uses the mainnet RPC URL for non-testnet chain IDs (line 52)', async () => {
    const { result } = renderHook(() => useBridgeData(2632500));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('uses "Unknown error" when a per-token failure is not an Error instance', async () => {
    h.formatUnits.mockImplementation(() => {
      throw 'plain string failure';
    });
    const { result } = renderHook(() => useBridgeData(7082400));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.bridgesData.some(b => b.error === 'Unknown error')).toBe(true);
  });

  it('uses "Unknown error" for top-level failures that are not Error instances (line 160)', async () => {
    h.throwOnProvider = true;

    const { result } = renderHook(() => useBridgeData(7082400));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Unknown error');
  });
});
