import '@testing-library/jest-dom';
import { vi } from 'vitest';

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

// Mock console methods to reduce noise in tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
