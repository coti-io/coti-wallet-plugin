import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Full-flow tests for the Sepolia PoD portal executor.
 *
 * `ethers` is mocked via `importOriginal` so that pure helpers (Interface,
 * parseUnits, Signature, ZeroHash) stay real while `Contract` is swapped for a
 * controllable stub whose methods are backed by hoisted spies. `@coti-io/pod-sdk`
 * is mocked via vitest alias so `PodContract.estimateFee` can be driven per-test.
 */
const h = vi.hoisted(() => ({
  balanceWithState: vi.fn(),
  balanceOfWithStatus: vi.fn(),
  name: vi.fn(),
  nonces: vi.fn(),
  symbol: vi.fn(),
  deposit: vi.fn(),
  depositNative: vi.fn(),
  requestWithdrawWithPermit: vi.fn(),
  estimateDepositFees: vi.fn(),
  estimateWithdrawFees: vi.fn(),
  estimateGas: vi.fn(),
  sendPodPortalMethod: vi.fn(),
  waitForTransaction: vi.fn(),
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
    depositNative = (...a: unknown[]) => h.depositNative(...a);
    requestWithdrawWithPermit = (...a: unknown[]) => h.requestWithdrawWithPermit(...a);
    estimateDepositFees = (...a: unknown[]) => h.estimateDepositFees(...a);
    estimateWithdrawFees = (...a: unknown[]) => h.estimateWithdrawFees(...a);
    estimateGas = (...a: unknown[]) => h.estimateGas(...a);
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: MockContract } };
});

vi.mock('../../../src/chains/portal/podPortalFees', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/chains/portal/podPortalFees')>();
  return {
    ...actual,
    sendPodPortalMethod: (...a: unknown[]) => h.sendPodPortalMethod(...a),
  };
});

// Keep confirmation behavior provider-driven in these tests; avoid RPC fallback polling.
vi.mock('../../../src/lib/rpcProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/rpcProvider')>();
  return {
    ...actual,
    waitForTransactionResilient: async (
      _chainId: number,
      txHash: string,
      options: { primary?: { waitForTransaction?: (...a: unknown[]) => Promise<unknown> } } = {},
    ) => {
      if (!txHash) {
        throw new Error('waitForTransactionResilient: missing transaction hash');
      }
      const primary = options.primary;
      if (!primary?.waitForTransaction) {
        throw new Error('waitForTransactionResilient: missing primary provider');
      }
      return primary.waitForTransaction(txHash);
    },
  };
});

import { ethers } from 'ethers';
import {
  executePodPortalTransaction,
  signPodWithdrawPermit,
  getSepoliaGasPrice,
  quotePortalFeeOnly,
  getPodSdkConfig,
  type PodWithdrawPermit,
} from '../../../src/chains/portal/executePodPortalTransaction';
import { PRIVACY_PORTAL_ABI, SEPOLIA_CHAIN_ID } from '../../../src/contracts/pod';
import { POD_INBOX_ADDRESS } from '../../../src/chains/podInbox';
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
  provider: {
    send: vi.fn(async () => '0x' + (1_000_000_000).toString(16)),
    getNetwork: vi.fn(async () => ({ chainId: 11155111n })),
    waitForTransaction: (...a: unknown[]) => h.waitForTransaction(...a),
  },
});

const makeProvider = () => ({
  send: vi.fn(async () => '0x' + (1_000_000_000).toString(16)),
  waitForTransaction: (...a: unknown[]) => h.waitForTransaction(...a),
});

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
  h.estimateDepositFees.mockResolvedValue([100n, false, 2000n, 500n]);
  h.estimateWithdrawFees.mockResolvedValue([100n, false, 2000n, 500n]);
  h.estimateGas.mockResolvedValue(500_000n);
  h.sendPodPortalMethod.mockImplementation(async () => ({
    hash: '0xdeposit',
  }));
  h.waitForTransaction.mockResolvedValue({ status: 1, blockNumber: 42, logs: [depositLog()] });
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
      POD_INBOX_ADDRESS,
    );
    expect(cfg.chains.find(c => c.chainId === 7082400)?.inboxAddress).toBe(
      POD_INBOX_ADDRESS,
    );
    expect(cfg.chains.every(c => c.inboxAddress === POD_INBOX_ADDRESS)).toBe(true);
  });

  it('falls back to chain default RPC URLs when not configured', () => {
    const cfg = getPodSdkConfig();
    expect(cfg.chains[0].chainId).toBe(SEPOLIA_CHAIN_ID);
    expect(typeof cfg.chains[0].rpcUrl).toBe('string');
  });
});

describe('getSepoliaGasPrice', () => {
  it('reads eth_gasPrice and applies the 10% pod-sdk buffer', async () => {
    const provider = makeProvider();
    const price = await getSepoliaGasPrice(provider as never);
    expect(price).toBe(1_100_000_000n);
    expect(provider.send).toHaveBeenCalledWith('eth_gasPrice', []);
  });
});

