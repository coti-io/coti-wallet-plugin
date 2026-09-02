import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAccount } from 'wagmi';

const eth = vi.hoisted(() => ({
  getNetwork: vi.fn(),
  getSigner: vi.fn(),
  allowance: vi.fn(),
  approve: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockBrowserProvider {
    constructor(_p: unknown) {}
    getNetwork = (...a: unknown[]) => eth.getNetwork(...a);
    getSigner = (...a: unknown[]) => eth.getSigner(...a);
  }
  class MockContract {
    allowance = (...a: unknown[]) => eth.allowance(...a);
    approve = (...a: unknown[]) => eth.approve(...a);
    constructor(_address: string, _abi: unknown, _runner: unknown) {}
  }
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      BrowserProvider: MockBrowserProvider,
      Contract: MockContract,
    },
  };
});

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ connector: undefined })),
}));

const snap = vi.hoisted(() => ({
  decryptCtUint256ViaSnap: vi.fn(),
  buildItUint256ViaSnap: vi.fn(),
}));
vi.mock('../../src/hooks/useSnap', () => ({
  useSnap: () => snap,
}));

vi.mock('../../src/crypto/decryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/crypto/decryption')>();
  return {
    ...actual,
    decryptCtUint256: vi.fn(),
  };
});

vi.mock('../../src/lib/rpcProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/rpcProvider')>();
  return {
    ...actual,
    waitForTransactionResilient: vi.fn(async () => ({ status: 1 })),
  };
});

import { decryptCtUint256 } from '../../src/crypto/decryption';
import { usePluginBridgeAllowance } from '../../src/hooks/bridge/usePluginBridgeAllowance';
import { getInitialPublicTokens } from '../../src/hooks/usePluginBridge';

const COTI_TESTNET = 7082400;
const WALLET = '0x' + 'a'.repeat(40);

function wethToken() {
  return getInitialPublicTokens(COTI_TESTNET).find(t => t.symbol === 'WETH')!;
}

function cotiToken() {
  return getInitialPublicTokens(COTI_TESTNET).find(t => t.symbol === 'COTI')!;
}

