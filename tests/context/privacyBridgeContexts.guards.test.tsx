import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  usePrivacyBridgeContext,
  usePrivacyBridgeWallet,
  usePrivacyBridgeNetwork,
  usePrivacyBridgeUnlock,
  usePrivacyBridgeTokens,
  usePrivacyBridgeSwap,
  usePrivacyBridgePod,
  usePrivacyBridgeModals,
} from '../../src/context/privacyBridge';

const guardedHooks = [
  ['usePrivacyBridgeContext', usePrivacyBridgeContext],
  ['usePrivacyBridgeWallet', usePrivacyBridgeWallet],
  ['usePrivacyBridgeNetwork', usePrivacyBridgeNetwork],
  ['usePrivacyBridgeUnlock', usePrivacyBridgeUnlock],
  ['usePrivacyBridgeTokens', usePrivacyBridgeTokens],
  ['usePrivacyBridgeSwap', usePrivacyBridgeSwap],
  ['usePrivacyBridgePod', usePrivacyBridgePod],
  ['usePrivacyBridgeModals', usePrivacyBridgeModals],
] as const;

describe('privacyBridge context guards', () => {
  it.each(guardedHooks)('%s throws outside PrivacyBridgeProvider', (_name, hook) => {
    expect(() => renderHook(() => hook())).toThrow(/must be used within a PrivacyBridgeProvider/);
  });
});
