/**
 * Typed EIP-1193 provider interface for window.ethereum access.
 * Eliminates `as any` casts throughout the codebase.
 */

export interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<any>;
  isMetaMask?: boolean;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
  providers?: EIP1193Provider[];
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
    // window.ethereum access can throw if the property descriptor is in a broken state
    return null;
  }
}
