import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Full behavioural coverage for usePrivacyBridge. `ethers` keeps its real pure
 * helpers (parseUnits, formatUnits, parseEther, formatEther, MaxUint256, id,
 * Interface, getBytes, solidityPacked) but swaps BrowserProvider / JsonRpcProvider
 * / Contract for controllable stubs. All sibling modules are mocked so the hook's
 * own branching is isolated.
 */
const eth = vi.hoisted(() => ({
  getNetwork: vi.fn(),
  getSigner: vi.fn(),
  waitForTransaction: vi.fn(),
  call: vi.fn(),
  send: vi.fn(),
  allowance: vi.fn(),
  balanceOf: vi.fn(),
  approve: vi.fn(),
  depositUint2: vi.fn(),
  estimateGas: vi.fn(),
  encodeFunctionData: vi.fn(() => '0xdeadbeef'),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockBrowserProvider {
    constructor(_p: unknown) {}
    getNetwork = (...a: unknown[]) => eth.getNetwork(...a);
    getSigner = (...a: unknown[]) => eth.getSigner(...a);
    waitForTransaction = (...a: unknown[]) => eth.waitForTransaction(...a);
    call = (...a: unknown[]) => eth.call(...a);
    send = (...a: unknown[]) => eth.send(...a);
  }
  class MockJsonRpcProvider {
    constructor(..._a: unknown[]) {}
    getNetwork = (...a: unknown[]) => eth.getNetwork(...a);
  }
  class MockContract {
    target: string;
    interface: { encodeFunctionData: (...a: unknown[]) => string };
    allowance = (...a: unknown[]) => eth.allowance(...a);
    balanceOf = (...a: unknown[]) => eth.balanceOf(...a);
    approve = (...a: unknown[]) => eth.approve(...a);
    constructor(address: string, _abi: unknown, _runner: unknown) {
      this.target = address;
      this.interface = { encodeFunctionData: (...a: unknown[]) => eth.encodeFunctionData(...a) };
      const depositFn = (...a: unknown[]) => eth.depositUint2(...a);
      (depositFn as unknown as { estimateGas: unknown }).estimateGas = (...a: unknown[]) =>
        eth.estimateGas(...a);
      (this as Record<string, unknown>)['deposit(uint256,uint256)'] = depositFn;
    }
  }
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      BrowserProvider: MockBrowserProvider,
      JsonRpcProvider: MockJsonRpcProvider,
      Contract: MockContract,
    },
  };
});

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ connector: undefined, address: undefined, isConnected: false })),
  useConnectorClient: vi.fn(() => ({ data: undefined })),
  useSwitchChain: vi.fn(() => ({ switchChain: vi.fn() })),
}));

const sib = vi.hoisted(() => ({
  estimatePodPortalGasFeeDisplay: vi.fn(),
  estimateCotiBridgeGasFeeDisplay: vi.fn(),
  executePodPortalTransaction: vi.fn(),
  signPodWithdrawPermit: vi.fn(),
  estimateBridgeFee: vi.fn(),
  getChainConfig: vi.fn(),
  getPublicTokensForChain: vi.fn(),
  getPrivateTokensForChain: vi.fn(),
  getRpcUrlForChain: vi.fn(() => 'https://rpc.test'),
}));

vi.mock('../../src/chains/portal/podGasEstimate', () => ({
  estimatePodPortalGasFeeDisplay: (...a: unknown[]) => sib.estimatePodPortalGasFeeDisplay(...a),
}));
vi.mock('../../src/chains/cotiBridgeGasEstimate', () => ({
  estimateCotiBridgeGasFeeDisplay: (...a: unknown[]) => sib.estimateCotiBridgeGasFeeDisplay(...a),
}));
vi.mock('../../src/chains/portal/executePodPortalTransaction', () => ({
  executePodPortalTransaction: (...a: unknown[]) => sib.executePodPortalTransaction(...a),
  signPodWithdrawPermit: (...a: unknown[]) => sib.signPodWithdrawPermit(...a),
}));
vi.mock('../../src/hooks/useEstimateBridgeFees', () => ({
  estimateBridgeFee: (...a: unknown[]) => sib.estimateBridgeFee(...a),
}));
vi.mock('../../src/chains', () => ({
  getChainConfig: (...a: unknown[]) => sib.getChainConfig(...a),
  getPublicTokensForChain: (...a: unknown[]) => sib.getPublicTokensForChain(...a),
  getPrivateTokensForChain: (...a: unknown[]) => sib.getPrivateTokensForChain(...a),
  getRpcUrlForChain: (...a: unknown[]) => sib.getRpcUrlForChain(...a),
}));

const addrs = vi.hoisted(() => {
  const COTI_ADDR: Record<string, string> = {
    PrivacyBridgeCotiNative: '0x' + 'a1'.repeat(20),
    PrivateCoti: '0x' + 'a2'.repeat(20),
    WETH: '0x' + 'b1'.repeat(20),
    PrivacyBridgeWETH: '0x' + 'b2'.repeat(20),
    'p.WETH': '0x' + 'b3'.repeat(20),
    WBTC: '0x' + 'c1'.repeat(20),
    PrivacyBridgeWBTC: '0x' + 'c2'.repeat(20),
    'p.WBTC': '0x' + 'c3'.repeat(20),
    USDT: '0x' + 'd1'.repeat(20),
    PrivacyBridgeUSDT: '0x' + 'd2'.repeat(20),
    'p.USDT': '0x' + 'd3'.repeat(20),
    USDC_E: '0x' + 'e1'.repeat(20),
    PrivacyBridgeUSDCe: '0x' + 'e2'.repeat(20),
    'p.USDC_E': '0x' + 'e3'.repeat(20),
    WADA: '0x' + 'f1'.repeat(20),
    PrivacyBridgeWADA: '0x' + 'f2'.repeat(20),
    'p.WADA': '0x' + 'f3'.repeat(20),
    gCOTI: '0x' + '11'.repeat(20),
    PrivacyBridgegCOTI: '0x' + '12'.repeat(20),
    'p.gCOTI': '0x' + '13'.repeat(20),
  };
  const SEPOLIA_ADDR: Record<string, string> = {
    MTT: '0x' + '21'.repeat(20),
    PrivacyPortalMTT: '0x' + '22'.repeat(20),
    'p.MTT': '0x' + '23'.repeat(20),
  };
  return { COTI_ADDR, SEPOLIA_ADDR };
});

vi.mock('../../src/contracts/config', () => ({
  CONTRACT_ADDRESSES: { 7082400: addrs.COTI_ADDR, 11155111: addrs.SEPOLIA_ADDR } as Record<
    number,
    Record<string, string>
  >,
  ERC20_ABI: [],
  BRIDGE_ABI: [],
  BRIDGE_ERC20_ABI: [],
  TOKEN_ABI: [],
}));

import { usePrivacyBridge, type Token } from '../../src/hooks/usePrivacyBridge';
import { decryptCtUint256 } from '@coti-io/coti-sdk-typescript';
import { logger } from '../../src/lib/logger';

const WALLET = '0x' + '9'.repeat(40);

