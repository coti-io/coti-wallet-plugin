import { describe, it, expect, afterEach, vi } from 'vitest';
import { configureCotiPlugin } from '../../src/config/plugin';
import { resolveWalletConnectProjectId } from '../../src/config/walletConnect';
import { CotiErrorCode, CotiPluginError, hasCotiErrorCode } from '../../src/errors';

/** Mirrors tsup CJS output: `var import_meta = {}` with no `.env`. */
function readWalletConnectEnvLikeCjs(importMeta: { env?: { VITE_WALLETCONNECT_PROJECT_ID?: string } }) {
  return importMeta.env?.VITE_WALLETCONNECT_PROJECT_ID?.trim();
}

describe('resolveWalletConnectProjectId', () => {
  afterEach(() => {
    configureCotiPlugin({ walletConnectProjectId: undefined });
    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'vitest-walletconnect-project-id');
  });

  it('prefers prop over plugin config and env (WC-03)', () => {
    configureCotiPlugin({ walletConnectProjectId: 'from-plugin' });
    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'from-env');
    expect(resolveWalletConnectProjectId('  from-prop  ')).toBe('from-prop');
  });

  it('resolves from plugin config when prop is omitted (WC-01)', () => {
    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', '');
    configureCotiPlugin({ walletConnectProjectId: 'plugin-id' });
    expect(resolveWalletConnectProjectId()).toBe('plugin-id');
  });

  it('resolves from Vite env when prop and plugin are unset (WC-02)', () => {
    configureCotiPlugin({ walletConnectProjectId: undefined });
    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'env-id');
    expect(resolveWalletConnectProjectId()).toBe('env-id');
  });

  it('env access pattern does not throw when import.meta.env is missing (CJS-safe)', () => {
    expect(() => readWalletConnectEnvLikeCjs({})).not.toThrow();
    expect(readWalletConnectEnvLikeCjs({})).toBeUndefined();
  });

  it('throws CotiPluginError (not TypeError) when no project ID is configured', () => {
    configureCotiPlugin({ walletConnectProjectId: undefined });
    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', '');

    expect(() => resolveWalletConnectProjectId()).toThrow(CotiPluginError);
    try {
      resolveWalletConnectProjectId();
    } catch (error) {
      expect(error).not.toBeInstanceOf(TypeError);
      expect(hasCotiErrorCode(error, CotiErrorCode.WALLETCONNECT_PROJECT_ID_MISSING)).toBe(true);
    }

    vi.stubEnv('VITE_WALLETCONNECT_PROJECT_ID', 'vitest-walletconnect-project-id');
  });
});
