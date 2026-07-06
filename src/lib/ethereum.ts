/**
 * Typed EIP-1193 provider interface for window.ethereum access.
 * Eliminates `as any` casts throughout the codebase.
 */

export interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<any>;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isPhantom?: boolean;
  isTrust?: boolean;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
  providers?: EIP1193Provider[];
}

export interface InjectedWalletTarget {
  id: string;
  name: string;
  provider: EIP1193Provider;
}

const METAMASK_MISSING_PROVIDER: EIP1193Provider = {
  request() {
    return Promise.reject(
      Object.assign(new Error('MetaMask extension not found via EIP-6963'), { code: 4900 }),
    );
  },
};

let eip6963MetaMaskProvider: EIP1193Provider | null = null;
let eip6963RabbyProvider: EIP1193Provider | null = null;
let eip6963TrustProvider: EIP1193Provider | null = null;
let eip6963ListenerRegistered = false;

const RABBY_MISSING_PROVIDER: EIP1193Provider = {
  request() {
    return Promise.reject(
      Object.assign(new Error('Rabby extension not found via EIP-6963'), { code: 4900 }),
    );
  },
};

const TRUST_MISSING_PROVIDER: EIP1193Provider = {
  request() {
    return Promise.reject(
      Object.assign(new Error('Trust Wallet extension not found via EIP-6963'), { code: 4900 }),
    );
  },
};

function registerEip6963Discovery(): void {
  if (typeof window === 'undefined' || eip6963ListenerRegistered) {
    return;
  }
  eip6963ListenerRegistered = true;

  window.addEventListener('eip6963:announceProvider', ((event: CustomEvent) => {
    const info = event?.detail?.info;
    const provider = event?.detail?.provider;
    if (info?.rdns === 'io.metamask' || info?.rdns === 'io.metamask.flask') {
      eip6963MetaMaskProvider = provider;
    }
    if (info?.rdns === 'io.rabby') {
      eip6963RabbyProvider = provider;
    }
    if (info?.rdns === 'com.trustwallet.app') {
      eip6963TrustProvider = provider;
    }
  }) as EventListener);

  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

registerEip6963Discovery();

/**
 * Returns the EIP-6963 discovered MetaMask provider when available.
 */
export function getEip6963MetaMaskProvider(): EIP1193Provider | null {
  registerEip6963Discovery();
  return eip6963MetaMaskProvider;
}

export function getEip6963RabbyProvider(): EIP1193Provider | null {
  registerEip6963Discovery();
  return eip6963RabbyProvider;
}

export function getEip6963TrustProvider(): EIP1193Provider | null {
  registerEip6963Discovery();
  return eip6963TrustProvider;
}

/** True when the Trust browser extension is available (EIP-6963 or window.trustwallet). */
export function isTrustWalletInstalled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if ((window as unknown as { trustwallet?: EIP1193Provider }).trustwallet) {
    return true;
  }
  requestEip6963Providers();
  return !!getEip6963TrustProvider();
}

function findMetaMaskInProviders(providers: EIP1193Provider[]): EIP1193Provider | undefined {
  return providers.find(
    (p) =>
      p.isMetaMask &&
      !p.isRabby &&
      !p.isPhantom &&
      !p.isTrust,
  );
}

/** Ask installed extensions to re-announce via EIP-6963 (safe to call repeatedly). */
export function requestEip6963Providers(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  }
}

/**
 * Resolves the MetaMask injected target for wagmi/RainbowKit.
 * Never returns undefined — wagmi's injected() connector falls back to
 * window.ethereum (often Rabby) when target() is undefined.
 */
export function resolveMetaMaskInjectedTarget(): InjectedWalletTarget {
  requestEip6963Providers();

  const eip6963 = getEip6963MetaMaskProvider();
  if (eip6963) {
    return { id: 'io.metamask', name: 'MetaMask', provider: eip6963 };
  }

  try {
    const eth = getEthereumProvider();
    if (eth?.providers?.length) {
      const mm = findMetaMaskInProviders(eth.providers);
      if (mm) {
        return { id: 'io.metamask', name: 'MetaMask', provider: mm };
      }
    }
  } catch {
    /* window.ethereum may throw when extensions fight over the global */
  }

  return {
    id: 'io.metamask',
    name: 'MetaMask',
    provider: METAMASK_MISSING_PROVIDER,
  };
}

/**
 * Resolves the Rabby injected target for wagmi/RainbowKit.
 * Never returns undefined — avoids wagmi falling back to a generic injected provider.
 */
export function resolveRabbyInjectedTarget(): InjectedWalletTarget {
  requestEip6963Providers();

  const eip6963 = getEip6963RabbyProvider();
  if (eip6963) {
    return { id: 'rabby', name: 'Rabby Wallet', provider: eip6963 };
  }

  try {
    const eth = getEthereumProvider();
    if (eth?.isRabby) {
      return { id: 'rabby', name: 'Rabby Wallet', provider: eth };
    }
  } catch {
    /* window.ethereum may throw when extensions fight over the global */
  }

  return {
    id: 'rabby',
    name: 'Rabby Wallet',
    provider: RABBY_MISSING_PROVIDER,
  };
}

/**
 * Resolves the Trust Wallet injected target for wagmi/RainbowKit.
 * Never returns undefined — wagmi's injected() connector falls back to
 * window.ethereum (often Rabby/MetaMask) when target() is undefined.
 */
export function resolveTrustInjectedTarget(): InjectedWalletTarget {
  requestEip6963Providers();

  const eip6963 = getEip6963TrustProvider();
  if (eip6963) {
    return { id: 'com.trustwallet.app', name: 'Trust Wallet', provider: eip6963 };
  }

  try {
    const trust = (window as unknown as { trustwallet?: EIP1193Provider }).trustwallet;
    if (trust) {
      return { id: 'trust-extension', name: 'Trust Wallet', provider: trust };
    }
  } catch {
    /* extension globals may throw when multiple wallets are installed */
  }

  return {
    id: 'com.trustwallet.app',
    name: 'Trust Wallet',
    provider: TRUST_MISSING_PROVIDER,
  };
}

/**
 * Resolves the MetaMask inpage provider, preferring EIP-6963 over window.ethereum.
 * Use for Snap RPCs when multiple wallet extensions may hijack window.ethereum.
 */
export function getMetaMaskProvider(): EIP1193Provider | null {
  const eip6963 = getEip6963MetaMaskProvider();
  if (eip6963) {
    return eip6963;
  }

  try {
    if (typeof window === 'undefined' || !window.ethereum) {
      return null;
    }

    const eth = window.ethereum as unknown as EIP1193Provider;
    if (eth.providers?.length) {
      const mm = findMetaMaskInProviders(eth.providers);
      if (mm) {
        return mm;
      }
    }

    if (eth.isMetaMask && !eth.isRabby && !eth.isPhantom && !eth.isTrust) {
      return eth;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the typed EIP-1193 provider from `window.ethereum`, or null if unavailable.
 * Use this instead of `window.ethereum as any` throughout the codebase.
 * Handles the case where window.ethereum access may throw due to property
 * redefinition conflicts between wallet extensions.
 */
export function getEthereumProvider(): EIP1193Provider | null {
  try {
    if (typeof window === 'undefined' || !window.ethereum) {
      return null;
    }
    return window.ethereum as unknown as EIP1193Provider;
  } catch {
    return null;
  }
}
