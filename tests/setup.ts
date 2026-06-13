import '@testing-library/jest-dom';
import { vi } from 'vitest';

vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'vitest-walletconnect-project-id');

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
