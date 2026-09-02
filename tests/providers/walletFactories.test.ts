import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const injectedConnector = {
  id: 'injected',
  connect: vi.fn(),
  disconnect: vi.fn(),
  getProvider: vi.fn(),
  getAccounts: vi.fn(),
  getChainId: vi.fn(),
};
const wcConnector = { id: 'walletConnect', connect: vi.fn() };

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({})),
  createConnector: (fn: (config: unknown) => unknown) => fn,
}));

vi.mock('wagmi/connectors', () => ({
  injected: () => () => injectedConnector,
  walletConnect: () => () => wcConnector,
}));

import { eip6963MetaMaskWallet } from '../../src/providers/eip6963MetaMaskWallet';
import { mobileMetaMaskWallet } from '../../src/providers/mobileMetaMaskWallet';
import { mobileRabbyWallet } from '../../src/providers/mobileRabbyWallet';
import { mobileOneKeyWallet } from '../../src/providers/mobileOneKeyWallet';
import { mobileZerionWallet } from '../../src/providers/mobileZerionWallet';
import { asInjectedTarget } from '../../src/providers/injectedTarget';

const setUserAgent = (ua: string) => {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true,
  });
};

describe('wallet factory coverage', () => {
  const originalUa = window.navigator.userAgent;

  afterEach(() => {
    setUserAgent(originalUa);
    (window as unknown as { ethereum?: unknown }).ethereum = {
      request: vi.fn(),
      isMetaMask: true,
    };
    delete (window as unknown as { $onekey?: unknown }).$onekey;
  });

  it('exposes asInjectedTarget as a typed passthrough', () => {
    const target = { id: 'x', name: 'X', provider: { request: vi.fn() } };
    expect(asInjectedTarget(target)).toBe(target);
  });

  it('builds an EIP-6963 MetaMask wallet connector', () => {
    const wallet = eip6963MetaMaskWallet();
    expect(wallet.id).toBe('io.metamask');
    const created = wallet.createConnector({ rkDetails: { id: 'io.metamask' } } as never)({} as never);
    expect(created).toMatchObject({ id: 'injected' });
  });

  it('uses WalletConnect on mobile MetaMask and injected on desktop', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    const mobile = mobileMetaMaskWallet({ projectId: 'pid' });
    expect(mobile.mobile?.getUri).toEqual(expect.any(Function));
    expect(mobile.createConnector({} as never)({} as never)).toMatchObject({ id: 'walletConnect' });

    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    (window as unknown as { ethereum: { isMetaMask: boolean } }).ethereum = { isMetaMask: true };
    const desktop = mobileMetaMaskWallet({ projectId: 'pid' });
    expect(desktop.installed).toBe(true);
    expect(desktop.createConnector({} as never)({} as never)).toMatchObject({ id: 'injected' });
  });

  it('uses WalletConnect for Rabby and OneKey when the extension is missing', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14)');
    const rabby = mobileRabbyWallet({ projectId: 'pid' });
    expect(rabby.mobile?.getUri?.('wc:abc')).toContain('rabby://wc?uri=');
    expect(rabby.createConnector({} as never)({} as never)).toMatchObject({ id: 'walletConnect' });

    const onekey = mobileOneKeyWallet({ projectId: 'pid' });
    expect(onekey.mobile?.getUri?.('wc:abc')).toContain('onekeywallet.app.link/wc');
    expect(onekey.createConnector({} as never)({} as never)).toMatchObject({ id: 'walletConnect' });
  });

  it('uses injected connectors when Rabby and OneKey are present on desktop', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    (window as unknown as { ethereum: { isRabby: boolean } }).ethereum = { isRabby: true };
    (window as unknown as { $onekey: unknown }).$onekey = { ethereum: {} };

    const rabby = mobileRabbyWallet({ projectId: 'pid' });
    expect(rabby.installed).toBe(true);
    expect(rabby.createConnector({} as never)({} as never)).toMatchObject({ id: 'injected' });

    const onekey = mobileOneKeyWallet({ projectId: 'pid' });
    expect(onekey.installed).toBe(true);
    expect(onekey.createConnector({} as never)({} as never)).toMatchObject({ id: 'injected' });
  });

  it('builds a Zerion wallet factory', () => {
    const wallet = mobileZerionWallet({ projectId: 'pid' });
    expect(wallet.id).toBe('zerion');
    expect(wallet.createConnector({} as never)({} as never)).toBeTruthy();
  });
});
