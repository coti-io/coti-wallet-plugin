import { describe, it, expect, beforeEach } from 'vitest';
import { configureCotiPlugin, getPluginConfig } from '../../src/config/plugin';

describe('Plugin Configuration (README: Basic Setup)', () => {
  beforeEach(() => {
    // Reset to defaults
    configureCotiPlugin({
      snapId: 'npm:@coti-io/coti-snap',
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
});
