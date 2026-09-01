import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useCotiPluginContext,
  useCotiWallet,
  useCotiNetwork,
  useCotiUnlock,
  useCotiTokens,
  useCotiSwap,
  useCotiPod,
  useCotiModals,
} from '../../src/context/plugin';

const guardedHooks = [
  ['useCotiPluginContext', useCotiPluginContext],
  ['useCotiWallet', useCotiWallet],
  ['useCotiNetwork', useCotiNetwork],
  ['useCotiUnlock', useCotiUnlock],
  ['useCotiTokens', useCotiTokens],
  ['useCotiSwap', useCotiSwap],
  ['useCotiPod', useCotiPod],
  ['useCotiModals', useCotiModals],
] as const;

describe('coti plugin context guards', () => {
  it.each(guardedHooks)('%s throws outside CotiPluginProvider', (_name, hook) => {
    expect(() => renderHook(() => hook())).toThrow(/must be used within a CotiPluginProvider/);
  });
});
