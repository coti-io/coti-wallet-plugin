import { describe, it, expect, vi } from 'vitest';
import { CotiPluginError, CotiErrorCode } from '../../../src/errors';
import { COTI_TESTNET_CHAIN_ID } from '../../../src/chains/coti';
import { SEPOLIA_CHAIN_ID } from '../../../src/chains/sepolia';
import { AVALANCHE_FUJI_CHAIN_ID } from '../../../src/chains/avalancheFuji';

const rpc = vi.hoisted(() => ({
  withRpcFallback: vi.fn(),
}));

vi.mock('../../../src/lib/rpcProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/rpcProvider')>();
  return {
    ...actual,
    withRpcFallback: (...args: unknown[]) => rpc.withRpcFallback(...args),
  };
});

import { writePublicBalances, writePrivateBalances } from '../../../src/hooks/accountState/tokenBalances';

describe('tokenBalances catalog writes', () => {
  it('writes 0 for public tokens whose address is missing from chain config', async () => {
    const setPublicTokens = vi.fn();
    const readProvider = {
      getBalance: vi.fn().mockResolvedValue(10n ** 18n),
    };

    const result = await writePublicBalances({
      account: '0x' + 'a'.repeat(40),
      currentChainId: COTI_TESTNET_CHAIN_ID,
      addresses: {},
      readProvider: readProvider as never,
      useFujiRpcFallback: false,
      isStale: () => false,
      setPublicTokens,
      raiseFujiRateLimited: () => {
        throw new Error('unexpected');
      },
    });

    expect(result).toEqual({ ok: true });
    expect(setPublicTokens).toHaveBeenCalled();
    const tokens = setPublicTokens.mock.calls[0][0] as Array<{ isNative?: boolean; balance: string }>;
    expect(tokens.some(token => !token.isNative && token.balance === '0')).toBe(true);
  });

  it('writes 0 for private tokens whose address is missing from chain config', async () => {
    const setPrivateTokens = vi.fn();
    const fetchPrivateBalance = vi.fn();
    const result = await writePrivateBalances({
      account: '0x' + 'a'.repeat(40),
      aesKey: 'a'.repeat(32),
      currentChainId: COTI_TESTNET_CHAIN_ID,
      addresses: {},
      allowSnap: false,
      isStale: () => false,
      fetchPrivateBalance,
      setPrivateTokens,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchPrivateBalance).not.toHaveBeenCalled();
    expect(setPrivateTokens).toHaveBeenCalled();
  });

  it('rethrows Fuji public ERC20 failures after reporting rate limits', async () => {
    rpc.withRpcFallback
      .mockResolvedValueOnce(10n ** 18n)
      .mockRejectedValue(new CotiPluginError(CotiErrorCode.RPC_RATE_LIMITED, 'limited'));
    const raiseFujiRateLimited = vi.fn(() => {
      throw new CotiPluginError(CotiErrorCode.RPC_RATE_LIMITED, 'limited');
    });
    await expect(writePublicBalances({
      account: '0x' + 'a'.repeat(40),
      currentChainId: AVALANCHE_FUJI_CHAIN_ID,
      addresses: { MTT: '0x' + 'b'.repeat(40), USDC: '0x' + 'c'.repeat(40), WAVAX: '0x' + 'd'.repeat(40) },
      readProvider: { getBalance: vi.fn() } as never,
      useFujiRpcFallback: true,
      isStale: () => false,
      setPublicTokens: vi.fn(),
      raiseFujiRateLimited,
    })).rejects.toMatchObject({ code: CotiErrorCode.RPC_RATE_LIMITED });
    expect(raiseFujiRateLimited).toHaveBeenCalled();
  });

  it('rethrows non-rate-limited Fuji ERC20 failures without the Fuji helper', async () => {
    rpc.withRpcFallback
      .mockResolvedValueOnce(10n ** 18n)
      .mockRejectedValue(new Error('rpc down'));
    const raiseFujiRateLimited = vi.fn(() => {
      throw new Error('Fuji helper must not run');
    });
    await expect(writePublicBalances({
      account: '0x' + 'a'.repeat(40),
      currentChainId: AVALANCHE_FUJI_CHAIN_ID,
      addresses: { MTT: '0x' + 'b'.repeat(40), USDC: '0x' + 'c'.repeat(40), WAVAX: '0x' + 'd'.repeat(40) },
      readProvider: { getBalance: vi.fn() } as never,
      useFujiRpcFallback: true,
      isStale: () => false,
      setPublicTokens: vi.fn(),
      raiseFujiRateLimited,
    })).rejects.toThrow('rpc down');
    expect(raiseFujiRateLimited).not.toHaveBeenCalled();
  });

  it('does not use the Fuji rate-limit helper on other chains', async () => {
    const raiseFujiRateLimited = vi.fn(() => {
      throw new Error('Fuji helper must not run off Fuji');
    });
    const rateLimited = new CotiPluginError(CotiErrorCode.RPC_RATE_LIMITED, 'too many requests');

    await expect(writePublicBalances({
      account: '0x' + 'a'.repeat(40),
      currentChainId: COTI_TESTNET_CHAIN_ID,
      addresses: { WETH: '0x' + 'b'.repeat(40) },
      readProvider: {
        getBalance: vi.fn().mockResolvedValue(10n ** 18n),
        call: vi.fn().mockRejectedValue(rateLimited),
      } as never,
      useFujiRpcFallback: false,
      isStale: () => false,
      setPublicTokens: vi.fn(),
      raiseFujiRateLimited,
    })).rejects.toMatchObject({ code: CotiErrorCode.RPC_RATE_LIMITED });
    expect(raiseFujiRateLimited).not.toHaveBeenCalled();
  });

  it('returns keys_unavailable when no AES key, Snap, or plain private tokens exist', async () => {
    const setPrivateTokens = vi.fn();
    const result = await writePrivateBalances({
      account: '0x' + 'a'.repeat(40),
      aesKey: null,
      currentChainId: COTI_TESTNET_CHAIN_ID,
      addresses: {},
      allowSnap: false,
      isStale: () => false,
      fetchPrivateBalance: vi.fn(),
      setPrivateTokens,
    });
    expect(result).toEqual({ ok: false, reason: 'keys_unavailable' });
    expect(setPrivateTokens).not.toHaveBeenCalled();
  });

  it('skips encrypted private tokens when only a plain native private token is fetchable', async () => {
    const fetchPrivateBalance = vi.fn().mockResolvedValue('1.00');
    const setPrivateTokens = vi.fn();
    const result = await writePrivateBalances({
      account: '0x' + 'a'.repeat(40),
      aesKey: null,
      currentChainId: SEPOLIA_CHAIN_ID,
      addresses: {
        'p.MTT': '0x' + 'b'.repeat(40),
        'p.ETH': '0x' + 'c'.repeat(40),
        'p.USDC': '0x' + 'd'.repeat(40),
      },
      allowSnap: false,
      isStale: () => false,
      fetchPrivateBalance,
      setPrivateTokens,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchPrivateBalance).toHaveBeenCalledTimes(1);
    expect(fetchPrivateBalance.mock.calls[0][2]).toBe('0x' + 'c'.repeat(40));
    expect(fetchPrivateBalance.mock.calls[0][6]).toBe(true);
  });
});
