import '@testing-library/jest-dom';
import { webcrypto } from 'node:crypto';
import { vi } from 'vitest';

vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'vitest-walletconnect-project-id');

// jsdom's SubtleCrypto rejects some BufferSources that Node accepts; use Node's
// Web Crypto implementation for deterministic AES backup / HKDF tests.
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}
// Mock window.ethereum globally
const mockEthereum = {
  request: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  isMetaMask: true,
  providers: undefined,
};

Object.defineProperty(window, 'ethereum', {
  value: mockEthereum,
  writable: true,
  configurable: true,
});

// jsdom runs on an opaque origin (about:blank), which disables a usable
// localStorage. Provide a simple in-memory implementation so modules that
// persist to localStorage can be tested deterministically.
const createLocalStorageMock = (): Storage => {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      store = {};
    },
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  } as Storage;
};

const localStorageMock = createLocalStorageMock();
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// Mock console methods to reduce noise in tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// Default wagmi hooks for unit tests that render hooks using useAccount (e.g. useSnap).
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: undefined,
    isConnected: false,
    chainId: undefined,
    connector: undefined,
  })),
  useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
  useConnectorClient: vi.fn(() => ({ data: undefined })),
  useSwitchChain: vi.fn(() => ({ switchChain: vi.fn(), switchChainAsync: vi.fn() })),
  useConfig: vi.fn(() => ({})),
  WagmiProvider: ({ children }: { children: unknown }) => children,
}));
