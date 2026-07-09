import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBalanceUpdater } from '../../src/hooks/useBalanceUpdater';

const h = vi.hoisted(() => ({
  getNetwork: vi.fn(),
  getBalance: vi.fn(),
  contractBalanceOf: vi.fn(),
  formatEther: vi.fn(),
  formatUnits: vi.fn(),
}));

vi.mock('ethers', () => {
  class BrowserProvider {
    constructor(_provider: unknown) {}
    getNetwork = h.getNetwork;
    getBalance = h.getBalance;
  }
  class JsonRpcProvider {
    constructor(_url: unknown, _chainId: unknown) {}
    getBalance = h.getBalance;
    getNetwork = h.getNetwork;
  }
  class Contract {
    constructor(_address: unknown, _abi: unknown, _provider: unknown) {}
    balanceOf = h.contractBalanceOf;
  }
  return {
    ethers: {
      BrowserProvider,
      JsonRpcProvider,
      Contract,
      formatEther: h.formatEther,
      formatUnits: h.formatUnits,
    },
  };
});

vi.mock('../../src/lib/rpcProvider', () => ({
  createResilientJsonRpcProvider: vi.fn(async () => ({
    getBalance: h.getBalance,
    getNetwork: h.getNetwork,
  })),
}));

// Inject a synthetic chain (KEYLESS_CHAIN) whose private token list contains a
// token WITHOUT an addressKey, so the `token.addressKey ? … : undefined`
// ternary's alternate branch is exercised. Every real chain config gives all
// private tokens an addressKey, so this branch is otherwise unreachable.
const KEYLESS_CHAIN = 999000;
vi.mock('../../src/contracts/config', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const keylessChain = 999000;
   
  const realPrivate = actual.getPrivateTokensForChain as (id: number) => any[];
  return {
    ...actual,
    CONTRACT_ADDRESSES: {
       
      ...(actual.CONTRACT_ADDRESSES as any),
      [keylessChain]: { someUnrelated: '0xabc' },
    },
    getPublicTokensForChain: (chainId: number) =>
      chainId === keylessChain ? [] : (actual.getPublicTokensForChain as (id: number) => unknown[])(chainId),
    getPrivateTokensForChain: (chainId: number) =>
      chainId === keylessChain
        ? [{ symbol: 'NOKEY', name: 'NoKey', decimals: 18, isPrivate: true, icon: '/icons/coti.svg' }]
        : realPrivate(chainId),
  };
});

const COTI_TESTNET = 7082400;
const COTI_MAINNET = 2632500;
const ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678';

 
function makeProps(overrides: Partial<Record<string, any>> = {}) {
  return {
    setWalletAddress: vi.fn(),
    setIsConnected: vi.fn(),
    setHasSnap: vi.fn(),
    setPublicTokens: vi.fn(),
    setPrivateTokens: vi.fn(),
    checkNetwork: vi.fn().mockResolvedValue(undefined),
    getAESKeyFromSnap: vi.fn().mockResolvedValue(null),
    fetchPrivateBalance: vi.fn().mockResolvedValue('0'),
    sessionAesKey: null as string | null,
    setSessionAesKey: vi.fn(),
    ...overrides,
  };
}

describe('useBalanceUpdater branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getNetwork.mockResolvedValue({ chainId: BigInt(COTI_TESTNET) });
    h.getBalance.mockResolvedValue(1500000000000000000n);
    h.contractBalanceOf.mockResolvedValue(1000000n);
    h.formatEther.mockReturnValue('1.5');
    h.formatUnits.mockReturnValue('1.0');
  });

  it('falls back to "0" when an ERC20 balanceOf call throws (line 92)', async () => {
    h.contractBalanceOf.mockRejectedValue(new Error('reverted'));
    const props = makeProps();
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, false, false, null, COTI_TESTNET);
    expect(ok).toBe(true);
    const tokens = props.setPublicTokens.mock.calls[0][0];
    // every ERC20 token resolves to the "0" fallback
    expect(tokens.some((t: { addressKey?: string }) => t.addressKey)).toBe(true);
  });

  it('returns "0" for a private token whose on-chain address is empty (lines 130-131)', async () => {
    const props = makeProps({ sessionAesKey: 'a'.repeat(32) });
    const { result } = renderHook(() => useBalanceUpdater(props));

    // Mainnet config has empty-string private token addresses.
    const ok = await result.current.updateAccountState(ACCOUNT, true, true, undefined, COTI_MAINNET);
    expect(ok).toBe(true);
    expect(props.setPrivateTokens).toHaveBeenCalledTimes(1);
    expect(props.fetchPrivateBalance).not.toHaveBeenCalled();
  });

  it('uses the "" message fallback for a non-mismatch error with no message (line 137)', async () => {
    const props = makeProps({
      sessionAesKey: 'b'.repeat(32),
      // Error with an empty message → e?.message is falsy → `|| ''` fallback, not a mismatch
      fetchPrivateBalance: vi.fn().mockRejectedValue(new Error('')),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, true, true, undefined, COTI_TESTNET);
    expect(ok).toBe(false);
  });

  it('uses the "0" fallback when a fetched private balance value is nullish (line 164)', async () => {
    const props = makeProps({
      sessionAesKey: 'c'.repeat(32),
      // resolve a nullish value to exercise `result?.value ?? '0'`
      fetchPrivateBalance: vi.fn().mockResolvedValue(null),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, true, true, undefined, COTI_TESTNET);
    expect(ok).toBe(true);
    expect(props.setPrivateTokens).toHaveBeenCalledTimes(1);
  });

  it('treats a private token without an addressKey as having no address (line 129 alternate)', async () => {
    const props = makeProps({ sessionAesKey: 'd'.repeat(32) });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, true, true, undefined, KEYLESS_CHAIN);
    expect(ok).toBe(true);
    expect(props.fetchPrivateBalance).not.toHaveBeenCalled();
    const privTokens = props.setPrivateTokens.mock.calls[0][0];
    expect(privTokens[0].symbol).toBe('NOKEY');
  });
});
