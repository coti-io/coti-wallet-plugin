import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Full-flow tests for the Sepolia PoD portal executor.
 *
 * `ethers` is mocked via `importOriginal` so that pure helpers (Interface,
 * parseUnits, Signature, ZeroHash) stay real while `Contract` is swapped for a
 * controllable stub whose methods are backed by hoisted spies. `@coti/pod-sdk`
 * is mocked locally so `PodContract.estimateFee` can be driven per-test.
 */
const h = vi.hoisted(() => ({
  balanceWithState: vi.fn(),
  balanceOfWithStatus: vi.fn(),
  name: vi.fn(),
  nonces: vi.fn(),
  symbol: vi.fn(),
  deposit: vi.fn(),
  requestWithdrawWithPermit: vi.fn(),
  estimateFee: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    address: string;
    runner: unknown;
    constructor(address: string, _abi: unknown, runner: unknown) {
      this.address = address;
      this.runner = runner;
    }
    getAddress = async () => this.address;
    balanceWithState = (...a: unknown[]) => h.balanceWithState(...a);
    balanceOfWithStatus = (...a: unknown[]) => h.balanceOfWithStatus(...a);
    name = (...a: unknown[]) => h.name(...a);
    nonces = (...a: unknown[]) => h.nonces(...a);
    symbol = (...a: unknown[]) => h.symbol(...a);
    deposit = (...a: unknown[]) => h.deposit(...a);
    requestWithdrawWithPermit = (...a: unknown[]) => h.requestWithdrawWithPermit(...a);
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: MockContract } };
});

vi.mock('@coti/pod-sdk', () => ({
  COTI_TESTNET_DEFAULT_INBOX_ADDRESS: '0x' + '0'.repeat(40),
  SEPOLIA_DEFAULT_INBOX_ADDRESS: '0x' + '0'.repeat(40),
  DataType: { String: 2, uint256: 0, uint64: 1, string: 2 },
  PodContract: class {
    constructor(..._args: unknown[]) {}
    estimateFee = (...a: unknown[]) => h.estimateFee(...a);
  },
}));

import { ethers } from 'ethers';
import {
  executePodPortalTransaction,
  signPodWithdrawPermit,
  getSepoliaGasPrice,
  quotePortalPodRequest,
  getPodSdkConfig,
  type PodWithdrawPermit,
} from '../../../src/chains/portal/executePodPortalTransaction';
import { PRIVACY_PORTAL_ABI, SEPOLIA_CHAIN_ID } from '../../../src/contracts/pod';
import { configureCotiPlugin } from '../../../src/config/plugin';
import { logger } from '../../../src/lib/logger';

