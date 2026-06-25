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

let eip6963MetaMaskProvider: EIP1193Provider | null = null;
let eip6963ListenerRegistered = false;

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

function findMetaMaskInProviders(providers: EIP1193Provider[]): EIP1193Provider | undefined {
  return providers.find(
    (p) =>
      p.isMetaMask &&
      !p.isRabby &&
      !p.isPhantom &&
      !p.isTrust,
  );
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

    return eth;
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
