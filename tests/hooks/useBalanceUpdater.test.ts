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
  createJsonRpcProvider: vi.fn((_url: string, _chainId: number) => ({
    getBalance: h.getBalance,
    getNetwork: h.getNetwork,
    send: vi.fn(),
  })),
  resolveRpcUrlsForChain: vi.fn(() => ['http://rpc-test.example']),
  withRpcFallback: vi.fn(async (_chainId: number, fn: (provider: unknown) => Promise<unknown>) =>
    fn({
      getBalance: h.getBalance,
      getNetwork: h.getNetwork,
    })),
  isTransientRpcError: vi.fn(() => true),
  markPrimaryRateLimited: vi.fn(),
  markFujiPrimaryRateLimited: vi.fn(),
  isRateLimitedRpcError: (error: unknown) => {
    const msg = `${(error as { message?: string })?.message ?? error ?? ''}`.toLowerCase();
    return msg.includes('rate limit')
      || msg.includes('too many requests')
      || msg.includes('429')
      || msg.includes('-32005');
  },
}));

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

  it('does not write token catalogs when autoInitTokens is false', async () => {
    (window as any).ethereum = { request: vi.fn() };
    const props = makeProps({ autoInitTokens: false, sessionAesKey: 'a'.repeat(32) });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const aes = await result.current.establishAesSession({
      account: ACCOUNT,
      aesKey: 'a'.repeat(32),
      chainId: COTI_TESTNET,
    });
    const catalogs = await result.current.refreshPrivateBalances({
      account: ACCOUNT,
      aesKey: 'a'.repeat(32),
      chainId: COTI_TESTNET,
    });

    expect(aes.ok).toBe(true);
    expect(catalogs.ok).toBe(true);
    expect(props.setPublicTokens).not.toHaveBeenCalled();
    expect(props.setPrivateTokens).not.toHaveBeenCalled();
    expect(h.getBalance).not.toHaveBeenCalled();
    expect(props.setSessionAesKey).toHaveBeenCalled();
  });

  it('returns false when private catalog refresh has no provider or chain override', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    const props = makeProps({ sessionAesKey: 'a'.repeat(32) });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.refreshPrivateBalances({ account: ACCOUNT });

    expect(ok.ok).toBe(false);
    expect(props.setSessionAesKey).not.toHaveBeenCalled();
    expect(props.setPrivateTokens).not.toHaveBeenCalled();

    (window as any).ethereum = original;
  });

  it('returns false when fetchPrivate is requested for a chain without contract addresses', async () => {
    const props = makeProps({ sessionAesKey: 'a'.repeat(32) });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.refreshPrivateBalances({
      account: ACCOUNT,
      aesKey: 'a'.repeat(32),
      chainId: 999999,
    });

    expect(ok.ok).toBe(false);
    expect(props.setPrivateTokens).not.toHaveBeenCalled();
  });

  it('marks connected and skips balance fetch when no provider and no chain override', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    const props = makeProps();
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.bindAccount(ACCOUNT);

    expect(ok.ok).toBe(true);
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

    const ok = await result.current.refreshPublicBalances({ account: ACCOUNT, chainId: COTI_TESTNET });

    expect(ok.ok).toBe(true);
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

    const ok = await result.current.refreshPublicBalances({ account: ACCOUNT });

    expect(ok.ok).toBe(true);
    expect(props.checkNetwork).toHaveBeenCalledTimes(1);
    expect(h.getNetwork).toHaveBeenCalled();
    expect(props.setPublicTokens).toHaveBeenCalledTimes(1);
  });

  it('fetches private balances with an aesKey override and updates private tokens', async () => {
    const props = makeProps({
      fetchPrivateBalance: vi.fn().mockResolvedValue('42'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.refreshPrivateBalances({
      account: ACCOUNT,
      aesKey: 'a'.repeat(32),
      chainId: COTI_TESTNET,
    });

    expect(ok.ok).toBe(true);
    expect(props.fetchPrivateBalance).toHaveBeenCalled();
    expect(props.setPrivateTokens).toHaveBeenCalledTimes(1);
    // No snap fetch needed since an override key was supplied
    expect(props.getAESKeyFromSnap).not.toHaveBeenCalled();
  });

  it('retrieves the AES key from the snap and caches it when no session key exists', async () => {
    const props = makeProps({
      getAESKeyFromSnap: vi.fn().mockResolvedValue('b'.repeat(32)),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.establishAesSession({ account: ACCOUNT, checkSnap: true, chainId: COTI_TESTNET });

    expect(ok.ok).toBe(true);
    expect(props.getAESKeyFromSnap).toHaveBeenCalledWith(ACCOUNT);
    expect(props.setSessionAesKey).toHaveBeenCalledWith('b'.repeat(32), ACCOUNT);
    expect(props.setHasSnap).not.toHaveBeenCalled();
  });

  it('uses an existing session key without fetching from snap', async () => {
    const props = makeProps({
      sessionAesKey: 'c'.repeat(32),
      fetchPrivateBalance: vi.fn().mockResolvedValue('9'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.refreshPrivateBalances({ account: ACCOUNT, chainId: COTI_TESTNET });

    expect(ok.ok).toBe(true);
    expect(props.getAESKeyFromSnap).not.toHaveBeenCalled();
    expect(props.setHasSnap).not.toHaveBeenCalled();
    expect(props.setPrivateTokens).toHaveBeenCalledTimes(1);
  });

  it('returns false when no AES key can be obtained for the session', async () => {
    const props = makeProps({
      getAESKeyFromSnap: vi.fn().mockResolvedValue(null),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.establishAesSession({ account: ACCOUNT, checkSnap: true, chainId: COTI_TESTNET });

    expect(ok.ok).toBe(false);
    expect(props.setSessionAesKey).not.toHaveBeenCalled();
  });

  it('throws AES_KEY_MISMATCH when a private balance decrypt mismatches', async () => {
    const props = makeProps({
      sessionAesKey: 'd'.repeat(32),
      fetchPrivateBalance: vi.fn().mockRejectedValue(new Error('AES key mismatch')),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    await expect(
      result.current.refreshPrivateBalances({ account: ACCOUNT, chainId: COTI_TESTNET }),
    ).rejects.toMatchObject({ code: CotiErrorCode.AES_KEY_MISMATCH });
    expect(props.setPrivateTokens).not.toHaveBeenCalled();
  });

  it('fetches private balances from the session key without Snap AES fetch', async () => {
    const props = makeProps({
      sessionAesKey: 'f'.repeat(64),
      fetchPrivateBalance: vi.fn().mockResolvedValue('1.5'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.refreshPrivateBalances({ account: ACCOUNT, chainId: SEPOLIA });
    expect(ok.ok).toBe(true);
    expect(props.fetchPrivateBalance).toHaveBeenCalled();
    expect(props.setPrivateTokens).toHaveBeenCalledTimes(1);
  });

  it('returns false (not throw) on a non-mismatch private fetch error', async () => {
    const props = makeProps({
      sessionAesKey: 'e'.repeat(32),
      fetchPrivateBalance: vi.fn().mockRejectedValue(new Error('network blip')),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.refreshPrivateBalances({ account: ACCOUNT, chainId: COTI_TESTNET });
    expect(ok.ok).toBe(false);
  });

  it('marks an AES key validated on establishAesSession even if catalogs are not written', async () => {
    const {
      clearAesKeyValidatedForUnlock,
      isAesKeyValidatedForUnlock,
    } = await import('../../src/crypto/aesKeyValidation');
    clearAesKeyValidatedForUnlock();

    const aesKey = 'e'.repeat(32);
    const validateMetaMaskAesKeyOnUnlock = vi.fn().mockResolvedValue(undefined);
    const props = makeProps({
      sessionAesKey: aesKey,
      validateMetaMaskAesKeyOnUnlock,
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.establishAesSession({
      account: ACCOUNT,
      checkSnap: true,
      chainId: COTI_TESTNET,
      options: { validateOnUnlock: true },
    });

    expect(ok.ok).toBe(true);
    expect(validateMetaMaskAesKeyOnUnlock).toHaveBeenCalled();
    expect(isAesKeyValidatedForUnlock(ACCOUNT, aesKey)).toBe(true);
    clearAesKeyValidatedForUnlock();
  });

  it('rethrows a CotiPluginError raised by checkNetwork', async () => {
    const props = makeProps({
      checkNetwork: vi.fn().mockRejectedValue(
        new CotiPluginError(CotiErrorCode.UNSUPPORTED_NETWORK, 'bad net'),
      ),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    await expect(
      result.current.refreshPublicBalances({ account: ACCOUNT }),
    ).rejects.toMatchObject({ code: CotiErrorCode.UNSUPPORTED_NETWORK });
  });

  it('returns false on a generic (non-Coti) error during update', async () => {
    const props = makeProps({
      checkNetwork: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.refreshPublicBalances({ account: ACCOUNT });
    expect(ok.ok).toBe(false);
  });

  it('ignores stale public balance updates when a newer refreshPublicBalances starts', async () => {
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
    const slowUpdate = result.current.refreshPublicBalances({ account: ACCOUNT, chainId: COTI_TESTNET });
    const fastUpdate = result.current.refreshPublicBalances({ account: accountB, chainId: COTI_TESTNET });

    resolveSlowBalance(1500000000000000000n);
    const [slowOk, fastOk] = await Promise.all([slowUpdate, fastUpdate]);

    expect(slowOk.ok).toBe(false);
    expect(fastOk.ok).toBe(true);
    expect(props.setPublicTokens).toHaveBeenCalledTimes(1);
    expect(props.setWalletAddress).toHaveBeenLastCalledWith(accountB);

    (window as any).ethereum = original;
  });

  it('ignores stale private balance updates when a newer refreshPrivateBalances starts', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    let resolveSlowPrivate!: (value: string) => void;
    const slowPrivate = new Promise<string>(resolve => {
      resolveSlowPrivate = resolve;
    });

    const props = makeProps({
      sessionAesKey: 'f'.repeat(32),
      fetchPrivateBalance: vi
        .fn()
        .mockReturnValueOnce(slowPrivate)
        .mockResolvedValue('99'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const accountB = '0xcccccccccccccccccccccccccccccccccccccccc';
    const slowUpdate = result.current.refreshPrivateBalances({
      account: ACCOUNT,
      chainId: COTI_TESTNET,
    });
    const fastUpdate = result.current.refreshPrivateBalances({
      account: accountB,
      aesKey: 'a'.repeat(32),
      chainId: COTI_TESTNET,
    });

    resolveSlowPrivate('11');
    const [slowOk, fastOk] = await Promise.all([slowUpdate, fastUpdate]);

    expect(slowOk.ok).toBe(false);
    expect(fastOk.ok).toBe(true);
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
      sessionAesKey: 'd'.repeat(32),
      fetchPrivateBalance: vi.fn().mockImplementation((userAddress: string) =>
        userAddress === ACCOUNT ? slowPrivate : Promise.resolve('5'),
      ),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const slowUpdate = result.current.refreshPrivateBalances({
      account: ACCOUNT,
      chainId: COTI_TESTNET,
    });
    await vi.waitFor(() => {
      expect(props.fetchPrivateBalance).toHaveBeenCalled();
    });
    const fastUpdate = result.current.refreshPrivateBalances({
      account: accountB,
      aesKey: 'e'.repeat(32),
      chainId: COTI_TESTNET,
    });

    await fastUpdate;
    rejectSlowPrivate(new Error('AES key mismatch'));
    const slowOk = await slowUpdate;

    expect(slowOk.ok).toBe(false);

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
        userAddress === ACCOUNT ? slowSnap : Promise.resolve('b'.repeat(32)),
      ),
      fetchPrivateBalance: vi.fn().mockResolvedValue('7'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const accountB = '0xdddddddddddddddddddddddddddddddddddddddd';
    const slowUpdate = result.current.establishAesSession({
      account: ACCOUNT,
      checkSnap: true,
      chainId: COTI_TESTNET,
    });
    await vi.waitFor(() => {
      expect(props.getAESKeyFromSnap).toHaveBeenCalledWith(ACCOUNT);
    });
    const fastUpdate = result.current.establishAesSession({
      account: accountB,
      checkSnap: true,
      chainId: COTI_TESTNET,
    });

    await fastUpdate;
    resolveSlowSnap('a'.repeat(32));
    const slowOk = await slowUpdate;

    expect(slowOk.ok).toBe(false);
    expect(props.setSessionAesKey).not.toHaveBeenCalledWith('a'.repeat(32), ACCOUNT);
    expect(props.setSessionAesKey).toHaveBeenCalledWith('b'.repeat(32), accountB);

    (window as any).ethereum = original;
  });

  it('reuses session AES key on validateOnUnlock without calling Snap when already validated', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    const { markAesKeyValidatedForUnlock, clearAesKeyValidatedForUnlock } = await import(
      '../../src/crypto/aesKeyValidation'
    );
    clearAesKeyValidatedForUnlock();
    const sessionKey = 'a'.repeat(32);
    markAesKeyValidatedForUnlock(ACCOUNT, sessionKey);

    const validateMetaMaskAesKeyOnUnlock = vi.fn();
    const props = makeProps({
      sessionAesKey: sessionKey,
      validateMetaMaskAesKeyOnUnlock,
      fetchPrivateBalance: vi.fn().mockResolvedValue('42'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.establishAesSession({
      account: ACCOUNT,
      aesKey: sessionKey,
      chainId: COTI_TESTNET,
      options: { validateOnUnlock: true },
    });

    expect(ok.ok).toBe(true);
    expect(props.getAESKeyFromSnap).not.toHaveBeenCalled();
    expect(validateMetaMaskAesKeyOnUnlock).not.toHaveBeenCalled();
    clearAesKeyValidatedForUnlock();

    (window as any).ethereum = original;
  });

  it('fetches AES key for force-contract onboarding even when session key exists', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    const sessionKey = 'a'.repeat(32);
    const contractKey = 'b'.repeat(32);
    const props = makeProps({
      sessionAesKey: sessionKey,
      getAESKeyFromSnap: vi.fn().mockResolvedValue(contractKey),
      fetchPrivateBalance: vi.fn().mockResolvedValue('42'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const aes = await result.current.establishAesSession({
      account: ACCOUNT,
      checkSnap: true,
      chainId: COTI_TESTNET,
      options: { validateOnUnlock: true, forceContractOnboarding: true },
    });
    const ok = await result.current.refreshPrivateBalances({
      account: ACCOUNT,
      aesKey: contractKey,
      chainId: COTI_TESTNET,
      allowSnapDecrypt: false,
    });

    expect(aes.ok).toBe(true);
    expect(ok.ok).toBe(true);
    expect(props.getAESKeyFromSnap).toHaveBeenCalledWith(ACCOUNT, {
      skipCache: true,
      forceContractOnboarding: true,
    });
    expect(props.fetchPrivateBalance).toHaveBeenCalledWith(
      ACCOUNT,
      contractKey,
      expect.any(String),
      256,
      expect.any(Number),
      COTI_TESTNET,
      expect.any(Boolean),
      undefined,
    );
    expect(props.setSessionAesKey).toHaveBeenCalledWith(contractKey, ACCOUNT);

    (window as any).ethereum = original;
  });

  it('validates session AES key on validateOnUnlock without re-fetching from Snap', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    const { clearAesKeyValidatedForUnlock } = await import('../../src/crypto/aesKeyValidation');
    clearAesKeyValidatedForUnlock();

    const sessionKey = 'b'.repeat(32);
    const validateMetaMaskAesKeyOnUnlock = vi.fn().mockResolvedValue(undefined);
    const props = makeProps({
      sessionAesKey: sessionKey,
      validateMetaMaskAesKeyOnUnlock,
      fetchPrivateBalance: vi.fn().mockResolvedValue('42'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.establishAesSession({
      account: ACCOUNT,
      aesKey: sessionKey,
      chainId: COTI_TESTNET,
      options: { validateOnUnlock: true },
    });

    expect(ok.ok).toBe(true);
    expect(props.getAESKeyFromSnap).not.toHaveBeenCalled();
    expect(validateMetaMaskAesKeyOnUnlock).toHaveBeenCalledWith(sessionKey, ACCOUNT, COTI_TESTNET);
    clearAesKeyValidatedForUnlock();

    (window as any).ethereum = original;
  });

  it('uses Snap-side decrypt on restoreOnly unlock without fetching raw AES key', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;

    const snapDecryptOptions = { decryptCtUint64: vi.fn(), decryptCtUint256: vi.fn() };
    const props = makeProps({
      canUseSnapOperations: true,
      snapDecryptOptions,
      fetchPrivateBalance: vi.fn().mockResolvedValue('3'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const aes = await result.current.establishAesSession({
      account: ACCOUNT,
      chainId: COTI_TESTNET,
      options: { restoreOnly: true, snapSideDecrypt: true },
    });
    const ok = await result.current.refreshPrivateBalances({
      account: ACCOUNT,
      chainId: COTI_TESTNET,
      allowSnapDecrypt: true,
    });

    expect(aes.ok).toBe(true);
    expect(ok.ok).toBe(true);
    expect(props.getAESKeyFromSnap).not.toHaveBeenCalled();
    expect(props.setHasSnap).toHaveBeenCalledWith(true);
    expect(props.fetchPrivateBalance).toHaveBeenCalledWith(
      ACCOUNT,
      '',
      expect.any(String),
      256,
      expect.any(Number),
      COTI_TESTNET,
      expect.any(Boolean),
      snapDecryptOptions,
    );

    (window as any).ethereum = original;
  });

  it('returns false when unlock AES key fetch is cancelled on chains with plain private tokens', async () => {
    const props = makeProps({
      getAESKeyFromSnap: vi.fn().mockResolvedValue(null),
      fetchPrivateBalance: vi.fn().mockResolvedValue('1.0'),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.establishAesSession({
      account: ACCOUNT,
      checkSnap: true,
      chainId: SEPOLIA,
      options: { validateOnUnlock: true, forceContractOnboarding: true },
    });

    expect(ok.ok).toBe(false);
    expect(props.fetchPrivateBalance).not.toHaveBeenCalled();
    expect(props.setSessionAesKey).not.toHaveBeenCalled();
  });

  it('fetches AES key before public balance RPCs on restore-only unlock', async () => {
    const callOrder: string[] = [];
    const props = makeProps({
      getAESKeyFromSnap: vi.fn().mockImplementation(async () => {
        callOrder.push('aes-key');
        return 'a'.repeat(32);
      }),
      checkNetwork: vi.fn().mockImplementation(async () => {
        callOrder.push('check-network');
      }),
      fetchPrivateBalance: vi.fn().mockResolvedValue('1'),
    });
    h.getBalance.mockImplementation(async () => {
      callOrder.push('public-balance');
      return 0n;
    });

    const { result } = renderHook(() => useBalanceUpdater(props));
    const ok = await result.current.establishAesSession({
      account: ACCOUNT,
      checkSnap: true,
      chainId: COTI_TESTNET,
      options: { restoreOnly: true, validateOnUnlock: true },
    });

    expect(ok.ok).toBe(true);
    expect(callOrder[0]).toBe('aes-key');
    expect(callOrder).not.toContain('public-balance');
    expect(callOrder).not.toContain('check-network');
  });

  it('loads a restore-only Snap key without skipCache when not validating', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;
    const props = makeProps({
      getAESKeyFromSnap: vi.fn().mockResolvedValue('c'.repeat(32)),
    });
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.establishAesSession({
      account: ACCOUNT,
      checkSnap: true,
      chainId: COTI_TESTNET,
      options: { restoreOnly: true },
    });

    expect(ok.ok).toBe(true);
    expect(props.getAESKeyFromSnap).toHaveBeenCalledWith(ACCOUNT, { restoreOnly: true });
    expect(props.setSessionAesKey).toHaveBeenCalledWith('c'.repeat(32), ACCOUNT);

    (window as any).ethereum = original;
  });

  it('returns keys_unavailable when private catalogs have no AES key or Snap', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.refreshPrivateBalances({
      account: ACCOUNT,
      chainId: COTI_TESTNET,
    });

    expect(ok).toEqual({ ok: false, reason: 'keys_unavailable' });
    expect(props.setPrivateTokens).not.toHaveBeenCalled();
  });

  it('reads Fuji public balances through the JsonRpc fallback path', async () => {
    const original = (window as any).ethereum;
    delete (window as any).ethereum;
    const FUJI = 43113;
    const props = makeProps();
    const { result } = renderHook(() => useBalanceUpdater(props));

    const ok = await result.current.refreshPublicBalances({ account: ACCOUNT, chainId: FUJI });
    expect(ok.ok).toBe(true);
    expect(props.setPublicTokens).toHaveBeenCalled();

    (window as any).ethereum = original;
  });
});