vi.mock('../../../src/lib/logger', () => ({
  logger: {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const WALLET = '0x' + '1'.repeat(40);
const PORTAL = '0x' + 'a'.repeat(40);
const UNDERLYING = '0x' + 'b'.repeat(40);
const PTOKEN = '0x' + 'c'.repeat(40);

const portalIface = new ethers.Interface(PRIVACY_PORTAL_ABI);

const depositLog = (mintId?: string) => {
  const encoded = portalIface.encodeEventLog('DepositRequested', [
    WALLET,
    WALLET,
    1000n,
    mintId ?? ('0x' + '7'.repeat(64)),
  ]);
  return { address: PORTAL, topics: encoded.topics, data: encoded.data };
};

const withdrawLog = () => {
  const encoded = portalIface.encodeEventLog('WithdrawalRequested', [
    '0x' + '9'.repeat(64),
    WALLET,
    WALLET,
    1000n,
    '0x' + '8'.repeat(64),
  ]);
  return { address: PORTAL, topics: encoded.topics, data: encoded.data };
};

const makeSigner = () => ({
  getAddress: vi.fn(async () => WALLET),
  signTypedData: vi.fn(),
  provider: { send: vi.fn(async () => '0x' + (1_000_000_000).toString(16)) },
});

const makeProvider = () => ({ send: vi.fn(async () => '0x' + (1_000_000_000).toString(16)) });

const validPermit = (overrides: Partial<PodWithdrawPermit> = {}): PodWithdrawPermit => ({
  wallet: WALLET,
  pTokenAddress: PTOKEN,
  portalAddress: PORTAL,
  amountWei: ethers.parseUnits('1', 18).toString(),
  deadline: String(Math.floor(Date.now() / 1000) + 1800),
  v: 27,
  r: '0x' + '2'.repeat(64),
  s: '0x' + '3'.repeat(64),
  ...overrides,
});

const baseParams = () => ({
  txAmount: '1',
  signer: makeSigner() as never,
  provider: makeProvider() as never,
  portalAddress: PORTAL,
  underlyingAddress: UNDERLYING,
  pTokenAddress: PTOKEN,
  tokenSymbol: 'MTT',
  decimals: 18,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.balanceWithState.mockResolvedValue([0n, false, false]);
  h.balanceOfWithStatus.mockResolvedValue([0n, false]);
  h.estimateFee.mockResolvedValue({ remoteFee: 1000n, callBackFee: 500n });
  h.name.mockResolvedValue('MTT');
  h.symbol.mockResolvedValue('p.MTT');
  h.nonces.mockResolvedValue(0n);
});

describe('getPodSdkConfig', () => {
  it('uses plugin-config RPC overrides when present', () => {
    configureCotiPlugin({ sepoliaRpcUrl: 'https://sep.example', cotiTestnetRpcUrl: 'https://coti.example' });
    const cfg = getPodSdkConfig();
    const sepolia = cfg.chains.find(c => c.chainId === SEPOLIA_CHAIN_ID);
    const coti = cfg.chains.find(c => c.chainId === 7082400);
    expect(sepolia?.rpcUrl).toBe('https://sep.example');
    expect(coti?.rpcUrl).toBe('https://coti.example');
    configureCotiPlugin({ sepoliaRpcUrl: undefined, cotiTestnetRpcUrl: undefined });
  });

  it('reads inbox addresses from chain config', () => {
    const cfg = getPodSdkConfig();
    expect(cfg.chains.every(c => c.inboxAddress.startsWith('0x'))).toBe(true);
    expect(cfg.chains.find(c => c.chainId === SEPOLIA_CHAIN_ID)?.inboxAddress).toBe(
      '0xB4A53FE02401fDFA8DAc00450dA3FfF8D01502F8',
    );
    expect(cfg.chains.find(c => c.chainId === 7082400)?.inboxAddress).toBe(
      '0xB4A53FE02401fDFA8DAc00450dA3FfF8D01502F8',
    );
  });

  it('falls back to chain default RPC URLs when not configured', () => {
    const cfg = getPodSdkConfig();
    expect(cfg.chains[0].chainId).toBe(SEPOLIA_CHAIN_ID);
    expect(typeof cfg.chains[0].rpcUrl).toBe('string');
  });
});

describe('getSepoliaGasPrice', () => {
  it('reads eth_gasPrice and converts hex to bigint', async () => {
    const provider = makeProvider();
    const price = await getSepoliaGasPrice(provider as never);
    expect(price).toBe(1_000_000_000n);
    expect(provider.send).toHaveBeenCalledWith('eth_gasPrice', []);
  });
});

describe('quotePortalPodRequest', () => {
  it('buffers the remote fee and resolves the gas price from the runner provider', async () => {
    const signer = makeSigner();
    const quote = await quotePortalPodRequest(signer as never, PORTAL, 'deposit', [
      { value: WALLET },
      { value: '1000' },
      { value: '0', isCallBackFee: true },
    ]);
    // remoteFee 1000 * 20000 / 10000 = 2000; total = 2000 + 500
    expect(quote.remoteFeeWei).toBe(2000n);
    expect(quote.callbackFeeWei).toBe(500n);
    expect(quote.totalFeeWei).toBe(2500n);
    expect(quote.gasPrice).toBe(1_000_000_000n);
  });

  it('treats a runner without a .provider as the provider itself and honors an explicit gasPrice', async () => {
    const runner = makeProvider(); // has .send but no .provider
    const quote = await quotePortalPodRequest(runner as never, PORTAL, 'deposit', [{ value: WALLET }], 5n);
    expect(quote.gasPrice).toBe(5n);
    // explicit gasPrice means send() is not used for the price
    expect(runner.send).not.toHaveBeenCalled();
  });
});

describe('executePodPortalTransaction - configuration guard', () => {
  it('throws when portal/underlying/pToken address is missing', async () => {
    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private', portalAddress: '' }),
    ).rejects.toThrow('PoD portal is not configured for this token');
  });
});

describe('executePodPortalTransaction - deposit (to-private)', () => {
  it('submits a deposit and returns a source-mined request with the mint request id', async () => {
    const onProgress = vi.fn();
    h.deposit.mockResolvedValue({
      hash: '0xdeposit',
      wait: async () => ({ status: 1, blockNumber: 42, logs: [depositLog()] }),
    });

    const result = await executePodPortalTransaction({
      ...baseParams(),
      txDirection: 'to-private',
      onProgress,
    });

    expect(result.txHash).toBe('0xdeposit');
    expect(result.request.kind).toBe('deposit');
    expect(result.request.status).toBe('source-mined');
    expect(result.request.requestId).toBe('0x' + '7'.repeat(64));
    expect(result.request.message).toContain('mint request submitted');
    expect(onProgress).toHaveBeenCalledWith('transfer-start');
  });

  it('reports request id not found when the deposit log is absent', async () => {
    h.deposit.mockResolvedValue({
      hash: '0xdeposit',
      wait: async () => ({ status: 1, blockNumber: 42, logs: [] }),
    });
    const result = await executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' });
    expect(result.request.requestId).toBeUndefined();
    expect(result.request.message).toContain('request id not found');
  });

  it('throws when the deposit receipt has a non-success status', async () => {
    h.deposit.mockResolvedValue({ hash: '0xdeposit', wait: async () => ({ status: 0, logs: [] }) });
    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' }),
    ).rejects.toThrow('PoD deposit transaction failed');
  });

  it('throws when the deposit receipt is null', async () => {
    h.deposit.mockResolvedValue({ hash: '0xdeposit', wait: async () => null });
    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' }),
    ).rejects.toThrow('PoD deposit transaction failed');
  });
});

describe('executePodPortalTransaction - pToken readiness', () => {
  it('logs blocked-state diagnostics when debug logging is enabled', async () => {
    configureCotiPlugin({ debug: true });
    h.balanceWithState.mockResolvedValue([0n, true, false]);

    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' }),
    ).rejects.toThrow(/already pending/);

    expect(logger.warn).toHaveBeenCalledWith(
      '[PoD][pToken readiness] balanceWithState raw contract response: {"balance":"0","pending":true,"callbackErrored":false}',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[PoD][pToken readiness] blocked new request',
      expect.objectContaining({
        reason: 'pending',
        action: 'deposit',
        account: WALLET,
        pTokenAddress: PTOKEN,
        blockingRequest: null,
        balanceStatusRawResponse: { balance: '0', pending: true, callbackErrored: false },
        onChain: expect.objectContaining({
          pending: true,
          callbackErrored: false,
          source: 'balanceWithState',
        }),
      }),
    );
    configureCotiPlugin({ debug: false });
  });

  it('rethrows the pending error when a PoD request is already in flight', async () => {
    h.balanceWithState.mockResolvedValue([0n, true, false]);
    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' }),
    ).rejects.toThrow(/already pending/);
  });

  it('includes the blocking request id when local storage has an in-flight deposit', async () => {
    const requestId = '0x' + '9'.repeat(64);
    localStorage.setItem(
      `pod-portal-requests:v1:${WALLET.toLowerCase()}`,
      JSON.stringify([{
        id: 'tx-1',
        kind: 'deposit',
        chainId: SEPOLIA_CHAIN_ID,
        sourceTxHash: '0xsource',
        requestId,
        wallet: WALLET,
        token: 'MTT',
        amount: '1',
        status: 'pod-pending',
        createdAt: 1,
        updatedAt: 2,
      }]),
    );
    h.balanceWithState.mockResolvedValue([0n, true, false]);

    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' }),
    ).rejects.toThrow(requestId);
  });

  it('rethrows the untrusted error when a prior callback failed', async () => {
    h.balanceWithState.mockResolvedValue([0n, false, true]);
    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' }),
    ).rejects.toThrow(/untrusted/);
  });

  it('falls back to balanceOfWithStatus when balanceWithState reverts', async () => {
    h.balanceWithState.mockRejectedValue(new Error('no balanceWithState'));
    h.balanceOfWithStatus.mockResolvedValue([0n, false]);
    h.deposit.mockResolvedValue({
      hash: '0xdeposit',
      wait: async () => ({ status: 1, blockNumber: 1, logs: [depositLog()] }),
    });
    const result = await executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' });
    expect(result.txHash).toBe('0xdeposit');
    expect(h.balanceOfWithStatus).toHaveBeenCalled();
  });

  it('falls back to plain balanceOfWithStatus when encrypted status helpers fail', async () => {
    h.balanceWithState.mockRejectedValue(new Error('no balanceWithState'));
    h.balanceOfWithStatus
      .mockRejectedValueOnce(new Error('flat decode failed'))
      .mockRejectedValueOnce(new Error('could not decode result data'))
      .mockResolvedValueOnce([0n, false]);
    h.deposit.mockResolvedValue({
      hash: '0xdeposit',
      wait: async () => ({ status: 1, blockNumber: 1, logs: [depositLog()] }),
    });
    const result = await executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' });
    expect(result.txHash).toBe('0xdeposit');
    expect(h.balanceOfWithStatus).toHaveBeenCalledTimes(3);
  });

  it('reads pending from the flat ciphertext status tuple instead of the second limb', async () => {
    h.balanceWithState.mockRejectedValue(new Error('no balanceWithState'));
    h.balanceOfWithStatus.mockResolvedValue([
      {
        ciphertextHigh: 103090361038417376440519395658158555608413617740782153585815435058968053869084n,
        ciphertextLow: 69807266116490216295279494087392419007142977616136111241921797536560538206173n,
      },
      false,
    ]);
    h.deposit.mockResolvedValue({
      hash: '0xdeposit',
      wait: async () => ({ status: 1, blockNumber: 1, logs: [depositLog()] }),
    });

    const result = await executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' });
    expect(result.txHash).toBe('0xdeposit');
    expect(h.balanceOfWithStatus).toHaveBeenCalledTimes(1);
  });

  it('wraps an unrecognized state error into a generic verify message', async () => {
    h.balanceWithState.mockRejectedValue(new Error('rpc down'));
    h.balanceOfWithStatus.mockRejectedValue(new Error('rpc down'));
    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' }),
    ).rejects.toThrow('Could not verify the pToken request state');
  });

  it('handles a non-object rejection (no message) when verifying state', async () => {
    h.balanceWithState.mockRejectedValue('plain string failure');
    h.balanceOfWithStatus.mockRejectedValue('plain string failure');
    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' }),
    ).rejects.toThrow('Could not verify the pToken request state');
  });
});

