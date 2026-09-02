import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  disconnect: vi.fn(),
}));

vi.mock('@wagmi/core', () => ({
  disconnect: (...args: unknown[]) => h.disconnect(...args),
}));

import { forceWagmiSessionClear } from '../../src/lib/wagmiDisconnect';

describe('forceWagmiSessionClear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disconnects and clears wagmi connection state', async () => {
    const setState = vi.fn();
    const storage = {
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const config = { storage, setState } as never;

    await forceWagmiSessionClear(config, { id: 'injected' } as never);

    expect(h.disconnect).toHaveBeenCalledWith(config);
    expect(storage.removeItem).toHaveBeenCalledWith('recentConnectorId');
    expect(setState).toHaveBeenCalled();
    const next = setState.mock.calls[0][0]({ connections: new Map([['x', 1]]), current: 'x' });
    expect(next).toMatchObject({ current: null, status: 'disconnected' });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('writes the disconnected shim when disconnect() fails', async () => {
    h.disconnect.mockRejectedValue(new Error('busy'));
    const storage = {
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockRejectedValue(new Error('no storage')),
    };
    const config = { storage, setState: vi.fn() } as never;

    await forceWagmiSessionClear(config, { id: 'walletConnect' } as never);

    expect(storage.setItem).toHaveBeenCalledWith('walletConnect.disconnected', true);
  });

  it('swallows a failed disconnected-shim write', async () => {
    h.disconnect.mockRejectedValue(new Error('busy'));
    const storage = {
      setItem: vi.fn().mockRejectedValue(new Error('quota')),
      removeItem: vi.fn(),
    };

    await expect(forceWagmiSessionClear(
      { storage, setState: vi.fn() } as never,
      { id: 'injected' } as never,
    )).resolves.toBeUndefined();
  });
});
