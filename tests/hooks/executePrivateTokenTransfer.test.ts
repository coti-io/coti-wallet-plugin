import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers as realEthers } from 'ethers';
import { CONTRACT_ADDRESSES } from '../../src/contracts/config';
import { COTI_TESTNET_CHAIN_ID } from '../../src/chains/coti';

const WALLET = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const TOKEN = '0xF009BADb181d471995a1CFF406C3Db7B180F64eA';
const AES_KEY = 'a'.repeat(32);

const eth = vi.hoisted(() => ({
  getSigner: vi.fn(),
  getNetwork: vi.fn(),
  waitForTransaction: vi.fn(),
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockBrowserProvider {
    constructor(_provider: unknown) {}
    getSigner = (...args: unknown[]) => eth.getSigner(...args);
    getNetwork = (...args: unknown[]) => eth.getNetwork(...args);
    waitForTransaction = (...args: unknown[]) => eth.waitForTransaction(...args);
  }
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      BrowserProvider: MockBrowserProvider,
    },
  };
});

vi.mock('../../src/hooks/privacyBridge/encryptValue256', () => ({
  encryptValue256: vi.fn(async () => ({
    ciphertext: { ciphertextHigh: 123n, ciphertextLow: 456n },
    signature: `0x${'ab'.repeat(65)}`,
  })),
}));

const podTransfer = vi.hoisted(() => ({
  executePodPrivateTokenTransfer: vi.fn(async () => ({
    txHash: '0xpod',
    request: {
      id: '0xpod',
      kind: 'transfer' as const,
      chainId: 11155111,
      sourceTxHash: '0xpod',
      wallet: '0x1111111111111111111111111111111111111111',
      token: 'p.MTT',
      amount: '1',
      status: 'source-mined' as const,
      createdAt: 1,
      updatedAt: 1,
    },
  })),
}));

vi.mock('../../src/chains/portal/executePodPrivateTokenTransfer', () => ({
  executePodPrivateTokenTransfer: (...args: unknown[]) =>
    podTransfer.executePodPrivateTokenTransfer(...args),
}));

import {
  executePrivateTokenTransfer,
  sendPrivateTokenTransfer,
  normalizeAesKeyHex,
  resolvePrivateTokenContractAddress,
  resolvePrivateTokenTransferTarget,
  PRIVATE_ERC20_TRANSFER_256_SIG,
} from '../../src/hooks/privacyBridge/executePrivateTokenTransfer';
import { SEPOLIA_CHAIN_ID } from '../../src/chains/sepolia';

describe('executePrivateTokenTransfer', () => {
  const mockRequest = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    eth.getSigner.mockResolvedValue({
      signMessage: vi.fn(),
      getAddress: vi.fn(async () => WALLET),
    });
    eth.getNetwork.mockResolvedValue({ chainId: BigInt(COTI_TESTNET_CHAIN_ID) });
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    mockRequest.mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'eth_estimateGas') {
        return '0x5208';
      }
      if (method === 'eth_sendTransaction') {
        return '0xdeadbeef';
      }
      return null;
    });

    Object.defineProperty(window, 'ethereum', {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    });
  });

  it('rejects invalid recipient', async () => {
    await expect(
      executePrivateTokenTransfer({
        tokenAddress: TOKEN,
        recipient: 'not-an-address',
        amount: '1',
        decimals: 18,
        aesKey: AES_KEY,
        walletAddress: WALLET,
      }),
    ).rejects.toThrow('Invalid recipient address');
  });

  it('rejects send to self', async () => {
    await expect(
      executePrivateTokenTransfer({
        tokenAddress: TOKEN,
        recipient: WALLET,
        amount: '1',
        decimals: 18,
        aesKey: AES_KEY,
        walletAddress: WALLET,
      }),
    ).rejects.toThrow('Cannot send to your own address');
  });

  it('rejects invalid AES key', async () => {
    await expect(
      executePrivateTokenTransfer({
        tokenAddress: TOKEN,
        recipient: RECIPIENT,
        amount: '1',
        decimals: 18,
        aesKey: 'too-short',
        walletAddress: WALLET,
      }),
    ).rejects.toThrow('AES key must be a 32-hex-character string');
  });

  it('submits encrypted transfer tx and waits for receipt', async () => {
    const result = await executePrivateTokenTransfer({
      tokenAddress: TOKEN,
      recipient: RECIPIENT,
      amount: '1.5',
      decimals: 18,
      aesKey: AES_KEY,
      walletAddress: WALLET,
    });

    expect(result.txHash).toBe('0xdeadbeef');
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'eth_estimateGas' }),
    );
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'eth_sendTransaction' }),
    );

    const sendCall = mockRequest.mock.calls.find(
      ([arg]) => arg.method === 'eth_sendTransaction',
    );
    expect(sendCall).toBeDefined();
    const txParams = (sendCall![0].params as Array<Record<string, string>>)[0];
    expect(txParams.from).toBe(WALLET);
    expect(txParams.to).toBe(TOKEN);
    expect(txParams.data).toMatch(/^0x/);

    const transferSig = realEthers.id(PRIVATE_ERC20_TRANSFER_256_SIG).slice(0, 10);
    expect(txParams.data.startsWith(transferSig)).toBe(true);
    expect(eth.waitForTransaction).toHaveBeenCalledWith('0xdeadbeef', 1, expect.any(Number));
  });

  it('uses gas fallback when estimation fails', async () => {
    mockRequest.mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'eth_estimateGas') {
        throw new Error('estimate failed');
      }
      if (method === 'eth_sendTransaction') {
        return '0xabc';
      }
      return null;
    });

    const result = await executePrivateTokenTransfer({
      tokenAddress: TOKEN,
      recipient: RECIPIENT,
      amount: '1',
      decimals: 18,
      aesKey: AES_KEY,
      walletAddress: WALLET,
    });

    expect(result.txHash).toBe('0xabc');
    const sendCall = mockRequest.mock.calls.find(
      ([arg]) => arg.method === 'eth_sendTransaction',
    );
    const txParams = (sendCall![0].params as Array<Record<string, string>>)[0];
    expect(txParams.gas).toBe('0x1e8480');
  });

  it('throws when receipt status is not success', async () => {
    eth.waitForTransaction.mockResolvedValue({ status: 0 });

    await expect(
      executePrivateTokenTransfer({
        tokenAddress: TOKEN,
        recipient: RECIPIENT,
        amount: '1',
        decimals: 18,
        aesKey: AES_KEY,
        walletAddress: WALLET,
      }),
    ).rejects.toThrow('Private token transfer failed');
  });
});