const req = () => (window.ethereum as unknown as { request: ReturnType<typeof vi.fn> }).request;

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    isConnected: true,
    walletAddress: WALLET,
    publicTokens: [{ symbol: 'WETH', name: 'WETH', balance: '10', isPrivate: false }] as Token[],
    setPublicTokens: vi.fn((u: unknown) => {
      if (typeof u === 'function') {
        (u as (p: Token[]) => Token[])([
          { symbol: 'WETH', name: 'WETH', balance: '10', isPrivate: false },
          { symbol: 'COTI', name: 'COTI', balance: '5', isPrivate: false },
          { symbol: 'ZZZ', name: 'ZZZ', balance: '1', isPrivate: false },
        ]);
      }
    }),
    setPrivateTokens: vi.fn((u: unknown) => {
      if (typeof u === 'function') {
        (u as (p: Token[]) => Token[])([
          { symbol: 'p.WETH', name: 'p.WETH', balance: '2', isPrivate: true },
          { symbol: 'p.COTI', name: 'p.COTI', balance: '3', isPrivate: true },
          { symbol: 'p.ZZZ', name: 'p.ZZZ', balance: '1', isPrivate: true },
        ]);
      }
    }),
    setToastState: vi.fn((u: unknown) => {
      if (typeof u === 'function') {
        (u as (p: unknown) => unknown)({ visible: true, title: 't', message: 'm' });
      }
    }),
    amount: '1',
    setAmount: vi.fn(),
    direction: 'to-private' as 'to-private' | 'to-public',
    setDirection: vi.fn(),
    selectedTokenIndex: 0,
    setSelectedTokenIndex: vi.fn(),
    error: null as { title: string; message: string } | null,
    hasSnap: true,
    setHasSnap: vi.fn(),
    getAESKeyFromSnap: vi.fn(async () => 'a'.repeat(32)),
    handleOnboard: vi.fn(async () => 'a'.repeat(32)),
    refreshPrivateBalances: vi.fn(async () => true),
    upsertPodRequest: vi.fn(),
    ...overrides,
  };
}

const signer = {
  getAddress: vi.fn(async () => WALLET),
  signMessage: vi.fn(async () => '0x' + '5'.repeat(130)),
};

beforeEach(() => {
  vi.clearAllMocks();
  eth.getNetwork.mockResolvedValue({ chainId: 7082400n });
  eth.getSigner.mockResolvedValue(signer);
  eth.waitForTransaction.mockResolvedValue({ status: 1 });
  eth.send.mockResolvedValue('0x' + (1_000_000_000).toString(16));
  eth.allowance.mockResolvedValue(0n);
  eth.balanceOf.mockResolvedValue(10n ** 24n);
  eth.estimateGas.mockResolvedValue(500000n);
  sib.estimateBridgeFee.mockResolvedValue({
    depositFee: '0.01',
    withdrawFee: '0.02',
    cotiLastUpdated: '111',
    tokenLastUpdated: '222',
    blockTimestamp: '333',
  });
  sib.getChainConfig.mockReturnValue({ portalStrategy: 'coti-bridge' });
  sib.getPublicTokensForChain.mockReturnValue([]);
  sib.getPrivateTokensForChain.mockReturnValue([]);
  sib.estimateCotiBridgeGasFeeDisplay.mockResolvedValue('0.0005');
  sib.estimatePodPortalGasFeeDisplay.mockResolvedValue('0.0009');
  req().mockReset();
  req().mockResolvedValue('0x' + (300000).toString(16));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePrivacyBridge - checkAllowance', () => {
  it('returns early when not connected', async () => {
    const props = makeProps({ isConnected: false });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    expect(eth.getNetwork).not.toHaveBeenCalled();
  });

  it('grants unlimited allowance for native COTI deposit', async () => {
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '0', isPrivate: false }],
      direction: 'to-private',
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('999999999999999999'));
  });

  it('grants unlimited allowance for MTT withdraw', async () => {
    const props = makeProps({
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '0', isPrivate: false }],
      direction: 'to-public',
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('999999999999999999'));
  });

  it('reads a public ERC20 allowance via config-driven resolution', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'WETH', isPrivate: false, addressKey: 'WETH', bridgeAddressKey: 'PrivacyBridgeWETH', decimals: 18 },
    ]);
    eth.allowance.mockResolvedValue(5n * 10n ** 18n);
    const props = makeProps({ direction: 'to-private' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('5.0'));
  });

  it('resolves WETH via the symbol fallback when no config entry exists', async () => {
    eth.allowance.mockResolvedValue(2n * 10n ** 18n);
    const props = makeProps({ direction: 'to-private' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('2.0'));
  });

  it('decrypts a private allowance for a to-public direction when a snap key is present', async () => {
    sib.getPrivateTokensForChain.mockReturnValue([]);
    eth.allowance.mockResolvedValue({
      ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n },
    });
    vi.mocked(decryptCtUint256).mockReturnValue(3n * 10n ** 18n);
    const props = makeProps({
      direction: 'to-public',
      hasSnap: true,
      publicTokens: [{ symbol: 'WETH', name: 'WETH', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('3.0'));
  });

  it('caps an insane decrypted private allowance to 0', async () => {
    eth.allowance.mockResolvedValue({ ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n } });
    vi.mocked(decryptCtUint256).mockReturnValue(10n ** 40n);
    const props = makeProps({ direction: 'to-public' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('0'));
  });

  it('returns 0 for an uninitialized private allowance ciphertext', async () => {
    eth.allowance.mockResolvedValue({ ownerCiphertext: { ciphertextHigh: 0n, ciphertextLow: 0n } });
    const props = makeProps({ direction: 'to-public' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('0'));
  });

  it('falls back to 0 when the private allowance read throws', async () => {
    eth.allowance.mockRejectedValue(new Error('rpc fail'));
    const props = makeProps({ direction: 'to-public' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('0'));
  });

  it('returns 0 for a public deposit when the ERC20 address is unresolved (lines 409-410)', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'NOADDR', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeWETH', decimals: 18 },
    ]);
    const props = makeProps({
      direction: 'to-private',
      publicTokens: [{ symbol: 'NOADDR', name: 'No Address', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('0'));
    expect(eth.allowance).not.toHaveBeenCalled();
  });
});

describe('usePrivacyBridge - isApprovalNeeded', () => {
  it('is false for native COTI deposit', () => {
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '0', isPrivate: false }],
      direction: 'to-private',
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    expect(result.current.isApprovalNeeded).toBe(false);
  });

  it('is true for MTT withdraw without a permit', () => {
    const props = makeProps({
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '0', isPrivate: false }],
      direction: 'to-public',
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    expect(result.current.isApprovalNeeded).toBe(true);
  });

  it('compares amount against allowance for ERC20 tokens', () => {
    const props = makeProps({ direction: 'to-private', amount: '100' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    expect(result.current.isApprovalNeeded).toBe(true);
  });

  it('handles a parse error in the MTT permit comparison', () => {
    const props = makeProps({
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '0', isPrivate: false }],
      direction: 'to-public',
      amount: 'not-a-number',
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    expect(result.current.isApprovalNeeded).toBe(true);
  });
});

function routeRequest({
  estimateGas = '0x' + (300000).toString(16),
  sendTx = '0x' + 'a'.repeat(64),
  gasPrice = '0x' + (1_000_000_000).toString(16),
}: { estimateGas?: string; sendTx?: string; gasPrice?: string } = {}) {
  req().mockImplementation(async (arg: { method: string }) => {
    if (arg.method === 'eth_estimateGas') return estimateGas;
    if (arg.method === 'eth_sendTransaction') return sendTx;
    if (arg.method === 'eth_gasPrice') return gasPrice;
    return '0x0';
  });
}

const ercPublicCfg = (symbol: string, decimals = 18) => [
  {
    symbol,
    isPrivate: false,
    addressKey: symbol === 'USDC.e' ? 'USDC_E' : symbol,
    bridgeAddressKey: 'PrivacyBridge' + (symbol === 'USDC.e' ? 'USDCe' : symbol),
    decimals,
  },
];
const ercPrivateCfg = (symbol: string, decimals = 18) => [
  { symbol: 'p.' + symbol, isPrivate: true, addressKey: 'p.' + symbol, decimals },
];

describe('usePrivacyBridge - executeTransaction (COTI bridge)', () => {
  it('executes an ERC20 deposit and updates balances on success', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    eth.balanceOf.mockResolvedValue(10n ** 24n);
    eth.allowance.mockResolvedValue(10n ** 24n);
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const onProgress = vi.fn();
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));

    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0, onProgress);
    });

    expect(onProgress).toHaveBeenCalledWith('transfer-start');
    expect(onProgress).toHaveBeenCalledWith('transfer-complete', expect.any(String));
    expect(props.setPublicTokens).toHaveBeenCalled();
    expect(props.setPrivateTokens).toHaveBeenCalled();
    expect(props.refreshPrivateBalances).toHaveBeenCalled();
  });

  it('logs when immediate refreshPrivateBalances fails after successful deposit (EXE-02)', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    eth.balanceOf.mockResolvedValue(10n ** 24n);
    eth.allowance.mockResolvedValue(10n ** 24n);
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const refreshError = new Error('refresh failed');
    const refreshPrivateBalances = vi.fn().mockRejectedValue(refreshError);
    const loggerError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const props = makeProps({ refreshPrivateBalances });
    const { result } = renderHook(() => usePrivacyBridge(props));

    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0);
    });

    await waitFor(() => {
      expect(refreshPrivateBalances).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(loggerError).toHaveBeenCalledWith('Immediate balance refresh failed', refreshError);
    });
    loggerError.mockRestore();
  });

  it('throws on insufficient ERC20 balance', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    eth.balanceOf.mockResolvedValue(0n);
    eth.allowance.mockResolvedValue(10n ** 24n);
    routeRequest();
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow(/Insufficient WETH balance/);
  });

  it('throws on insufficient ERC20 allowance', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    eth.balanceOf.mockResolvedValue(10n ** 24n);
    eth.allowance.mockResolvedValue(0n);
    routeRequest();
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow(/Insufficient Allowance/);
  });

  it('falls back to default gas when ERC20 deposit estimateGas request fails', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    eth.balanceOf.mockResolvedValue(10n ** 24n);
    eth.allowance.mockResolvedValue(10n ** 24n);
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    req().mockImplementation(async (arg: { method: string }) => {
      if (arg.method === 'eth_estimateGas') throw new Error('estimate failed');
      if (arg.method === 'eth_sendTransaction') return '0x' + 'a'.repeat(64);
      return '0x0';
    });
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0);
    });
    expect(props.setPublicTokens).toHaveBeenCalled();
  });

  it('executes a native COTI deposit using calculateGasMargin', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({ wait: async () => ({ status: 1 }) });
    eth.estimateGas.mockResolvedValue(800000n);
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0);
    });
    expect(eth.depositUint2).toHaveBeenCalled();
    expect(props.setPublicTokens).toHaveBeenCalled();
  });

  it('handles a native COTI deposit gas estimation failure gracefully', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({ wait: async () => ({ status: 1 }) });
    eth.estimateGas.mockRejectedValue(Object.assign(new Error('gas fail'), { reason: 'r', data: '0xd' }));
    sib.estimateBridgeFee.mockRejectedValue(new Error('fee fail'));
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0);
    });
    expect(eth.depositUint2).toHaveBeenCalled();
  });

  it('executes an ERC20 withdraw (to-public)', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({ direction: 'to-public' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-public', 0);
    });
    expect(props.setPrivateTokens).toHaveBeenCalled();
  });

  it('executes a native COTI withdraw and survives a withdraw gas estimate failure', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    req().mockImplementation(async (arg: { method: string }) => {
      if (arg.method === 'eth_estimateGas') throw Object.assign(new Error('boom'), { message: 'boom' });
      if (arg.method === 'eth_sendTransaction') return '0x' + 'a'.repeat(64);
      return '0x0';
    });
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-public', 0);
    });
    expect(props.setPublicTokens).toHaveBeenCalled();
  });

  it('throws "No wallet found" when window.ethereum is absent', async () => {
    const original = (window as { ethereum?: unknown }).ethereum;
    delete (window as { ethereum?: unknown }).ethereum;
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow('No wallet found');
    (window as { ethereum?: unknown }).ethereum = original;
  });

  it('throws "Unsupported network" for an unknown chain', async () => {
    eth.getNetwork.mockResolvedValue({ chainId: 999n });
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow('Unsupported network');
  });
});

