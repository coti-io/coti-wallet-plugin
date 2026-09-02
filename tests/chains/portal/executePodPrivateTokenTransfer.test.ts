import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { SEPOLIA_CHAIN_ID } from '../../../src/chains/sepolia';
import { COTI_TESTNET_CHAIN_ID } from '../../../src/chains/coti';

const h = vi.hoisted(() => ({
  getEthereumProvider: vi.fn(() => ({ request: vi.fn() })),
  getSigner: vi.fn(),
  assertPodPTokenReady: vi.fn(async () => undefined),
  resolvePodTxGasPrice: vi.fn(async () => 1_000_000_000n),
  estimatePodTransferFee: vi.fn(),
  sendPodTransferMethod: vi.fn(),
  quotePodTransferFees: vi.fn(),
  waitForTransactionResilient: vi.fn(),
  parseLog: vi.fn(),
}));

vi.mock('../../../src/lib/ethereum', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/ethereum')>();
  return {
    ...actual,
    getEthereumProvider: () => h.getEthereumProvider(),
  };
});

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class BrowserProvider {
    getSigner = (...args: unknown[]) => h.getSigner(...args);
  }
  class Contract {}
  class Interface {
    parseLog = (...args: unknown[]) => h.parseLog(...args);
  }
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      BrowserProvider,
      Contract,
      Interface,
    },
  };
});

vi.mock('../../../src/chains/portal/executePodPortalTransaction', () => ({
  assertPodPTokenReady: (...args: unknown[]) => h.assertPodPTokenReady(...args),
}));

vi.mock('../../../src/chains/portal/podPortalFees', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/chains/portal/podPortalFees')>();
  return {
    ...actual,
    resolvePodTxGasPrice: (...args: unknown[]) => h.resolvePodTxGasPrice(...args),
  };
});

vi.mock('../../../src/chains/portal/podTransferFees', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/chains/portal/podTransferFees')>();
  return {
    ...actual,
    estimatePodTransferFee: (...args: unknown[]) => h.estimatePodTransferFee(...args),
    sendPodTransferMethod: (...args: unknown[]) => h.sendPodTransferMethod(...args),
    quotePodTransferFees: (...args: unknown[]) => h.quotePodTransferFees(...args),
  };
});

vi.mock('../../../src/lib/rpcProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/rpcProvider')>();
  return {
    ...actual,
    waitForTransactionResilient: (...args: unknown[]) => h.waitForTransactionResilient(...args),
  };
});

import {
  executePodPrivateTokenTransfer,
  quotePodPrivateTokenTransferFees,
} from '../../../src/chains/portal/executePodPrivateTokenTransfer';

const WALLET = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

describe('executePodPrivateTokenTransfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getEthereumProvider.mockReturnValue({ request: vi.fn() });
    h.getSigner.mockResolvedValue({ getAddress: async () => WALLET });
    h.estimatePodTransferFee.mockResolvedValue({ totalFee: 100n, remoteFee: 80n, callBackFee: 20n });
    h.sendPodTransferMethod.mockResolvedValue({ hash: '0xabc' });
    h.waitForTransactionResilient.mockResolvedValue({
      status: 1,
      blockNumber: 12,
      logs: [{ topics: ['0x1'], data: '0x' }],
    });
    h.parseLog.mockReturnValue({ name: 'TransferRequestSubmitted', args: { requestId: '0xrid' } });
    h.quotePodTransferFees.mockResolvedValue({
      display: { podInboxFee: '0.1', l1Gas: '0.01', feeSymbol: 'ETH' },
    });
  });

  it('rejects transfers that are not on a PoD portal chain', async () => {
    await expect(executePodPrivateTokenTransfer({
      chainId: COTI_TESTNET_CHAIN_ID,
      symbol: 'p.COTI',
      recipient: RECIPIENT,
      amount: '1',
      walletAddress: WALLET,
    })).rejects.toThrow(/only supported on PoD portal chains/i);
  });

  it('rejects unsupported private tokens', async () => {
    await expect(executePodPrivateTokenTransfer({
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.UNKNOWN',
      recipient: RECIPIENT,
      amount: '1',
      walletAddress: WALLET,
    })).rejects.toThrow(/not supported for send/i);
  });

  it('rejects sending to the same wallet', async () => {
    await expect(executePodPrivateTokenTransfer({
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      recipient: WALLET,
      amount: '1',
      walletAddress: WALLET,
    })).rejects.toThrow(/own address/i);
  });

  it('rejects a zero amount', async () => {
    await expect(executePodPrivateTokenTransfer({
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      recipient: RECIPIENT,
      amount: '0',
      walletAddress: WALLET,
    })).rejects.toThrow(/greater than zero/i);
  });

  it('rejects when no wallet provider is available', async () => {
    h.getEthereumProvider.mockReturnValue(null);
    await expect(executePodPrivateTokenTransfer({
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      recipient: RECIPIENT,
      amount: '1',
      walletAddress: WALLET,
    })).rejects.toThrow(/No wallet found/i);
  });

  it('submits a PoD transfer and captures the request id from logs', async () => {
    const result = await executePodPrivateTokenTransfer({
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      recipient: RECIPIENT,
      amount: '1',
      walletAddress: WALLET,
    });

    expect(result.txHash).toBe('0xabc');
    expect(result.request?.requestId).toBe('0xrid');
    expect(result.request?.status).toBe('source-mined');
    expect(h.assertPodPTokenReady).toHaveBeenCalled();
    expect(h.sendPodTransferMethod).toHaveBeenCalled();
  });

  it('throws when the transfer receipt fails', async () => {
    h.waitForTransactionResilient.mockResolvedValue({ status: 0, blockNumber: 1, logs: [] });
    await expect(executePodPrivateTokenTransfer({
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      recipient: RECIPIENT,
      amount: '1',
      walletAddress: WALLET,
    })).rejects.toMatchObject({ message: expect.stringMatching(/failed/i), txHash: '0xabc' });
  });

  it('quotes fees and substitutes the wallet when the recipient is not an address', async () => {
    await quotePodPrivateTokenTransferFees({
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.MTT',
      recipient: '',
      amount: '1',
      walletAddress: WALLET,
    });

    expect(h.quotePodTransferFees).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: WALLET,
        amountWei: ethers.parseUnits('1', 18),
      }),
    );
  });

  it('rejects fee quotes for unsupported tokens', async () => {
    await expect(quotePodPrivateTokenTransferFees({
      chainId: SEPOLIA_CHAIN_ID,
      symbol: 'p.UNKNOWN',
      recipient: RECIPIENT,
      amount: '1',
      walletAddress: WALLET,
    })).rejects.toThrow(/not supported for send/i);
  });
});
