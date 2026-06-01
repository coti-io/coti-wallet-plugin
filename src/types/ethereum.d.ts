import type { EIP1193Provider } from '../lib/ethereum';

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