describe('usePrivacyBridge - executeTransaction (PoD portal)', () => {
  beforeEach(() => {
    eth.getNetwork.mockResolvedValue({ chainId: 11155111n });
    sib.getChainConfig.mockReturnValue({ portalStrategy: 'pod-privacy-portal' });
  });

  it('submits a PoD deposit and records the request', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18 },
    ]);
    sib.getPrivateTokensForChain.mockReturnValue([
      { symbol: 'p.MTT', isPrivate: true, addressKey: 'p.MTT', decimals: 18 },
    ]);
    sib.executePodPortalTransaction.mockResolvedValue({
      txHash: '0xpod',
      request: { id: '0xpod', kind: 'deposit' },
    });
    const onProgress = vi.fn();
    const props = makeProps({
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '5', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0, onProgress);
    });
    expect(sib.executePodPortalTransaction).toHaveBeenCalled();
    expect(props.upsertPodRequest).toHaveBeenCalledWith({ id: '0xpod', kind: 'deposit' });
    expect(onProgress).toHaveBeenCalledWith('transfer-complete', '0xpod');
  });

  it('submits a PoD withdraw and clears the permit', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18 },
    ]);
    sib.getPrivateTokensForChain.mockReturnValue([
      { symbol: 'p.MTT', isPrivate: true, addressKey: 'p.MTT', decimals: 18 },
    ]);
    sib.executePodPortalTransaction.mockResolvedValue({
      txHash: '0xpodw',
      request: { id: '0xpodw', kind: 'withdraw' },
    });
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '5', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-public', 0);
    });
    expect(props.upsertPodRequest).toHaveBeenCalled();
  });

  it('does not route legacy bridge tokens through the PoD portal executor', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'WETH', isPrivate: false, addressKey: 'WETH', bridgeAddressKey: 'PrivacyBridgeWETH', decimals: 18 },
    ]);
    const props = makeProps({
      publicTokens: [{ symbol: 'WETH', name: 'WETH', balance: '5', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow(/Bridge address not found|not configured/);
  });

  it('rejects when the PoD portal is not fully configured', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18 },
    ]);
    sib.getPrivateTokensForChain.mockReturnValue([
      { symbol: 'p.MTT', isPrivate: true, addressKey: undefined, decimals: 18 },
    ]);
    const props = makeProps({
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '5', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow(/not configured/);
  });
});

describe('usePrivacyBridge - executeTransaction error decoding', () => {
  it('maps a CALL_EXCEPTION with a known errorName to a friendly message', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      wait: async () => {
        throw { code: 'CALL_EXCEPTION', errorName: 'DepositBelowMinimum', receipt: { gasUsed: 1n } };
      },
    });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow('Deposit amount is below the minimum allowed.');
  });

  it('maps a CALL_EXCEPTION revert selector to a friendly message', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      wait: async () => {
        throw { code: 'CALL_EXCEPTION', data: '0xcbca5aa2' + '0'.repeat(8) };
      },
    });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow('Amount cannot be zero.');
  });

  it('falls back to the raw reason for an unrecognized CALL_EXCEPTION', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      wait: async () => {
        throw { code: 'CALL_EXCEPTION', reason: 'custom revert' };
      },
    });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow('custom revert');
  });

  it('rewrites a user-rejected error message', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      wait: async () => {
        throw new Error('user rejected the request');
      },
    });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow('user rejected');
    const lastToast = props.setToastState.mock.calls.at(-1)?.[0];
    expect(lastToast).toMatchObject({ title: 'Transaction Failed', message: 'Transaction rejected by user.' });
  });

  it('decodes an on-chain revert via receipt status replay', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      hash: '0xrevert',
      wait: async () => ({ status: 0, gasUsed: 5n, to: '0xto', from: WALLET, blockNumber: 1 }),
    });
    eth.call.mockRejectedValue({ errorName: 'BridgePaused' });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow(/Transaction failed on-chain.*Bridge is currently paused/);
  });
});