describe('normalizeAesKeyHex', () => {
  it('accepts 32 hex chars with or without 0x', () => {
    expect(normalizeAesKeyHex(AES_KEY)).toBe(AES_KEY);
    expect(normalizeAesKeyHex(`0x${AES_KEY}`)).toBe(AES_KEY);
  });
});

describe('resolvePrivateTokenContractAddress', () => {
  it('resolves p.WETH on COTI testnet', () => {
    const addr = resolvePrivateTokenContractAddress(COTI_TESTNET_CHAIN_ID, 'p.WETH');
    expect(addr).toBe(CONTRACT_ADDRESSES[COTI_TESTNET_CHAIN_ID]['p.WETH']);
  });
});

describe('resolvePrivateTokenTransferTarget', () => {
  it('resolves p.WETH symbol on COTI testnet', () => {
    const target = resolvePrivateTokenTransferTarget(COTI_TESTNET_CHAIN_ID, 'p.WETH');
    expect(target).not.toBeNull();
    expect(target!.tokenAddress).toBe(CONTRACT_ADDRESSES[COTI_TESTNET_CHAIN_ID]['p.WETH']);
    expect(target!.decimals).toBe(18);
  });

  it('returns null for unknown symbol', () => {
    expect(resolvePrivateTokenTransferTarget(COTI_TESTNET_CHAIN_ID, 'p.UNKNOWN')).toBeNull();
  });
});

describe('sendPrivateTokenTransfer strategy branching', () => {
  const mockRequest = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_estimateGas') return '0x5208';
    if (method === 'eth_sendTransaction') return '0xdeadbeef';
    return null;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    eth.getSigner.mockResolvedValue({
      signMessage: vi.fn(),
      getAddress: vi.fn(async () => WALLET),
    });
    eth.waitForTransaction.mockResolvedValue({ status: 1 });
    podTransfer.executePodPrivateTokenTransfer.mockResolvedValue({
      txHash: '0xpod',
      request: {
        id: '0xpod',
        kind: 'transfer',
        chainId: 11155111,
        sourceTxHash: '0xpod',
        wallet: WALLET,
        token: 'p.MTT',
        amount: '1',
        status: 'source-mined',
        createdAt: 1,
        updatedAt: 1,
      },
    });
    Object.defineProperty(window, 'ethereum', {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    });
  });

  it('routes PoD chains to executePodPrivateTokenTransfer without AES', async () => {
    const result = await sendPrivateTokenTransfer({
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      recipient: RECIPIENT,
      amount: '1',
      walletAddress: WALLET,
      provider: { request: mockRequest } as never,
    });

    expect(podTransfer.executePodPrivateTokenTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: SEPOLIA_CHAIN_ID,
        symbol: 'p.MTT',
        recipient: RECIPIENT,
        amount: '1',
        walletAddress: WALLET,
      }),
    );
    expect(result.txHash).toBe('0xpod');
    expect(result.request?.kind).toBe('transfer');
  });

  it('keeps COTI path on AES PrivateERC20 transfer', async () => {
    const result = await sendPrivateTokenTransfer({
      chainId: COTI_TESTNET_CHAIN_ID,
      symbol: 'p.WETH',
      recipient: RECIPIENT,
      amount: '1',
      walletAddress: WALLET,
      sessionAesKey: AES_KEY,
      provider: { request: mockRequest } as never,
    });

    expect(podTransfer.executePodPrivateTokenTransfer).not.toHaveBeenCalled();
    expect(result.txHash).toBe('0xdeadbeef');
  });
});
