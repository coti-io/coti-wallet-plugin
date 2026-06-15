import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  muteChainUpdates,
  unmuteChainUpdates,
  isChainUpdatesMuted,
} from '../../src/lib/chainMute';
import type { WalletTypeInfo } from '../../src/hooks/useWalletType';

const COTI_TESTNET = 7082400;
const SEPOLIA = 11155111;
const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const VALID_KEY = 'a'.repeat(64);

// ─── Mocks ──────────────────────────────────────────────────────────────────

const snapState = vi.hoisted(() => ({
  getAESKeyFromSnap: vi.fn(),
}));
vi.mock('../../src/hooks/useSnap', () => ({
  useSnap: () => ({ getAESKeyFromSnap: snapState.getAESKeyFromSnap }),
}));

const wagmiState = vi.hoisted(() => ({
  connector: undefined as any,
  chainId: undefined as number | undefined,
  connectorClient: undefined as any,
}));
vi.mock('wagmi', () => ({
  useAccount: () => ({ connector: wagmiState.connector, chainId: wagmiState.chainId }),
  useConnectorClient: () => ({ data: wagmiState.connectorClient }),
}));

const ethersState = vi.hoisted(() => ({
  getSigner: vi.fn(),
}));
vi.mock('@coti-io/coti-ethers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class BrowserProvider {
    constructor(_p: unknown) {}
    getSigner = ethersState.getSigner;
  }
  return { ...actual, BrowserProvider };
});

import { useAesKeyProvider } from '../../src/hooks/useAesKeyProvider';

function walletInfo(overrides: Partial<WalletTypeInfo> = {}): WalletTypeInfo {
  return {
    isMetaMaskWithSnap: false,
    walletType: 'unknown',
    connectorId: undefined,
    ...overrides,
  };
}

function makeSigner(aesKey: string | null) {
  return {
    generateOrRecoverAes: vi.fn().mockResolvedValue(undefined),
    getUserOnboardInfo: vi.fn().mockReturnValue({ aesKey }),
  };
}

describe('useAesKeyProvider — unmute delay is approximately 500ms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unmuteChainUpdates();
    wagmiState.connector = undefined;
    wagmiState.chainId = undefined;
    ethersState.getSigner.mockResolvedValue(makeSigner(VALID_KEY));
  });

  afterEach(() => {
    unmuteChainUpdates();
  });

  it('unmutes chain updates after approximately 500ms (not 1500ms) when switching chains', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    wagmiState.connector = { getProvider: vi.fn().mockResolvedValue({ request }) };
    wagmiState.chainId = SEPOLIA; // Non-COTI chain → triggers mute + chain switch

    const { result } = renderHook(() => useAesKeyProvider(walletInfo({ walletType: 'rabby' })));

    const start = Date.now();
    await act(async () => {
      await result.current.getAesKey(ADDR);
    });
    const elapsed = Date.now() - start;

    // The unmute delay should be ~500ms.
    // Allow a generous window for CI jitter but assert it's NOT the old 1500ms.
    expect(isChainUpdatesMuted()).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(400); // at least ~500ms (allowing some timing variance)
    expect(elapsed).toBeLessThan(1200); // well under the old 1500ms delay
  });
});
