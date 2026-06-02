import { vi } from 'vitest';
import React from 'react';

export const RainbowKitProvider = ({ children }: { children: React.ReactNode }) => children;
export const useConnectModal = vi.fn(() => ({ openConnectModal: vi.fn() }));
export const connectorsForWallets = vi.fn(() => []);