describe('usePrivacyBridge - handleApprove', () => {
  it('returns early when not connected', async () => {
    const props = makeProps({ isConnected: false });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(props.setToastState).not.toHaveBeenCalled();
  });

  it('skips approval for native COTI deposit', async () => {
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '0', isPrivate: false }],
      direction: 'to-private',
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(props.setToastState).not.toHaveBeenCalled();
  });

  it('approves a public ERC20 token (standard path)', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    eth.approve.mockResolvedValue({ wait: async () => ({}) });
    eth.allowance.mockResolvedValue(10n ** 18n);
    const props = makeProps({ direction: 'to-private' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(eth.approve).toHaveBeenCalled();
  });

  it('approves a public ERC20 token with MaxUint256 when no amount is set', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    eth.approve.mockResolvedValue({ wait: async () => ({}) });
    const props = makeProps({ direction: 'to-private', amount: '' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(eth.approve).toHaveBeenCalled();
  });

  it('rethrows when a public approval fails', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    eth.approve.mockRejectedValue(new Error('approve reverted'));
    const props = makeProps({ direction: 'to-private' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.handleApprove();
      }),
    ).rejects.toThrow('approve reverted');
  });

  it('signs an encrypted private approval (to-public, 128-bit path)', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({ direction: 'to-public', amount: '1' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(signer.signMessage).toHaveBeenCalled();
  });

  it('encrypts a zero-amount private approval (bitSize 0 path)', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({ direction: 'to-public', amount: '0' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(signer.signMessage).toHaveBeenCalled();
  });

  it('encrypts a MaxUint256 private approval (>128-bit path)', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({ direction: 'to-public', amount: '' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(signer.signMessage).toHaveBeenCalled();
  });

  it('throws when the AES key is unavailable for a private approval', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    const props = makeProps({ direction: 'to-public', getAESKeyFromSnap: vi.fn(async () => null) });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.handleApprove();
      }),
    ).rejects.toThrow(/AES key required/);
  });

  it('signs a PoD withdraw permit for MTT (to-public)', async () => {
    eth.getNetwork.mockResolvedValue({ chainId: 11155111n });
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18 },
    ]);
    sib.getPrivateTokensForChain.mockReturnValue([
      { symbol: 'p.MTT', isPrivate: true, addressKey: 'p.MTT', decimals: 18 },
    ]);
    sib.signPodWithdrawPermit.mockResolvedValue({ wallet: WALLET, amountWei: '1' });
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '5', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(sib.signPodWithdrawPermit).toHaveBeenCalled();
  });
});

describe('usePrivacyBridge - handleSwap', () => {
  it('does nothing when the amount is empty', async () => {
    const props = makeProps({ amount: '' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleSwap();
    });
    expect(props.setPublicTokens).not.toHaveBeenCalled();
  });

  it('does nothing when an error is present or amount is non-positive', async () => {
    const props = makeProps({ amount: '0' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleSwap();
    });
    expect(props.setPublicTokens).not.toHaveBeenCalled();
  });

  it('applies overrides and executes the transaction', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    eth.balanceOf.mockResolvedValue(10n ** 24n);
    eth.allowance.mockResolvedValue(10n ** 24n);
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({ hasSnap: true });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleSwap('2', 'to-private', 0);
    });
    expect(props.setAmount).toHaveBeenCalledWith('2');
    expect(props.setDirection).toHaveBeenCalledWith('to-private');
    expect(props.setSelectedTokenIndex).toHaveBeenCalledWith(0);
  });

  it('connects the snap when required and a key is retrievable', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({
      direction: 'to-public',
      hasSnap: false,
      getAESKeyFromSnap: vi.fn(async () => 'a'.repeat(32)),
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleSwap();
    });
    expect(props.setHasSnap).toHaveBeenCalledWith(true);
  });

  it('throws when the snap connection is rejected', async () => {
    const props = makeProps({
      direction: 'to-public',
      hasSnap: false,
      getAESKeyFromSnap: vi.fn(async () => null),
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.handleSwap();
      }),
    ).rejects.toThrow(/Snap connection failed/);
  });

  it('triggers onboarding when the AES key is missing, then proceeds', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const getAESKeyFromSnap = vi
      .fn()
      .mockRejectedValueOnce(new Error('AES key not found'))
      .mockResolvedValueOnce('a'.repeat(32));
    const props = makeProps({
      direction: 'to-public',
      hasSnap: false,
      getAESKeyFromSnap,
      handleOnboard: vi.fn(async () => 'a'.repeat(32)),
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleSwap();
    });
    expect(props.handleOnboard).toHaveBeenCalled();
    expect(props.setHasSnap).toHaveBeenCalledWith(true);
  });

  it('rethrows when onboarding fails to yield a key', async () => {
    const getAESKeyFromSnap = vi
      .fn()
      .mockRejectedValueOnce(new Error('onboarding required'))
      .mockResolvedValueOnce(null);
    const props = makeProps({
      direction: 'to-public',
      hasSnap: false,
      getAESKeyFromSnap,
      handleOnboard: vi.fn(async () => null),
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.handleSwap();
      }),
    ).rejects.toThrow(/Onboarding incomplete/);
  });

  it('rethrows an unrelated snap error', async () => {
    const props = makeProps({
      direction: 'to-public',
      hasSnap: false,
      getAESKeyFromSnap: vi.fn(async () => {
        throw new Error('some other snap failure');
      }),
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.handleSwap();
      }),
    ).rejects.toThrow('some other snap failure');
  });

  it('falls back to 12M gas when native COTI calculateGasMargin fails in handleSwap', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({ wait: async () => ({ status: 1 }) });
    eth.estimateGas.mockRejectedValue(new Error('gas margin fail'));
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleSwap('1', 'to-private', 0);
    });
    expect(eth.depositUint2).toHaveBeenCalled();
    const gasArg = eth.depositUint2.mock.calls[0]?.[2] as { gasLimit?: bigint } | undefined;
    expect(gasArg?.gasLimit).toBeGreaterThanOrEqual(900000n);
  });
});

describe('usePrivacyBridge - updateGasFee', () => {
  it('clears the fee when not connected', async () => {
    const props = makeProps({ isConnected: false });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.updateGasFee();
    });
    expect(result.current.estimatedGasFee).toBeNull();
  });

  it('returns without a fee on an unsupported chain', async () => {
    eth.getNetwork.mockResolvedValue({ chainId: 999n });
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.updateGasFee();
    });
    expect(result.current.estimatedGasFee).toBeNull();
  });

  it('uses the COTI bridge estimator (config-driven bridge address)', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.estimateCotiBridgeGasFeeDisplay.mockResolvedValue('0.0042');
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.updateGasFee();
    });
    await waitFor(() => expect(result.current.estimatedGasFee).toBe('0.0042'));
  });

  it('uses the COTI bridge estimator with the symbol fallback for WBTC', async () => {
    sib.estimateCotiBridgeGasFeeDisplay.mockResolvedValue('0.001');
    const props = makeProps({
      publicTokens: [{ symbol: 'WBTC', name: 'WBTC', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.updateGasFee();
    });
    await waitFor(() => expect(result.current.estimatedGasFee).toBe('0.001'));
  });

  it('uses the PoD portal estimator on a PoD chain', async () => {
    eth.getNetwork.mockResolvedValue({ chainId: 11155111n });
    sib.getChainConfig.mockReturnValue({ portalStrategy: 'pod-privacy-portal' });
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18 },
    ]);
    sib.estimatePodPortalGasFeeDisplay.mockResolvedValue('0.0009');
    const props = makeProps({
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.updateGasFee();
    });
    await waitFor(() => expect(result.current.estimatedGasFee).toBe('0.0009'));
  });

  it('defaults the gas price when eth_gasPrice fails and survives estimator errors', async () => {
    eth.send.mockRejectedValue(new Error('no gas price'));
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.estimateCotiBridgeGasFeeDisplay.mockRejectedValue(new Error('estimator boom'));
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.updateGasFee();
    });
    await waitFor(() => expect(result.current.estimatedGasFee).toBeNull());
  });
});

