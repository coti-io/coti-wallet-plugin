import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBalanceUpdater } from '../../src/hooks/useBalanceUpdater';
import { CotiPluginError, CotiErrorCode } from '../../src/errors';

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

const COTI_TESTNET = 7082400;
const SEPOLIA = 11155111;
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

describe('useBalanceUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getNetwork.mockResolvedValue({ chainId: BigInt(COTI_TESTNET) });
    h.getBalance.mockResolvedValue(1500000000000000000n);
    h.contractBalanceOf.mockResolvedValue(1000000n);
    h.formatEther.mockReturnValue('1.5');
    h.formatUnits.mockReturnValue('1.0');
  });

  it('marks connected and skips balance fetch when no provider and no chain override', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    const props = makeProps();
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT);

    expect(ok).toBe(true);
    expect(props.setWalletAddress).toHaveBeenCalledWith(ACCOUNT);
    expect(props.setIsConnected).toHaveBeenCalledWith(true);
    expect(props.setPublicTokens).not.toHaveBeenCalled();

    (window as any).ethereum = original;
  });

  it('uses a JsonRpcProvider for the read path when chainOverride is given (no window.ethereum)', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    const props = makeProps();
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, false, false, null, COTI_TESTNET);

    expect(ok).toBe(true);
    // checkNetwork only runs when a BrowserProvider exists
    expect(props.checkNetwork).not.toHaveBeenCalled();
    expect(props.setPublicTokens).toHaveBeenCalledTimes(1);
    const tokens = props.setPublicTokens.mock.calls[0][0];
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);

    (window as any).ethereum = original;
  });

  it('uses BrowserProvider and calls checkNetwork when window.ethereum is present', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, false, false);

    expect(ok).toBe(true);
    expect(props.checkNetwork).toHaveBeenCalledTimes(1);
    expect(h.getNetwork).toHaveBeenCalled();
    expect(props.setPublicTokens).toHaveBeenCalledTimes(1);
  });

  it('fetches private balances with an aesKey override and updates private tokens', async () => {
    const props = makeProps({
      fetchPrivateBalance: vi.fn().mockResolvedValue('42'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(
      ACCOUNT,
      true,
      true,
      'a'.repeat(64),
      COTI_TESTNET,
    );

    expect(ok).toBe(true);
    expect(props.fetchPrivateBalance).toHaveBeenCalled();
    expect(props.setPrivateTokens).toHaveBeenCalledTimes(1);
    // No snap fetch needed since an override key was supplied
    expect(props.getAESKeyFromSnap).not.toHaveBeenCalled();
  });

  it('retrieves the AES key from the snap and caches it when no session key exists', async () => {
    const props = makeProps({
      getAESKeyFromSnap: vi.fn().mockResolvedValue('b'.repeat(64)),
      fetchPrivateBalance: vi.fn().mockResolvedValue('7'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, true, true, undefined, COTI_TESTNET);

    expect(ok).toBe(true);
    expect(props.getAESKeyFromSnap).toHaveBeenCalledWith(ACCOUNT);
    expect(props.setSessionAesKey).toHaveBeenCalledWith('b'.repeat(64), ACCOUNT);
    expect(props.setHasSnap).toHaveBeenCalledWith(true);
  });

  it('uses an existing session key and marks snap available without fetching from snap', async () => {
    const props = makeProps({
      sessionAesKey: 'c'.repeat(64),
      fetchPrivateBalance: vi.fn().mockResolvedValue('9'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, true, true, undefined, COTI_TESTNET);

    expect(ok).toBe(true);
    expect(props.getAESKeyFromSnap).not.toHaveBeenCalled();
    expect(props.setHasSnap).toHaveBeenCalledWith(true);
    expect(props.setPrivateTokens).toHaveBeenCalledTimes(1);
  });

  it('returns false when no AES key can be obtained for private balances', async () => {
    const props = makeProps({
      getAESKeyFromSnap: vi.fn().mockResolvedValue(null),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, true, true, undefined, COTI_TESTNET);

    expect(ok).toBe(false);
    expect(props.setPrivateTokens).not.toHaveBeenCalled();
  });

  it('applies zero balances when a private balance decrypt mismatches instead of failing the refresh', async () => {
    const props = makeProps({
      sessionAesKey: 'd'.repeat(64),
      fetchPrivateBalance: vi.fn().mockRejectedValue(new Error('AES key mismatch')),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, true, true, undefined, COTI_TESTNET);
    expect(ok).toBe(true);
    expect(props.setPrivateTokens).toHaveBeenCalledTimes(1);
  });

  it('fetches private balances when fetchPrivate is true even if checkSnap is false', async () => {
    const props = makeProps({
      fetchPrivateBalance: vi.fn().mockResolvedValue('1.5'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, false, true, undefined, SEPOLIA);
    expect(ok).toBe(true);
    expect(props.fetchPrivateBalance).toHaveBeenCalled();
    expect(props.setPrivateTokens).toHaveBeenCalledTimes(1);
  });

  it('returns false (not throw) on a non-mismatch private fetch error', async () => {
    const props = makeProps({
      sessionAesKey: 'e'.repeat(64),
      fetchPrivateBalance: vi.fn().mockRejectedValue(new Error('network blip')),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, true, true, undefined, COTI_TESTNET);
    expect(ok).toBe(false);
  });

  it('rethrows a CotiPluginError raised by checkNetwork', async () => {
    const props = makeProps({
      checkNetwork: vi.fn().mockRejectedValue(
        new CotiPluginError(CotiErrorCode.UNSUPPORTED_NETWORK, 'bad net'),
      ),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    await expect(
      result.current.updateAccountState(ACCOUNT, false, false),
    ).rejects.toMatchObject({ code: CotiErrorCode.UNSUPPORTED_NETWORK });
  });

  it('returns false on a generic (non-Coti) error during update', async () => {
    const props = makeProps({
      checkNetwork: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.updateAccountState(ACCOUNT, false, false);
    expect(ok).toBe(false);
  });

  it('ignores stale public balance updates when a newer updateAccountState starts', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    let resolveSlowBalance!: (value: bigint) => void;
    const slowBalance = new Promise<bigint>(resolve => {
      resolveSlowBalance = resolve;
    });

    h.getBalance
      .mockReturnValueOnce(slowBalance)
      .mockResolvedValue(2000000000000000000n);
    h.formatEther.mockReturnValueOnce('1.5').mockReturnValueOnce('2.0');

    const props = makeProps();
    const { result } = renderHook(() => useBalanceUpdater(props));

    const accountB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const slowUpdate = result.current.updateAccountState(ACCOUNT, false, false, null, COTI_TESTNET);
    const fastUpdate = result.current.updateAccountState(accountB, false, false, null, COTI_TESTNET);

    resolveSlowBalance(1500000000000000000n);
    const [slowOk, fastOk] = await Promise.all([slowUpdate, fastUpdate]);

    expect(slowOk).toBe(false);
    expect(fastOk).toBe(true);
    expect(props.setPublicTokens).toHaveBeenCalledTimes(1);
    expect(props.setWalletAddress).toHaveBeenLastCalledWith(accountB);

    (window as any).ethereum = original;
  });

  it('ignores stale private balance updates when a newer updateAccountState starts', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    let resolveSlowPrivate!: (value: string) => void;
    const slowPrivate = new Promise<string>(resolve => {
      resolveSlowPrivate = resolve;
    });

    const props = makeProps({
      sessionAesKey: 'f'.repeat(64),
      fetchPrivateBalance: vi
        .fn()
        .mockReturnValueOnce(slowPrivate)
        .mockResolvedValue('99'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const accountB = '0xcccccccccccccccccccccccccccccccccccccccc';
    const slowUpdate = result.current.updateAccountState(
      ACCOUNT,
      true,
      true,
      undefined,
      COTI_TESTNET,
    );
    const fastUpdate = result.current.updateAccountState(
      accountB,
      true,
      true,
      'a'.repeat(64),
      COTI_TESTNET,
    );

    resolveSlowPrivate('11');
    const [slowOk, fastOk] = await Promise.all([slowUpdate, fastUpdate]);

    expect(slowOk).toBe(false);
    expect(fastOk).toBe(true);
    expect(props.setPrivateTokens).toHaveBeenCalledTimes(1);
    expect(props.setWalletAddress).toHaveBeenLastCalledWith(accountB);

    (window as any).ethereum = original;
  });

  it('does not throw AES_KEY_MISMATCH from a stale private balance request', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    let rejectSlowPrivate!: (error: Error) => void;
    const slowPrivate = new Promise<string>((_, reject) => {
      rejectSlowPrivate = reject;
    });
    const accountB = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

    const props = makeProps({
      sessionAesKey: 'd'.repeat(64),
      fetchPrivateBalance: vi.fn().mockImplementation((userAddress: string) =>
        userAddress === ACCOUNT ? slowPrivate : Promise.resolve('5'),
      ),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const slowUpdate = result.current.updateAccountState(
      ACCOUNT,
      true,
      true,
      undefined,
      COTI_TESTNET,
    );
    await vi.waitFor(() => {
      expect(props.fetchPrivateBalance).toHaveBeenCalled();
    });
    const fastUpdate = result.current.updateAccountState(
      accountB,
      true,
      true,
      'e'.repeat(64),
      COTI_TESTNET,
    );

    await fastUpdate;
    rejectSlowPrivate(new Error('AES key mismatch'));
    const slowOk = await slowUpdate;

    expect(slowOk).toBe(false);

    (window as any).ethereum = original;
  });

  it('does not cache snap AES key from a stale request superseded before getAESKeyFromSnap returns', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    let resolveSlowSnap!: (value: string) => void;
    const slowSnap = new Promise<string>(resolve => {
      resolveSlowSnap = resolve;
    });

    const props = makeProps({
      getAESKeyFromSnap: vi.fn().mockImplementation((userAddress: string) =>
        userAddress === ACCOUNT ? slowSnap : Promise.resolve('b'.repeat(64)),
      ),
      fetchPrivateBalance: vi.fn().mockResolvedValue('7'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const accountB = '0xdddddddddddddddddddddddddddddddddddddddd';
    const slowUpdate = result.current.updateAccountState(
      ACCOUNT,
      true,
      true,
      undefined,
      COTI_TESTNET,
    );
    await vi.waitFor(() => {
      expect(props.getAESKeyFromSnap).toHaveBeenCalledWith(ACCOUNT);
    });
    const fastUpdate = result.current.updateAccountState(
      accountB,
      true,
      true,
      undefined,
      COTI_TESTNET,
    );

    await fastUpdate;
    resolveSlowSnap('a'.repeat(64));
    const slowOk = await slowUpdate;

    expect(slowOk).toBe(false);
    expect(props.setSessionAesKey).not.toHaveBeenCalledWith('a'.repeat(64), ACCOUNT);
    expect(props.setSessionAesKey).toHaveBeenCalledWith('b'.repeat(64), accountB);

    (window as any).ethereum = original;
  });
});
