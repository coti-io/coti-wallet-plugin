import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { configureCotiPlugin } from '../../src/config/plugin';

const mockSwitchChain = vi.fn();
 
let mockAccountChain: any = undefined;
let mockWalletType = 'unknown';
let mockIsMetaMaskWithSnap = false;

vi.mock('wagmi', () => ({
  useSwitchChain: () => ({ switchChain: mockSwitchChain }),
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

describe('useNetworkEnforcer branch coverage', () => {
  const mockSwitchNetwork = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    mockSwitchNetwork.mockResolvedValue(true);
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

  it('falls back to COTI Mainnet when defaultNetworkId is not a supported chain', async () => {
    configureCotiPlugin({ defaultNetworkId: '999' });
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer('11155111', mockSwitchNetwork));

    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).toHaveBeenCalledWith('0x' + COTI_MAINNET.toString(16));
  });

  it('resolves Sepolia from defaultNetworkId when configured for PoD', async () => {
    configureCotiPlugin({ defaultNetworkId: '11155111' });
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer('2632500', mockSwitchNetwork));

    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).toHaveBeenCalledWith('0xaa36a7');
  });

  // ─── isWrongNetwork edge paths ──────────────────────────────────────────

  it('returns false for MetaMask when chainId is null', () => {
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    expect(result.current.isWrongNetwork).toBe(false);
  });

  it('returns false for MetaMask when chainId parsing throws (malformed input)', () => {
    mockWalletType = 'metamask';
    // A non-string chainId makes `.startsWith` throw → defensive catch returns false.
     
    const { result } = renderHook(() => useNetworkEnforcer(123 as any, mockSwitchNetwork));
    expect(result.current.isWrongNetwork).toBe(false);
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
    // default target is COTI Mainnet; chainId equals it → no switch
    mockWalletType = 'metamask';
    const { result } = renderHook(() => useNetworkEnforcer('2632500', mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchNetwork).not.toHaveBeenCalled();
  });

  it('returns early for a non-MetaMask wallet with no connected chain', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = undefined;
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchChain).not.toHaveBeenCalled();
  });

  it('does nothing for a non-MetaMask wallet already on a COTI chain', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 7082400 };
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(mockSwitchChain).not.toHaveBeenCalled();
  });

  it('sets a warning when wagmi switchChain throws', async () => {
    mockWalletType = 'rabby';
    mockAccountChain = { id: 999 };
    mockSwitchChain.mockImplementation(() => {
      throw new Error('user rejected');
    });
    const { result } = renderHook(() => useNetworkEnforcer(null, mockSwitchNetwork));
    await act(async () => { await result.current.enforceNetwork(); });
    expect(result.current.networkMismatchWarning).toContain('rejected');
  });
});