describe('executePodPortalTransaction - event log parsing edge cases', () => {
  it('skips unparseable and non-matching logs when locating the deposit event', async () => {
    const releasedLog = portalIface.encodeEventLog('WithdrawalReleased', [
      '0x' + '9'.repeat(64),
      WALLET,
      1000n,
    ]);
    h.deposit.mockResolvedValue({
      hash: '0xdeposit',
      wait: async () => ({
        status: 1,
        blockNumber: 5,
        logs: [
          { address: PORTAL, topics: ['0x' + 'f'.repeat(64)], data: '0x' }, // unparseable -> catch
          { address: PORTAL, topics: releasedLog.topics, data: releasedLog.data }, // parses, wrong name
          depositLog(), // the match
        ],
      }),
    });
    const result = await executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' });
    expect(result.request.requestId).toBe('0x' + '7'.repeat(64));
  });
});

describe('executePodPortalTransaction - withdraw (to-public)', () => {
  it('submits a withdraw with a valid permit and returns a source-mined request', async () => {
    const onProgress = vi.fn();
    h.requestWithdrawWithPermit.mockResolvedValue({
      hash: '0xwithdraw',
      wait: async () => ({ status: 1, blockNumber: 7, logs: [withdrawLog()] }),
    });

    const result = await executePodPortalTransaction({
      ...baseParams(),
      txDirection: 'to-public',
      withdrawPermit: validPermit(),
      onProgress,
    });

    expect(result.txHash).toBe('0xwithdraw');
    expect(result.request.kind).toBe('withdraw');
    expect(result.request.withdrawalId).toBe('0x' + '9'.repeat(64));
    expect(result.request.requestId).toBe('0x' + '8'.repeat(64));
    expect(onProgress).toHaveBeenCalledWith('transfer-start');
  });

  it('throws when the withdraw permit is missing', async () => {
    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-public', withdrawPermit: undefined }),
    ).rejects.toThrow(/approval signature is missing or stale/);
  });

  it('throws when the withdraw permit amount is stale', async () => {
    await expect(
      executePodPortalTransaction({
        ...baseParams(),
        txDirection: 'to-public',
        withdrawPermit: validPermit({ amountWei: '999' }),
      }),
    ).rejects.toThrow(/missing or stale/);
  });

  it('throws when the withdraw receipt is unsuccessful', async () => {
    h.requestWithdrawWithPermit.mockResolvedValue({
      hash: '0xwithdraw',
      wait: async () => ({ status: 0, logs: [] }),
    });
    await expect(
      executePodPortalTransaction({
        ...baseParams(),
        txDirection: 'to-public',
        withdrawPermit: validPermit(),
      }),
    ).rejects.toThrow('Sepolia withdraw transaction failed');
  });
});

