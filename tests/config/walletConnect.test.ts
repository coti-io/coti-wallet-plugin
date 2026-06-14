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