describe('usePrivacyBridge - fetchPortalFee (debounced effect)', () => {
  it('computes a portal fee for a positive amount', async () => {
    sib.estimateBridgeFee.mockResolvedValue({
      depositFee: '0.05',
      withdrawFee: '0.06',
      cotiLastUpdated: '1',
      tokenLastUpdated: '2',
      blockTimestamp: '3',
    });
    const props = makeProps({ amount: '1', direction: 'to-private' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await waitFor(() => expect(result.current.portalFeeCoti).toBe('0.05'), { timeout: 2000 });
    expect(result.current.feeDebugInfo).toMatchObject({ cotiLastUpdated: '1' });
  });

  it('clears the portal fee for a zero amount', async () => {
    const props = makeProps({ amount: '0' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await new Promise(r => setTimeout(r, 500));
    expect(result.current.portalFeeCoti).toBeNull();
  });

  it('clears the portal fee when the estimate returns Error', async () => {
    sib.estimateBridgeFee.mockResolvedValue({
      depositFee: 'Error',
      withdrawFee: 'Error',
      cotiLastUpdated: '1',
      tokenLastUpdated: '2',
      blockTimestamp: '3',
    });
    const props = makeProps({ amount: '1' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await new Promise(r => setTimeout(r, 600));
    expect(result.current.portalFeeCoti).toBeNull();
  });

  it('clears the portal fee when the estimate throws', async () => {
    sib.estimateBridgeFee.mockRejectedValue(new Error('rpc down'));
    const props = makeProps({ amount: '1' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await new Promise(r => setTimeout(r, 600));
    expect(result.current.portalFeeCoti).toBeNull();
  });

  it('clears the portal fee when not connected', async () => {
    const props = makeProps({ isConnected: false, amount: '1' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await new Promise(r => setTimeout(r, 600));
    expect(result.current.portalFeeCoti).toBeNull();
  });
});

describe('usePrivacyBridge - checkAllowance fallback symbol resolution', () => {
  for (const [symbol, decimals] of [
    ['USDT', 6],
    ['USDC.e', 6],
    ['WADA', 18],
    ['gCOTI', 18],
  ] as const) {
    it(`resolves ${symbol} via the symbol fallback for a deposit`, async () => {
      eth.allowance.mockResolvedValue(1n);
      const props = makeProps({
        direction: 'to-private',
        publicTokens: [{ symbol, name: symbol, balance: '0', isPrivate: false }],
      });
      const { result } = renderHook(() => usePrivacyBridge(props));
      await act(async () => {
        await result.current.checkAllowance();
      });
      await waitFor(() => expect(result.current.allowance).not.toBe('999999999999999999'));
    });
  }

  it('resolves WBTC private decimals (8) for a withdraw allowance', async () => {
    eth.allowance.mockResolvedValue({ ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n } });
    vi.mocked(decryptCtUint256).mockReturnValue(5n * 10n ** 8n);
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'WBTC', name: 'WBTC', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('5.0'));
  });

  it('resolves COTI/PrivateCoti for a withdraw allowance', async () => {
    eth.allowance.mockResolvedValue({ ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n } });
    vi.mocked(decryptCtUint256).mockReturnValue(7n * 10n ** 18n);
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('7.0'));
  });

  it('returns 0 when the private token address is unresolved on withdraw', async () => {
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'FOO', name: 'FOO', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    // FOO has no bridge address -> early return leaves allowance at reset '0'
    expect(result.current.allowance).toBe('0');
  });

  it('warns and keeps 0 when private allowance decryption throws', async () => {
    eth.allowance.mockResolvedValue({ ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n } });
    vi.mocked(decryptCtUint256).mockImplementation(() => {
      throw new Error('decrypt fail');
    });
    const props = makeProps({ direction: 'to-public' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('0'));
    vi.mocked(decryptCtUint256).mockReset();
    vi.mocked(decryptCtUint256).mockReturnValue(1n);
  });

  it('falls back to 0 when no snap key is available for a private allowance', async () => {
    eth.allowance.mockResolvedValue({ ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n } });
    const props = makeProps({ direction: 'to-public', getAESKeyFromSnap: vi.fn(async () => null) });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('0'));
  });

  it('handles a top-level checkAllowance failure', async () => {
    eth.getNetwork.mockRejectedValue(new Error('network gone'));
    const props = makeProps({ direction: 'to-private' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('0'));
  });
});

describe('usePrivacyBridge - handleApprove fallback resolution', () => {
  for (const [symbol, decimals] of [
    ['WETH', 18],
    ['WBTC', 8],
    ['USDT', 6],
    ['USDC.e', 6],
    ['WADA', 18],
    ['gCOTI', 18],
  ] as const) {
    it(`approves ${symbol} via the symbol fallback (public deposit)`, async () => {
      eth.approve.mockResolvedValue({ wait: async () => ({}) });
      const props = makeProps({
        direction: 'to-private',
        publicTokens: [{ symbol, name: symbol, balance: '0', isPrivate: false }],
        amount: '1',
      });
      const { result } = renderHook(() => usePrivacyBridge(props));
      await act(async () => {
        await result.current.handleApprove();
      });
      expect(eth.approve).toHaveBeenCalled();
      void decimals;
    });
  }

  it('returns when COTI to-public has no native bridge configured', async () => {
    // COTI hits the native branch (no tokenAddress); to-public still requires bridge.
    eth.approve.mockResolvedValue({ wait: async () => ({}) });
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(signer.signMessage).toHaveBeenCalled();
  });

  it('approves WBTC private token (to-public) with 8 decimals', async () => {
    sib.getPublicTokensForChain.mockReturnValue([]);
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'WBTC', name: 'WBTC', balance: '0', isPrivate: false }],
      amount: '1',
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(signer.signMessage).toHaveBeenCalled();
  });
});

describe('usePrivacyBridge - executeTransaction fallback resolution', () => {
  for (const [symbol] of [['WETH'], ['WBTC'], ['USDT'], ['USDC.e'], ['WADA'], ['gCOTI']] as const) {
    it(`bridges ${symbol} via the symbol fallback (deposit)`, async () => {
      sib.getPublicTokensForChain.mockReturnValue([]);
      sib.getPrivateTokensForChain.mockReturnValue([]);
      eth.balanceOf.mockResolvedValue(10n ** 24n);
      eth.allowance.mockResolvedValue(10n ** 24n);
      routeRequest();
      eth.waitForTransaction.mockResolvedValue({ status: 1 });
      const props = makeProps({
        publicTokens: [{ symbol, name: symbol, balance: '100', isPrivate: false }],
      });
      const { result } = renderHook(() => usePrivacyBridge(props));
      await act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      });
      expect(props.setPublicTokens).toHaveBeenCalled();
    });
  }

  it('bridges native COTI via the symbol fallback (else branch)', async () => {
    sib.getPublicTokensForChain.mockReturnValue([]);
    sib.getPrivateTokensForChain.mockReturnValue([]);
    eth.depositUint2.mockResolvedValue({ wait: async () => ({ status: 1 }) });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0);
    });
    expect(eth.depositUint2).toHaveBeenCalled();
  });

  it('logs and continues when the ERC20 deposit fee lookup throws', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    eth.balanceOf.mockResolvedValue(10n ** 24n);
    eth.allowance.mockResolvedValue(10n ** 24n);
    sib.estimateBridgeFee.mockRejectedValue(new Error('fee rpc fail'));
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0);
    });
    expect(props.setPublicTokens).toHaveBeenCalled();
  });

  it('logs and continues when the ERC20 withdraw fee lookup throws', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    sib.estimateBridgeFee.mockRejectedValue(new Error('fee rpc fail'));
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({ direction: 'to-public' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-public', 0);
    });
    expect(props.setPrivateTokens).toHaveBeenCalled();
  });

  it('logs and continues when the native COTI withdraw fee lookup throws', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    sib.estimateBridgeFee.mockRejectedValue(new Error('fee rpc fail'));
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-public', 0);
    });
    expect(props.setPublicTokens).toHaveBeenCalled();
  });

  it('handles a withdraw send failure in the inner catch', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    req().mockImplementation(async (arg: { method: string }) => {
      if (arg.method === 'eth_estimateGas') return '0x' + (300000).toString(16);
      if (arg.method === 'eth_sendTransaction') throw new Error('send rejected');
      return '0x0';
    });
    const props = makeProps({ direction: 'to-public' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-public', 0);
      }),
    ).rejects.toThrow('send rejected');
  });
});