describe('quotePortalFeeOnly', () => {
  it('returns portal fee from estimateDepositFees', async () => {
    const signer = makeSigner();
    const quote = await quotePortalFeeOnly(signer as never, PORTAL, 1000n, 'to-private');
    expect(quote.portalFee).toBe(100n);
    expect(quote.usedDynamicPricing).toBe(false);
    expect(quote.gasPrice).toBe(1_100_000_000n);
  });

  it('returns portal fee from estimateWithdrawFees', async () => {
    const signer = makeSigner();
    const quote = await quotePortalFeeOnly(signer as never, PORTAL, 1000n, 'to-public');
    expect(quote.portalFee).toBe(100n);
    expect(quote.usedDynamicPricing).toBe(false);
    expect(quote.gasPrice).toBe(1_100_000_000n);
  });

  it('treats a runner without a .provider as the provider itself and honors an explicit gasPrice', async () => {
    const runner = makeProvider();
    const quote = await quotePortalFeeOnly(runner as never, PORTAL, 1000n, 'to-private', 5n);
    expect(quote.gasPrice).toBe(5n);
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
    h.sendPodPortalMethod.mockResolvedValue({ hash: '0xdeposit' });
    h.waitForTransaction.mockResolvedValue({ status: 1, blockNumber: 42, logs: [depositLog()] });

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
    expect(onProgress).toHaveBeenCalledWith('transfer-start', expect.any(String));
    expect(h.sendPodPortalMethod).toHaveBeenCalled();
  });

  it('reports request id not found when the deposit log is absent', async () => {
    h.sendPodPortalMethod.mockResolvedValue({ hash: '0xdeposit' });
    h.waitForTransaction.mockResolvedValue({ status: 1, blockNumber: 42, logs: [] });
    const result = await executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' });
    expect(result.request.requestId).toBeUndefined();
    expect(result.request.message).toContain('request id not found');
  });

  it('throws when the deposit receipt has a non-success status', async () => {
    h.sendPodPortalMethod.mockResolvedValue({ hash: '0xdeposit' });
    h.waitForTransaction.mockResolvedValue({ status: 0, logs: [] });
    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' }),
    ).rejects.toThrow('PoD deposit transaction failed');
  });

  it('throws when the deposit receipt is null', async () => {
    h.sendPodPortalMethod.mockResolvedValue({ hash: '0xdeposit' });
    h.waitForTransaction.mockResolvedValue(null);
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

  it('treats TransferAlreadyPending revert data as pending without trying fallback ABIs', async () => {
    const wallet = WALLET;
    const requestId = '0x' + '3f'.padStart(64, '0');
    const revertData = ethers.Interface.from([
      'error TransferAlreadyPending(address from, address to, bytes32 requestId)',
    ]).encodeErrorResult('TransferAlreadyPending', [wallet, wallet, requestId]);
    const revertError = { code: 'CALL_EXCEPTION', data: revertData };

    h.balanceWithState.mockRejectedValue(revertError);
    h.balanceOfWithStatus.mockResolvedValue([0n, false]);

    await expect(
      executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' }),
    ).rejects.toThrow(requestId);

    expect(h.balanceOfWithStatus).not.toHaveBeenCalled();
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
    h.sendPodPortalMethod.mockResolvedValue({ hash: '0xdeposit' });
    h.waitForTransaction.mockResolvedValue({ status: 1, blockNumber: 1, logs: [depositLog()] });
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
    h.sendPodPortalMethod.mockResolvedValue({ hash: '0xdeposit' });
    h.waitForTransaction.mockResolvedValue({ status: 1, blockNumber: 1, logs: [depositLog()] });
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
    h.sendPodPortalMethod.mockResolvedValue({ hash: '0xdeposit' });
    h.waitForTransaction.mockResolvedValue({ status: 1, blockNumber: 1, logs: [depositLog()] });

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
    h.sendPodPortalMethod.mockResolvedValue({ hash: '0xdeposit' });
    h.waitForTransaction.mockResolvedValue({
      status: 1,
      blockNumber: 5,
      logs: [
        { address: PORTAL, topics: ['0x' + 'f'.repeat(64)], data: '0x' }, // unparseable -> catch
        { address: PORTAL, topics: releasedLog.topics, data: releasedLog.data }, // parses, wrong name
        depositLog(), // the match
      ],
    });
    const result = await executePodPortalTransaction({ ...baseParams(), txDirection: 'to-private' });
    expect(result.request.requestId).toBe('0x' + '7'.repeat(64));
  });
});

describe('executePodPortalTransaction - withdraw (to-public)', () => {
  it('submits a withdraw with a valid permit and returns a source-mined request', async () => {
    const onProgress = vi.fn();
    h.sendPodPortalMethod.mockResolvedValue({ hash: '0xwithdraw' });
    h.waitForTransaction.mockResolvedValue({ status: 1, blockNumber: 7, logs: [withdrawLog()] });

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
    expect(onProgress).toHaveBeenCalledWith('transfer-start', expect.any(String));
    expect(h.sendPodPortalMethod).toHaveBeenCalled();
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
    h.sendPodPortalMethod.mockResolvedValue({ hash: '0xwithdraw' });
    h.waitForTransaction.mockResolvedValue({ status: 0, logs: [] });
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