describe('usePluginBridgeAllowance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eth.getNetwork.mockResolvedValue({ chainId: BigInt(COTI_TESTNET) });
    eth.getSigner.mockResolvedValue({
      address: WALLET,
      signTypedData: vi.fn(),
    });
    eth.allowance.mockResolvedValue(0n);
    snap.decryptCtUint256ViaSnap.mockResolvedValue(null);
    vi.mocked(decryptCtUint256).mockReturnValue(10n ** 18n);
    vi.mocked(useAccount).mockReturnValue({ connector: undefined } as never);
    (window as unknown as { ethereum: unknown }).ethereum = { request: vi.fn() };
  });

  it('does nothing when disconnected', async () => {
    const { result } = renderHook(() => usePluginBridgeAllowance({
      isConnected: false,
      walletAddress: '',
      publicTokens: [wethToken()],
      amount: '1',
      direction: 'to-private',
      selectedTokenIndex: 0,
      hasSnap: false,
      setToastState: vi.fn(),
      chainId: COTI_TESTNET,
    }));
    await act(async () => {
      await result.current.checkAllowance();
      await result.current.handleApprove();
    });
    expect(eth.allowance).not.toHaveBeenCalled();
    expect(result.current.allowance).toBe('0');
  });

  it('skips ERC-20 allowance for native COTI deposits', async () => {
    const { result } = renderHook(() => usePluginBridgeAllowance({
      isConnected: true,
      walletAddress: WALLET,
      publicTokens: [cotiToken()],
      amount: '1',
      direction: 'to-private',
      selectedTokenIndex: 0,
      hasSnap: false,
      setToastState: vi.fn(),
      chainId: COTI_TESTNET,
    }));
    await waitFor(() => {
      expect(result.current.allowance).toBe('999999999999999999');
    });
  });

  it('reads a public ERC-20 allowance and falls back when the connector provider throws', async () => {
    vi.mocked(useAccount).mockReturnValue({
      connector: {
        id: 'io.metamask',
        getProvider: vi.fn(async () => {
          throw new Error('reconnect');
        }),
      },
    } as never);
    eth.allowance.mockResolvedValue(5n * 10n ** 18n);
    const { result } = renderHook(() => usePluginBridgeAllowance({
      isConnected: true,
      walletAddress: WALLET,
      publicTokens: [wethToken()],
      amount: '1',
      direction: 'to-private',
      selectedTokenIndex: 0,
      hasSnap: false,
      setToastState: vi.fn(),
      chainId: COTI_TESTNET,
    }));
    await waitFor(() => {
      expect(result.current.allowance).toBe('5.0');
    });
    expect(result.current.isApprovalNeeded).toBe(false);
  });

  it('decrypts a private allowance from named ciphertext limbs', async () => {
    eth.allowance.mockResolvedValue({
      ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n },
    });
    const { result } = renderHook(() => usePluginBridgeAllowance({
      isConnected: true,
      walletAddress: WALLET,
      publicTokens: [wethToken()],
      amount: '1',
      direction: 'to-public',
      selectedTokenIndex: 0,
      hasSnap: false,
      setToastState: vi.fn(),
      sessionAesKey: 'a'.repeat(32),
      chainId: COTI_TESTNET,
    }));
    await waitFor(() => {
      expect(result.current.allowance).toBe('1.0');
    });
    expect(decryptCtUint256).toHaveBeenCalled();
  });

  it('treats undecryptable non-zero private allowance as unlimited', async () => {
    vi.mocked(decryptCtUint256).mockReturnValue(null as never);
    eth.allowance.mockResolvedValue({
      1: { 0: 8n, 1: 9n },
    });
    const { result } = renderHook(() => usePluginBridgeAllowance({
      isConnected: true,
      walletAddress: WALLET,
      publicTokens: [wethToken()],
      amount: '1',
      direction: 'to-public',
      selectedTokenIndex: 0,
      hasSnap: false,
      setToastState: vi.fn(),
      sessionAesKey: 'a'.repeat(32),
      chainId: COTI_TESTNET,
    }));
    await waitFor(() => {
      expect(Number(result.current.allowance)).toBeGreaterThan(1);
    });
  });

  it('defaults private allowance to 0 when ciphertext is missing or decrypt throws', async () => {
    eth.allowance.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n },
    });
    vi.mocked(decryptCtUint256).mockImplementation(() => {
      throw new Error('bad key');
    });

    const first = renderHook(() => usePluginBridgeAllowance({
      isConnected: true,
      walletAddress: WALLET,
      publicTokens: [wethToken()],
      amount: '1',
      direction: 'to-public',
      selectedTokenIndex: 0,
      hasSnap: false,
      setToastState: vi.fn(),
      sessionAesKey: 'a'.repeat(32),
      chainId: COTI_TESTNET,
    }));
    await waitFor(() => expect(first.result.current.allowance).toBe('0'));

    const second = renderHook(() => usePluginBridgeAllowance({
      isConnected: true,
      walletAddress: WALLET,
      publicTokens: [wethToken()],
      amount: '1',
      direction: 'to-public',
      selectedTokenIndex: 0,
      hasSnap: false,
      setToastState: vi.fn(),
      sessionAesKey: 'a'.repeat(32),
      chainId: COTI_TESTNET,
    }));
    await waitFor(() => expect(second.result.current.allowance).toBe('0'));
  });

  it('defaults private allowance to 0 when there is no session key or Snap', async () => {
    eth.allowance.mockResolvedValue({
      ownerCiphertext: { ciphertextHigh: 1n, ciphertextLow: 2n },
    });
    const { result } = renderHook(() => usePluginBridgeAllowance({
      isConnected: true,
      walletAddress: WALLET,
      publicTokens: [wethToken()],
      amount: '1',
      direction: 'to-public',
      selectedTokenIndex: 0,
      hasSnap: false,
      setToastState: vi.fn(),
      sessionAesKey: null,
      chainId: COTI_TESTNET,
    }));
    await waitFor(() => expect(result.current.allowance).toBe('0'));
  });

  it('skips native COTI deposit approval in handleApprove', async () => {
    const { result } = renderHook(() => usePluginBridgeAllowance({
      isConnected: true,
      walletAddress: WALLET,
      publicTokens: [cotiToken()],
      amount: '1',
      direction: 'to-private',
      selectedTokenIndex: 0,
      hasSnap: false,
      setToastState: vi.fn(),
      chainId: COTI_TESTNET,
    }));
    await act(async () => {
      await result.current.handleApprove();
    });
    expect(eth.approve).not.toHaveBeenCalled();
  });
});