describe('usePrivacyBridge - revert replay branches', () => {
  const setupNativeRevert = (callRejection: unknown) => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      hash: '0xrev',
      wait: async () => ({ status: 0, gasUsed: 5n, to: '0xto', from: WALLET, blockNumber: 1 }),
    });
    eth.call.mockRejectedValue(callRejection);
    routeRequest();
    return makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
  };

  it('uses replayErr.reason when no errorName matches', async () => {
    const props = setupNativeRevert({ reason: 'because reasons' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow(/because reasons/);
  });

  it('uses replayErr.shortMessage as a fallback', async () => {
    const props = setupNativeRevert({ shortMessage: 'short boom' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow(/short boom/);
  });

  it('uses the revert data prefix when nothing else is available', async () => {
    const props = setupNativeRevert({ data: '0x1234567890abcdef' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow(/Revert data: 0x12345678/);
  });
});

describe('usePrivacyBridge - updateGasFee fallback resolution', () => {
  for (const symbol of ['USDT', 'USDC.e', 'WADA', 'gCOTI'] as const) {
    it(`estimates ${symbol} gas via the symbol fallback`, async () => {
      sib.estimateCotiBridgeGasFeeDisplay.mockResolvedValue('0.003');
      const props = makeProps({
        publicTokens: [{ symbol, name: symbol, balance: '0', isPrivate: false }],
      });
      const { result } = renderHook(() => usePrivacyBridge(props));
      await act(async () => {
        await result.current.updateGasFee();
      });
      await waitFor(() => expect(result.current.estimatedGasFee).toBe('0.003'));
    });
  }

  it('returns without a fee when no bridge address can be resolved', async () => {
    const saved = addrs.COTI_ADDR.PrivacyBridgeCotiNative;
    delete (addrs.COTI_ADDR as Record<string, string>).PrivacyBridgeCotiNative;
    try {
      const props = makeProps({
        publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '0', isPrivate: false }],
      });
      const { result } = renderHook(() => usePrivacyBridge(props));
      await act(async () => {
        await result.current.updateGasFee();
      });
      expect(sib.estimateCotiBridgeGasFeeDisplay).not.toHaveBeenCalled();
    } finally {
      addrs.COTI_ADDR.PrivacyBridgeCotiNative = saved;
    }
  });
});

describe('usePrivacyBridge - isApprovalNeeded with a matching MTT permit', () => {
  it('becomes false after a permit is signed for the exact amount', async () => {
    eth.getNetwork.mockResolvedValue({ chainId: 11155111n });
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18 },
    ]);
    sib.getPrivateTokensForChain.mockReturnValue([
      { symbol: 'p.MTT', isPrivate: true, addressKey: 'p.MTT', decimals: 18 },
    ]);
    const amountWei = (10n ** 18n).toString();
    sib.signPodWithdrawPermit.mockResolvedValue({ wallet: WALLET, amountWei });
    const props = makeProps({
      direction: 'to-public',
      amount: '1',
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '5', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    expect(result.current.isApprovalNeeded).toBe(true);
    await act(async () => {
      await result.current.handleApprove();
    });
    await waitFor(() => expect(result.current.isApprovalNeeded).toBe(false));
  });
});

describe('usePrivacyBridge - remaining allowance/approval branches', () => {
  it('uses 6 private decimals for a USDT withdraw allowance', async () => {
    eth.allowance.mockResolvedValue({ ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n } });
    vi.mocked(decryptCtUint256).mockReturnValue(4n * 10n ** 6n);
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'USDT', name: 'USDT', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('4.0'));
  });

  it('returns 0 when the resolved private token address is missing on withdraw', async () => {
    const saved = addrs.COTI_ADDR['p.WETH'];
    delete (addrs.COTI_ADDR as Record<string, string>)['p.WETH'];
    try {
      const props = makeProps({
        direction: 'to-public',
        publicTokens: [{ symbol: 'WETH', name: 'WETH', balance: '0', isPrivate: false }],
      });
      const { result } = renderHook(() => usePrivacyBridge(props));
      await act(async () => {
        await result.current.checkAllowance();
      });
      await waitFor(() => expect(result.current.allowance).toBe('0'));
    } finally {
      addrs.COTI_ADDR['p.WETH'] = saved;
    }
  });

  it('approves a USDT private token (to-public) using 6 decimals', async () => {
    sib.getPublicTokensForChain.mockReturnValue([]);
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'USDT', name: 'USDT', balance: '0', isPrivate: false }],
      amount: '1',
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(signer.signMessage).toHaveBeenCalled();
  });

  it('returns true from isApprovalNeeded when permit comparison parsing throws', async () => {
    eth.getNetwork.mockResolvedValue({ chainId: 11155111n });
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18 },
    ]);
    sib.getPrivateTokensForChain.mockReturnValue([
      { symbol: 'p.MTT', isPrivate: true, addressKey: 'p.MTT', decimals: 18 },
    ]);
    sib.signPodWithdrawPermit.mockResolvedValue({ wallet: WALLET, amountWei: (10n ** 18n).toString() });
    const { result, rerender } = renderHook(
      ({ amount }: { amount: string }) =>
        usePrivacyBridge(
          makeProps({
            direction: 'to-public',
            amount,
            publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '5', isPrivate: false }],
          }),
        ),
      { initialProps: { amount: '1' } },
    );
    await act(async () => {
      await result.current.handleApprove();
    });
    rerender({ amount: 'not-a-number' });
    expect(result.current.isApprovalNeeded).toBe(true);
  });
});

