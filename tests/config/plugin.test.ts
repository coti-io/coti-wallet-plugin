import { describe, it, expect, beforeEach } from 'vitest';
import { configureCotiPlugin, getPluginConfig, getSnapRequestParams } from '../../src/config/plugin';

describe('Plugin Configuration (README: Basic Setup)', () => {
  beforeEach(() => {
    // Reset to defaults
    configureCotiPlugin({
      snapId: 'npm:@coti-io/coti-snap',
      snapVersion: undefined,
      defaultNetworkId: undefined,
      clearSessionKeyOnWagmiDisconnect: false,
    });
  });

  it('returns default configuration when not configured', () => {
    const config = getPluginConfig();
    expect(config.snapId).toBe('npm:@coti-io/coti-snap');
    expect(config.defaultNetworkId).toBeUndefined();
  });

  it('allows overriding snapId', () => {
    configureCotiPlugin({ snapId: 'npm:@coti-io/coti-snap-custom' });
    const config = getPluginConfig();
    expect(config.snapId).toBe('npm:@coti-io/coti-snap-custom');
  });

  it('allows setting defaultNetworkId to COTI Mainnet', () => {
    configureCotiPlugin({ defaultNetworkId: '0x282b34' });
    const config = getPluginConfig();
    expect(config.defaultNetworkId).toBe('0x282b34');
  });

  it('allows setting defaultNetworkId to COTI Testnet', () => {
    configureCotiPlugin({ defaultNetworkId: '0x6c11a0' });
    const config = getPluginConfig();
    expect(config.defaultNetworkId).toBe('0x6c11a0');
  });

  it('preserves existing config when partially updating', () => {
    configureCotiPlugin({ snapId: 'custom-snap' });
    configureCotiPlugin({ defaultNetworkId: '0x282b34' });
    const config = getPluginConfig();
    expect(config.snapId).toBe('custom-snap');
    expect(config.defaultNetworkId).toBe('0x282b34');
  });

  it('returns a readonly config object', () => {
    const config = getPluginConfig();
    expect(config).toBeDefined();
    expect(typeof config.snapId).toBe('string');
  });

  it('defaults clearSessionKeyOnWagmiDisconnect to false', () => {
    expect(getPluginConfig().clearSessionKeyOnWagmiDisconnect).toBe(false);
  });

  it('allows enabling clearSessionKeyOnWagmiDisconnect', () => {
    configureCotiPlugin({ clearSessionKeyOnWagmiDisconnect: true });
    expect(getPluginConfig().clearSessionKeyOnWagmiDisconnect).toBe(true);
  });

  it('defaults snapVersion to undefined', () => {
    expect(getPluginConfig().snapVersion).toBeUndefined();
  });

  it('allows overriding snapVersion', () => {
    configureCotiPlugin({ snapVersion: '1.0.52' });
    expect(getPluginConfig().snapVersion).toBe('1.0.52');
  });

  it('builds wallet_requestSnaps params without version by default', () => {
    configureCotiPlugin({ snapId: 'npm:@coti-io/coti-snap', snapVersion: undefined });
    expect(getSnapRequestParams()).toEqual({ 'npm:@coti-io/coti-snap': {} });
  });

  it('builds wallet_requestSnaps params with a pinned version', () => {
    configureCotiPlugin({ snapVersion: '1.0.52' });
    expect(getSnapRequestParams('npm:@coti-io/coti-snap')).toEqual({
      'npm:@coti-io/coti-snap': { version: '1.0.52' },
    });
  });

  it('prefers an explicit snapVersion argument over config', () => {
    configureCotiPlugin({ snapVersion: '1.0.52' });
    expect(getSnapRequestParams('npm:@coti-io/coti-snap', '1.0.51')).toEqual({
      'npm:@coti-io/coti-snap': { version: '1.0.51' },
    });
  });
});
