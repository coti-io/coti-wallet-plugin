import { describe, it, expect, vi, afterEach } from 'vitest';

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
  injected: (opts?: { target?: unknown }) => () => {
    if (typeof opts?.target === 'function') {
      (opts.target as () => unknown)();
    }
    return injectedConnector;
  },
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
  const originalPlatform = window.navigator.platform;
  const originalMaxTouch = window.navigator.maxTouchPoints;

  afterEach(() => {
    setUserAgent(originalUa);
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: originalMaxTouch,
    });
    (window as unknown as { ethereum?: unknown }).ethereum = {
      request: vi.fn(),
      isMetaMask: true,
    };
    delete (window as unknown as { $onekey?: unknown }).$onekey;
    delete (window as unknown as { zerionWallet?: unknown }).zerionWallet;
    wcConnector.connect = vi.fn();
    injectedConnector.disconnect = vi.fn();
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

  it('uses WalletConnect for Zerion on mobile and injected when window.zerionWallet is present', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    const mobile = mobileZerionWallet({ projectId: 'pid' });
    expect(mobile.mobile?.getUri?.('wc:abc')).toContain('zerion://wc?uri=');
    expect(mobile.createConnector({} as never)({} as never)).toMatchObject({ id: 'walletConnect' });

    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    (window as unknown as { zerionWallet: { request: () => Promise<string> } }).zerionWallet = {
      request: async () => '0x1',
    };
    const desktop = mobileZerionWallet({ projectId: 'pid' });
    expect(desktop.installed).toBe(true);
    expect(desktop.createConnector({} as never)({} as never)).toMatchObject({ id: 'injected' });
    delete (window as unknown as { zerionWallet?: unknown }).zerionWallet;
  });

  it('dispatches a connect-failure event for non-cancellation Zerion WalletConnect errors', async () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14)');
    wcConnector.connect = vi.fn(async () => {
      throw new Error('Zerion rejected the session');
    });
    const failures: unknown[] = [];
    const onFailure = (event: Event) => failures.push((event as CustomEvent).detail);
    window.addEventListener('coti-wallet-plugin:wallet-connect-failure', onFailure);

    const wallet = mobileZerionWallet({ projectId: 'pid' });
    const connector = wallet.createConnector({} as never)({} as never) as { connect: (args?: object) => Promise<unknown> };
    await expect(connector.connect({})).rejects.toThrow('Zerion rejected the session');
    expect(failures).toEqual([{ walletId: 'zerion', message: 'Zerion rejected the session' }]);

    wcConnector.connect = vi.fn(async () => {
      throw new Error('User rejected the request');
    });
    await expect(connector.connect({})).rejects.toThrow('User rejected');
    expect(failures).toHaveLength(1);
    window.removeEventListener('coti-wallet-plugin:wallet-connect-failure', onFailure);
  });

  it('swallows unsupported revokePermissions errors on Zerion injected disconnect', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    (window as unknown as { zerionWallet: { request: () => Promise<string> } }).zerionWallet = {
      request: async () => '0x1',
    };
    injectedConnector.disconnect = vi.fn(async () => {
      throw { code: -32601, message: 'the method wallet_revokePermissions does not exist/is not available' };
    });

    const wallet = mobileZerionWallet({ projectId: 'pid' });
    const connector = wallet.createConnector({} as never)({} as never) as { disconnect: () => Promise<void> };
    await expect(connector.disconnect()).resolves.toBeUndefined();
    delete (window as unknown as { zerionWallet?: unknown }).zerionWallet;
  });

  it('uses injected MetaMask inside the MetaMask in-app browser', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) MetaMaskMobile');
    (window as unknown as { ethereum: { isMetaMask: boolean } }).ethereum = { isMetaMask: true };
    const wallet = mobileMetaMaskWallet({ projectId: 'pid' });
    expect(wallet.createConnector({} as never)({} as never)).toMatchObject({ id: 'injected' });
  });

  it('picks MetaMask from window.ethereum.providers when creating the injected connector', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const mm = { isMetaMask: true, request: vi.fn() };
    (window as unknown as { ethereum: { providers: unknown[] } }).ethereum = {
      providers: [{ isRabby: true, isMetaMask: true }, mm],
    };
    const wallet = mobileMetaMaskWallet({ projectId: 'pid' });
    const created = wallet.createConnector({} as never)({} as never);
    expect(created).toMatchObject({ id: 'injected' });
  });

  it('treats iPad desktop-class browsers as mobile Zerion and leaves Android URIs unprefixed', () => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: 5,
    });
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const ipad = mobileZerionWallet({ projectId: 'pid' });
    expect(ipad.mobile?.getUri?.('wc:abc')).toContain('zerion://wc?uri=');

    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux armv8l',
    });
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: 1,
    });
    setUserAgent('Mozilla/5.0 (Linux; Android 14)');
    const android = mobileZerionWallet({ projectId: 'pid' });
    expect(android.mobile?.getUri?.('wc:abc')).toBe('wc:abc');
  });

  it('rethrows non-unsupported Zerion injected disconnect errors', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    (window as unknown as { zerionWallet: { request: () => Promise<string> } }).zerionWallet = {
      request: async () => '0x1',
    };
    injectedConnector.disconnect = vi.fn(async () => {
      throw new Error('network down');
    });
    const wallet = mobileZerionWallet({ projectId: 'pid' });
    const connector = wallet.createConnector({} as never)({} as never) as { disconnect: () => Promise<void> };
    await expect(connector.disconnect()).rejects.toThrow('network down');
    delete (window as unknown as { zerionWallet?: unknown }).zerionWallet;
  });
});