describe('usePrivacyBridge - additional branch coverage', () => {
  it('resolves the p.USDC_E key for a USDC.e withdraw allowance', async () => {
    eth.allowance.mockResolvedValue({ ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n } });
    vi.mocked(decryptCtUint256).mockReturnValue(2n * 10n ** 6n);
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'USDC.e', name: 'USDC.e', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('2.0'));
  });

  it('skips decryption for a withdraw allowance when the snap is absent', async () => {
    eth.allowance.mockResolvedValue({ ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n } });
    const props = makeProps({ direction: 'to-public', hasSnap: false });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.checkAllowance();
    });
    await waitFor(() => expect(result.current.allowance).toBe('0'));
  });

  it('approves a USDC.e private token (to-public) via the p.USDC_E key', async () => {
    sib.getPublicTokensForChain.mockReturnValue([]);
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'USDC.e', name: 'USDC.e', balance: '0', isPrivate: false }],
      amount: '1',
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(signer.signMessage).toHaveBeenCalled();
  });

  it('throws when the private token address is missing during approval', async () => {
    sib.getPublicTokensForChain.mockReturnValue([]);
    const saved = addrs.COTI_ADDR['p.WETH'];
    delete (addrs.COTI_ADDR as Record<string, string>)['p.WETH'];
    try {
      const props = makeProps({
        direction: 'to-public',
        publicTokens: [{ symbol: 'WETH', name: 'WETH', balance: '0', isPrivate: false }],
        amount: '1',
      });
      const { result } = renderHook(() => usePrivacyBridge(props));
      await expect(
        act(async () => {
          await result.current.handleApprove();
        }),
      ).rejects.toThrow('Private token address not found');
    } finally {
      addrs.COTI_ADDR['p.WETH'] = saved;
    }
  });

  it('throws when the p.MTT address is missing for the PoD permit', async () => {
    eth.getNetwork.mockResolvedValue({ chainId: 11155111n });
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18 },
    ]);
    sib.getPrivateTokensForChain.mockReturnValue([{ symbol: 'p.MTT', isPrivate: true, decimals: 18 }]);
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '5', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.handleApprove();
      }),
    ).rejects.toThrow('p.MTT address not found');
  });

  it('throws "Bridge address not found" when no bridge resolves for a deposit', async () => {
    sib.getPublicTokensForChain.mockReturnValue([]);
    sib.getPrivateTokensForChain.mockReturnValue([]);
    const saved = addrs.COTI_ADDR.PrivacyBridgeCotiNative;
    delete (addrs.COTI_ADDR as Record<string, string>).PrivacyBridgeCotiNative;
    try {
      const props = makeProps({
        publicTokens: [{ symbol: 'XYZ', name: 'XYZ', balance: '0', isPrivate: false }],
      });
      const { result } = renderHook(() => usePrivacyBridge(props));
      await expect(
        act(async () => {
          await result.current.executeTransaction('1', 'to-private', 0);
        }),
      ).rejects.toThrow('Bridge address not found');
    } finally {
      addrs.COTI_ADDR.PrivacyBridgeCotiNative = saved;
    }
  });

  it('handles an ERC20 deposit when the fee estimate returns Error/missing timestamps', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    eth.balanceOf.mockResolvedValue(10n ** 24n);
    eth.allowance.mockResolvedValue(10n ** 24n);
    sib.estimateBridgeFee.mockResolvedValue({
      depositFee: 'Error',
      withdrawFee: 'Error',
      cotiLastUpdated: '',
      tokenLastUpdated: '',
      blockTimestamp: '',
    });
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps();
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0);
    });
    expect(props.setPublicTokens).toHaveBeenCalled();
  });

  it('handles a native deposit with a missing oracle timestamp', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    sib.estimateBridgeFee.mockResolvedValue({
      depositFee: '0.01',
      withdrawFee: '0.02',
      cotiLastUpdated: '',
      tokenLastUpdated: '',
      blockTimestamp: '',
    });
    eth.depositUint2.mockResolvedValue({ wait: async () => ({ status: 1 }) });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0);
    });
    expect(eth.depositUint2).toHaveBeenCalled();
  });

  it('handles an ERC20 withdraw when the fee estimate returns Error', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    sib.estimateBridgeFee.mockResolvedValue({
      depositFee: 'Error',
      withdrawFee: 'Error',
      cotiLastUpdated: '',
      tokenLastUpdated: '',
      blockTimestamp: '',
    });
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({ direction: 'to-public' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-public', 0);
    });
    expect(props.setPrivateTokens).toHaveBeenCalled();
  });

  it('handles a native withdraw with a missing oracle timestamp', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    sib.estimateBridgeFee.mockResolvedValue({
      depositFee: '0.01',
      withdrawFee: '0.02',
      cotiLastUpdated: '',
      tokenLastUpdated: '',
      blockTimestamp: '',
    });
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-public', 0);
    });
    expect(props.setPublicTokens).toHaveBeenCalled();
  });

  it('logs without reason/data when native gas estimation fails plainly', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.estimateGas.mockRejectedValue(new Error('plain'));
    eth.depositUint2.mockResolvedValue({ wait: async () => ({ status: 1 }) });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0);
    });
    expect(eth.depositUint2).toHaveBeenCalled();
  });

  it('handles a withdraw gas-estimate failure without a message', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    req().mockImplementation(async (arg: { method: string }) => {
      if (arg.method === 'eth_estimateGas') throw {};
      if (arg.method === 'eth_sendTransaction') return '0x' + 'a'.repeat(64);
      return '0x0';
    });
    const props = makeProps({ direction: 'to-public' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-public', 0);
    });
    expect(props.setPrivateTokens).toHaveBeenCalled();
  });

  it('decodes an on-chain revert with no gas/hash and an empty replay', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      wait: async () => ({ status: 0, to: '0xto', from: WALLET, blockNumber: 1 }),
    });
    eth.call.mockResolvedValue('0x'); // replay does not throw -> no revertReason
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow('Transaction failed on-chain.');
  });

  it('succeeds without triggering a private balance refresh when none is provided', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    eth.balanceOf.mockResolvedValue(10n ** 24n);
    eth.allowance.mockResolvedValue(10n ** 24n);
    routeRequest();
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    const props = makeProps({ refreshPrivateBalances: undefined });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.executeTransaction('1', 'to-private', 0);
    });
    expect(props.setPublicTokens).toHaveBeenCalled();
  });

  it('falls back to the generic reason for a CALL_EXCEPTION with an unknown selector', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      wait: async () => {
        throw { code: 'CALL_EXCEPTION', data: '0xffffffff' + '0'.repeat(8), shortMessage: 'short fallback' };
      },
    });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow('short fallback');
  });

  it('uses the default revert message for a bare CALL_EXCEPTION', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      wait: async () => {
        throw { code: 'CALL_EXCEPTION' };
      },
    });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow('Transaction reverted on-chain.');
  });

  it('surfaces error.reason for a non-CALL_EXCEPTION failure', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      wait: async () => {
        throw { reason: 'reasoned failure' };
      },
    });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toMatchObject({ reason: 'reasoned failure' });
    const lastToast = props.setToastState.mock.calls.at(-1)?.[0];
    expect(lastToast).toMatchObject({ message: 'reasoned failure' });
  });

  it('shows "Unknown error occurred" for an empty rejection object', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      wait: async () => {
        throw {};
      },
    });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toBeTruthy();
    const lastToast = props.setToastState.mock.calls.at(-1)?.[0];
    expect(lastToast).toMatchObject({ message: 'Unknown error occurred' });
  });

  it('handleSwap tolerates an out-of-range token index', async () => {
    const props = makeProps({ direction: 'to-public', hasSnap: false, getAESKeyFromSnap: vi.fn(async () => null) });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.handleSwap('1', 'to-public', 99);
      }),
    ).rejects.toThrow(/Snap connection failed/);
  });

  it('updateGasFee handles an empty public token list', async () => {
    sib.estimateCotiBridgeGasFeeDisplay.mockResolvedValue('0.0005');
    const props = makeProps({ publicTokens: [], selectedTokenIndex: 0 });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.updateGasFee();
    });
    await waitFor(() => expect(result.current.estimatedGasFee).toBe('0.0005'));
  });

  it('updateGasFee uses private decimals for a to-public estimate', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.estimateCotiBridgeGasFeeDisplay.mockResolvedValue('0.0007');
    const props = makeProps({ direction: 'to-public' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.updateGasFee();
    });
    await waitFor(() => expect(result.current.estimatedGasFee).toBe('0.0007'));
  });

  it('fetchPortalFee uses the withdraw fee for a to-public p.token', async () => {
    sib.estimateBridgeFee.mockResolvedValue({
      depositFee: '0.05',
      withdrawFee: '0.07',
      cotiLastUpdated: '1',
      tokenLastUpdated: '2',
      blockTimestamp: '3',
    });
    const props = makeProps({
      direction: 'to-public',
      amount: '1',
      publicTokens: [{ symbol: 'p.WETH', name: 'p.WETH', balance: '0', isPrivate: true }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await waitFor(() => expect(result.current.portalFeeCoti).toBe('0.07'), { timeout: 2000 });
  });

  it('returns from approve for an unknown symbol on a deposit (no addresses)', async () => {
    sib.getPublicTokensForChain.mockReturnValue([]);
    eth.approve.mockResolvedValue({ wait: async () => ({}) });
    const props = makeProps({
      direction: 'to-private',
      publicTokens: [{ symbol: 'XYZ', name: 'XYZ', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(eth.approve).not.toHaveBeenCalled();
  });

  it('returns from approve for an unknown symbol on a withdraw (no bridge)', async () => {
    sib.getPublicTokensForChain.mockReturnValue([]);
    const props = makeProps({
      direction: 'to-public',
      publicTokens: [{ symbol: 'XYZ', name: 'XYZ', balance: '0', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(signer.signMessage).not.toHaveBeenCalled();
  });

  it('signs a PoD permit with a defaulted (empty) amount', async () => {
    eth.getNetwork.mockResolvedValue({ chainId: 11155111n });
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18 },
    ]);
    sib.getPrivateTokensForChain.mockReturnValue([
      { symbol: 'p.MTT', isPrivate: true, addressKey: 'p.MTT', decimals: 18 },
    ]);
    sib.signPodWithdrawPermit.mockResolvedValue({ wallet: WALLET, amountWei: '0' });
    const props = makeProps({
      direction: 'to-public',
      amount: '',
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '5', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(sib.signPodWithdrawPermit).toHaveBeenCalled();
  });

  it('isApprovalNeeded handles an empty amount with a permit present', async () => {
    eth.getNetwork.mockResolvedValue({ chainId: 11155111n });
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT', decimals: 18 },
    ]);
    sib.getPrivateTokensForChain.mockReturnValue([
      { symbol: 'p.MTT', isPrivate: true, addressKey: 'p.MTT', decimals: 18 },
    ]);
    sib.signPodWithdrawPermit.mockResolvedValue({ wallet: WALLET, amountWei: (10n ** 18n).toString() });
    const { result, rerender } = renderHook(
      ({ amount }: { amount: string }) =>
        usePrivacyBridge(
          makeProps({
            direction: 'to-public',
            amount,
            publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '5', isPrivate: false }],
          }),
        ),
      { initialProps: { amount: '1' } },
    );
    await act(async () => {
      await result.current.handleApprove();
    });
    rerender({ amount: '' });
    expect(result.current.isApprovalNeeded).toBe(true);
  });

  it('decodes an on-chain revert via replay revert data', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      hash: '0xrev',
      wait: async () => ({ status: 0, gasUsed: 1n, to: '0xto', from: WALLET, blockNumber: 1 }),
    });
    eth.call.mockRejectedValue({ data: '0x1234567890abcdef' });
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow(/Revert data: 0x12345678/);
  });

  it('fetchPortalFee clears to null when the raw fee is exactly "0"', async () => {
    sib.estimateBridgeFee.mockResolvedValue({
      depositFee: '0',
      withdrawFee: '0',
      cotiLastUpdated: '1',
      tokenLastUpdated: '2',
      blockTimestamp: '3',
    });
    const props = makeProps({ amount: '1', direction: 'to-private' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await new Promise(r => setTimeout(r, 600));
    expect(result.current.portalFeeCoti).toBeNull();
  });

  it('decodes an on-chain revert when replay yields no useful data', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.depositUint2.mockResolvedValue({
      hash: '0xrev',
      wait: async () => ({ status: 0, gasUsed: 1n, to: '0xto', from: WALLET, blockNumber: 1 }),
    });
    eth.call.mockRejectedValue({});
    routeRequest();
    const props = makeProps({
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await expect(
      act(async () => {
        await result.current.executeTransaction('1', 'to-private', 0);
      }),
    ).rejects.toThrow('Transaction failed on-chain.');
  });

  it('fetchPortalFee handles an empty token symbol and falsy amount', async () => {
    const props = makeProps({ amount: '', publicTokens: [], selectedTokenIndex: 0 });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await new Promise(r => setTimeout(r, 600));
    expect(result.current.portalFeeCoti).toBeNull();
  });

  it('fetchPortalFee clears to null when the fee strips down to 0', async () => {
    sib.estimateBridgeFee.mockResolvedValue({
      depositFee: '0.000',
      withdrawFee: '0.000',
      cotiLastUpdated: '1',
      tokenLastUpdated: '2',
      blockTimestamp: '3',
    });
    const props = makeProps({ amount: '1', direction: 'to-private' });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await new Promise(r => setTimeout(r, 600));
    expect(result.current.portalFeeCoti).toBeNull();
  });
});

describe('usePrivacyBridge - handleApprove edge paths', () => {
  it('returns early for native COTI deposit (no approval needed)', async () => {
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'COTI', isPrivate: false, bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18 },
    ]);
    eth.approve.mockResolvedValue({ wait: async () => ({}) });
    const props = makeProps({
      direction: 'to-private',
      publicTokens: [{ symbol: 'COTI', name: 'COTI', balance: '100', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(eth.approve).not.toHaveBeenCalled();
  });

  it('signs MTT PoD permit using default 18 decimals when token config omits decimals', async () => {
    eth.getNetwork.mockResolvedValue({ chainId: 11155111n });
    sib.getPublicTokensForChain.mockReturnValue([
      { symbol: 'MTT', isPrivate: false, addressKey: 'MTT', bridgeAddressKey: 'PrivacyPortalMTT' },
    ]);
    sib.getPrivateTokensForChain.mockReturnValue([
      { symbol: 'p.MTT', isPrivate: true, addressKey: 'p.MTT', decimals: 18 },
    ]);
    sib.signPodWithdrawPermit.mockResolvedValue({ wallet: WALLET, amountWei: '1000' });
    const props = makeProps({
      direction: 'to-public',
      amount: '1',
      publicTokens: [{ symbol: 'MTT', name: 'MTT', balance: '5', isPrivate: false }],
    });
    const { result } = renderHook(() => usePrivacyBridge(props));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(sib.signPodWithdrawPermit).toHaveBeenCalled();
  });
});

describe('usePrivacyBridge - duplicate submission guard', () => {
  it('ignores a second handleSwap while a transaction is in progress', async () => {
    sib.getPublicTokensForChain.mockReturnValue(ercPublicCfg('WETH'));
    sib.getPrivateTokensForChain.mockReturnValue(ercPrivateCfg('WETH'));
    eth.balanceOf.mockResolvedValue(10n ** 24n);
    eth.allowance.mockResolvedValue(10n ** 24n);
    let release!: (v: unknown) => void;
    const pending = new Promise(r => (release = r));
    req().mockImplementation(async (arg: { method: string }) => {
      if (arg.method === 'eth_estimateGas') return '0x' + (300000).toString(16);
      if (arg.method === 'eth_sendTransaction') return '0x' + 'a'.repeat(64);
      return '0x0';
    });
    eth.waitForTransaction.mockReturnValue(pending);
    const props = makeProps({ hasSnap: true });
    const { result } = renderHook(() => usePrivacyBridge(props));

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.handleSwap('1', 'to-private', 0);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isBridgingLoading).toBe(true));

    await act(async () => {
      await result.current.handleSwap('1', 'to-private', 0);
    });

    await act(async () => {
      release({ status: 1 });
      await first;
    });
    expect(result.current.isBridgingLoading).toBe(false);
  });
});
