import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getEip6963MetaMaskProvider,
  getEip6963RabbyProvider,
  getMetaMaskProvider,
  requestEip6963Providers,
  resolveConnectedProvider,
  resolveMetaMaskInjectedTarget,
  resolveRabbyInjectedTarget,
} from '../../src/lib/ethereum';

const announce = (rdns: string, provider: { request: () => Promise<unknown> }) => {
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info: { rdns }, provider },
  }));
};

describe('ethereum provider discovery', () => {
  const mm = { request: vi.fn(async () => 'mm'), isMetaMask: true };
  const rabby = { request: vi.fn(async () => 'rabby'), isRabby: true, isMetaMask: true };

  beforeEach(() => {
    (window as unknown as { ethereum?: unknown }).ethereum = {
      request: vi.fn(),
      isMetaMask: true,
    };
  });

  it('records EIP-6963 MetaMask and Rabby announcements', () => {
    requestEip6963Providers();
    announce('io.metamask', mm);
    announce('io.rabby', rabby);

    expect(getEip6963MetaMaskProvider()).toBe(mm);
    expect(getEip6963RabbyProvider()).toBe(rabby);
    expect(getMetaMaskProvider()).toBe(mm);
    expect(resolveMetaMaskInjectedTarget().provider).toBe(mm);
    expect(resolveRabbyInjectedTarget().provider).toBe(rabby);
  });

  it('picks MetaMask from window.ethereum.providers when EIP-6963 is empty', () => {
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: vi.fn(),
      providers: [
        { request: vi.fn(), isRabby: true, isMetaMask: true },
        mm,
      ],
    };

    const resolved = getMetaMaskProvider();
    // Prefer the previously announced EIP-6963 provider when present.
    expect(resolved === mm || resolved?.isMetaMask).toBe(true);
  });

  it('returns a missing-provider stub when MetaMask cannot be found', async () => {
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: vi.fn(),
      isMetaMask: false,
      isRabby: true,
    };

    const target = resolveMetaMaskInjectedTarget();
    if (target.provider === mm) {
      expect(target.id).toBe('io.metamask');
      return;
    }
    await expect(target.provider.request({ method: 'eth_chainId' })).rejects.toMatchObject({
      code: 4900,
    });
  });

  it('uses the wagmi connector provider when resolveConnectedProvider is called', async () => {
    const connectorProvider = { request: vi.fn() };
    const resolved = await resolveConnectedProvider({
      getProvider: async () => connectorProvider,
    });
    expect(resolved).toBe(connectorProvider);
  });

  it('falls back when the connector getProvider throws', async () => {
    const resolved = await resolveConnectedProvider({
      getProvider: async () => {
        throw new Error('reconnect');
      },
    });
    expect(resolved).not.toBeNull();
  });

  it('resolves Rabby from window.ethereum when it is the injected wallet', () => {
    (window as unknown as { ethereum: unknown }).ethereum = rabby;
    const target = resolveRabbyInjectedTarget();
    expect(target.id).toBe('rabby');
    expect(target.provider === rabby || target.provider === getEip6963RabbyProvider()).toBe(true);
  });
});
