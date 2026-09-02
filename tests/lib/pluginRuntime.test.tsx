import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import {
  createPluginRuntime,
  getPluginRuntime,
  installPluginRuntime,
  resetPluginRuntime,
  uninstallPluginRuntime,
} from '../../src/lib/pluginRuntime';
import {
  PluginRuntimeContext,
  useOptionalPluginRuntime,
  usePluginRuntimeLease,
} from '../../src/context/plugin/pluginRuntimeContext';
import {
  muteChainUpdates,
  unmuteChainUpdates,
  isChainUpdatesMuted,
} from '../../src/lib/chainMute';
import {
  markAesKeyValidatedForUnlock,
  getValidatedAesKeyForUnlock,
  clearAesKeyValidatedForUnlock,
} from '../../src/crypto/aesKeyValidation';
import { markPrimaryRateLimited, resolveRpcUrlsForChain } from '../../src/lib/rpcProvider';
import { AVALANCHE_FUJI_CHAIN_ID } from '../../src/chains/avalancheFuji';

afterEach(() => {
  resetPluginRuntime();
});

describe('PluginRuntime', () => {
  it('isolates mute, AES validation, snap cache, and RPC fallback across instances', () => {
    const a = createPluginRuntime();
    const b = createPluginRuntime();
    const key = 'a'.repeat(64);
    const fujiPrimary = resolveRpcUrlsForChain(AVALANCHE_FUJI_CHAIN_ID)[0];

    installPluginRuntime(a);
    muteChainUpdates();
    markAesKeyValidatedForUnlock('0xabc', key);
    a.setSnapAesKey('acct:1', 'snap-a');
    markPrimaryRateLimited(AVALANCHE_FUJI_CHAIN_ID);

    expect(isChainUpdatesMuted()).toBe(true);
    expect(getValidatedAesKeyForUnlock('0xABC')).toBeTruthy();
    expect(a.getSnapAesKey('acct:1')).toBe('snap-a');
    expect(resolveRpcUrlsForChain(AVALANCHE_FUJI_CHAIN_ID)[0]).not.toBe(fujiPrimary);

    installPluginRuntime(b);
    expect(isChainUpdatesMuted()).toBe(false);
    expect(getValidatedAesKeyForUnlock('0xABC')).toBeNull();
    expect(b.getSnapAesKey('acct:1')).toBeUndefined();
    expect(resolveRpcUrlsForChain(AVALANCHE_FUJI_CHAIN_ID)[0]).toBe(fujiPrimary);

    uninstallPluginRuntime(b);
    expect(isChainUpdatesMuted()).toBe(true);
    expect(getValidatedAesKeyForUnlock('0xabc')).toBeTruthy();
    expect(a.getSnapAesKey('acct:1')).toBe('snap-a');
    expect(resolveRpcUrlsForChain(AVALANCHE_FUJI_CHAIN_ID)[0]).not.toBe(fujiPrimary);
    a.deleteSnapAesKey('acct:1');
    expect(a.getSnapAesKey('acct:1')).toBeUndefined();

    uninstallPluginRuntime(a);
    clearAesKeyValidatedForUnlock();
    unmuteChainUpdates();
  });

  it('resetPluginRuntime clears the active lease', () => {
    muteChainUpdates();
    markAesKeyValidatedForUnlock('0xdef', 'b'.repeat(64));
    getPluginRuntime().setSnapAesKey('acct:2', 'snap-b');
    markPrimaryRateLimited(AVALANCHE_FUJI_CHAIN_ID);

    resetPluginRuntime();

    expect(isChainUpdatesMuted()).toBe(false);
    expect(getValidatedAesKeyForUnlock('0xdef')).toBeNull();
    expect(getPluginRuntime().getSnapAesKey('acct:2')).toBeUndefined();
  });

  it('ignores duplicate installs and unknown uninstalls, and replaces an emptied stack', () => {
    const runtime = getPluginRuntime();
    installPluginRuntime(runtime);
    expect(getPluginRuntime()).toBe(runtime);
    uninstallPluginRuntime(createPluginRuntime());
    expect(getPluginRuntime()).toBe(runtime);
    uninstallPluginRuntime(runtime);
    expect(getPluginRuntime()).not.toBe(runtime);
  });
});

describe('usePluginRuntimeLease', () => {
  it('installs a fresh runtime on mount and restores the previous one on unmount', () => {
    muteChainUpdates();
    expect(isChainUpdatesMuted()).toBe(true);

    function Probe() {
      usePluginRuntimeLease();
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(isChainUpdatesMuted()).toBe(false);

    muteChainUpdates();
    expect(isChainUpdatesMuted()).toBe(true);

    unmount();
    expect(isChainUpdatesMuted()).toBe(true);
  });

  it('useOptionalPluginRuntime prefers the React context over the active lease', () => {
    const contextRuntime = createPluginRuntime();
    let seen: ReturnType<typeof useOptionalPluginRuntime> | undefined;

    function Probe() {
      seen = useOptionalPluginRuntime();
      return null;
    }

    render(
      <PluginRuntimeContext.Provider value={contextRuntime}>
        <Probe />
      </PluginRuntimeContext.Provider>,
    );

    expect(seen).toBe(contextRuntime);
  });

  it('useOptionalPluginRuntime falls back to the active lease', () => {
    let seen: ReturnType<typeof useOptionalPluginRuntime> | undefined;

    function Probe() {
      seen = useOptionalPluginRuntime();
      return null;
    }

    render(<Probe />);
    expect(seen).toBe(getPluginRuntime());
  });
});
