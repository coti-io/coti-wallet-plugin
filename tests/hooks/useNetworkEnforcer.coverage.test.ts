import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { configureCotiPlugin } from '../../src/config/plugin';

const mockSwitchChainAsync = vi.fn().mockResolvedValue(undefined);
 
let mockAccountChain: any = undefined;
let mockWalletType = 'unknown';
let mockIsMetaMaskWithSnap = false;

vi.mock('wagmi', () => ({
  useSwitchChain: () => ({ switchChainAsync: mockSwitchChainAsync }),
  useAccount: () => ({ chain: mockAccountChain, connector: undefined }),
}));

vi.mock('../../src/hooks/useWalletType', () => ({
  useWalletType: () => ({
    walletType: mockWalletType,
    isMetaMaskWithSnap: mockIsMetaMaskWithSnap,
    connectorId: undefined,
  }),
}));

import { useNetworkEnforcer } from '../../src/hooks/useNetworkEnforcer';

const COTI_MAINNET = 2632500;
const COTI_TESTNET = 7082400;

describe('useNetworkEnforcer branch coverage', () => {
  const mockSwitchNetwork = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    mockSwitchNetwork.mockResolvedValue(true);
    mockSwitchChainAsync.mockResolvedValue(undefined);
    mockAccountChain = undefined;
    mockWalletType = 'unknown';
    mockIsMetaMaskWithSnap = false;
  });

  afterEach(() => {
    configureCotiPlugin({ defaultNetworkId: undefined });
  });

  // ─── getTargetChainId (only invoked from enforceNetwork) ────────────────

  it('resolves the target from a hex defaultNetworkId', async () => {
    configureCotiPlugin({ defaultNetworkId: '0x282b34' }); // 2632500
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer('11155111', mockSwitchNetwork));

    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).toHaveBeenCalledWith('0x282b34');
  });

  it('resolves the target from a decimal defaultNetworkId', async () => {
    configureCotiPlugin({ defaultNetworkId: '7082400' });
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer('11155111', mockSwitchNetwork));

    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).toHaveBeenCalledWith('0x6c11a0');
  });

  it('falls back to COTI Testnet when defaultNetworkId is not a supported chain', async () => {
    configureCotiPlugin({ defaultNetworkId: '999' });
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer('11155111', mockSwitchNetwork));

    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).toHaveBeenCalledWith('0x' + COTI_TESTNET.toString(16));
  });

  it('resolves Sepolia from defaultNetworkId when configured for PoD', async () => {
    configureCotiPlugin({ defaultNetworkId: '11155111' });
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer('2632500', mockSwitchNetwork));

    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).toHaveBeenCalledWith('0xaa36a7');
  });

  // ─── isUnsupportedNetwork / isOffTargetNetwork edge paths ────────────────

  it('returns false for both flags when MetaMask chainId is null', () => {
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(false);
    expect(result.current.isOffTargetNetwork).toBe(false);
  });

  it('returns false for both flags when MetaMask chainId parsing throws (malformed input)', () => {
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer(123 as any, mockSwitchNetwork));
    expect(result.current.isUnsupportedNetwork).toBe(false);
    expect(result.current.isOffTargetNetwork).toBe(false);
  });

  // ─── enforceNetwork edge paths ──────────────────────────────────────────

  it('returns early for MetaMask when chainId is null', async () => {
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).not.toHaveBeenCalled();
  });

  it('uses the hex chainId fallback when BigInt parsing throws on a hex-prefixed value', async () => {
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer('0xZZ', mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    // currentChainIdHex resolves to the original '0xZZ' string → mismatch → switch
    expect(mockSwitchNetwork).toHaveBeenCalled();
  });

  it('uses the Number() fallback when BigInt parsing throws on a non-hex value', async () => {
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer('zzz', mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).toHaveBeenCalled();
  });

  it('does nothing for MetaMask already on the target chain', async () => {
    // default target is COTI Testnet; chainId equals it → no switch
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer('7082400', mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).not.toHaveBeenCalled();
  });

  it('returns early for a non-MetaMask wallet with no connected chain', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = undefined;
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
  });

  it('does nothing for a non-MetaMask wallet already on the default testnet target', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: COTI_TESTNET };
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
  });

  it('switches a non-MetaMask wallet from mainnet to the default testnet target', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: COTI_MAINNET };
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).toHaveBeenCalledWith('0x' + COTI_TESTNET.toString(16));
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
  });

  it('switches a non-MetaMask wallet from Sepolia when PoD target is configured', async () => {
    configureCotiPlugin({ defaultNetworkId: '11155111' });
    mockWalletType = 'rabby';
    mockAccountChain = { id: 2632500 };
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).toHaveBeenCalledWith('0xaa36a7');
    expect(mockSwitchChainAsync).not.toHaveBeenCalled();
  });

  it('sets a warning when switchNetwork rejects', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 999 };
    mockSwitchNetwork.mockRejectedValue(new Error('user rejected'));
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(result.current.networkMismatchWarning).toContain('rejected');
  });
});