describe('signPodWithdrawPermit', () => {
  it('builds a permit by signing EIP-712 typed data and splitting the signature', async () => {
    const signer = makeSigner();
    const serialized = ethers.Signature.from({
      r: '0x' + '2'.repeat(64),
      s: '0x' + '3'.repeat(64),
      v: 27,
    }).serialized;
    signer.signTypedData.mockResolvedValue(serialized);

    const permit = await signPodWithdrawPermit({
      signer: signer as never,
      pTokenAddress: PTOKEN,
      portalAddress: PORTAL,
      amountWei: ethers.parseUnits('2', 18),
      deadline: 9999n,
    });

    expect(permit.wallet).toBe(WALLET);
    expect(permit.amountWei).toBe(ethers.parseUnits('2', 18).toString());
    expect(permit.deadline).toBe('9999');
    expect(permit.v).toBe(27);
    expect(signer.signTypedData).toHaveBeenCalled();
  });

  it('defaults the deadline when none is supplied', async () => {
    const signer = makeSigner();
    const serialized = ethers.Signature.from({
      r: '0x' + '2'.repeat(64),
      s: '0x' + '3'.repeat(64),
      v: 28,
    }).serialized;
    signer.signTypedData.mockResolvedValue(serialized);

    const permit = await signPodWithdrawPermit({
      signer: signer as never,
      pTokenAddress: PTOKEN,
      portalAddress: PORTAL,
      amountWei: 1n,
    });
    expect(Number(permit.deadline)).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
