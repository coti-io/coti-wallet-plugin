import { describe, it, expect, beforeEach } from 'vitest';
import {
  configureCotiPlugin,
  DEFAULT_GRANT_API_URL_TESTNET,
  DEFAULT_ONBOARDING_GRANT_MIN_BALANCE_WEI,
  getPluginConfig,
  getSnapRequestParams,
  isOnboardingGrantEnabled,
  isSnapEnabled,
  resolveGrantNativeCoti,
} from '../../src/config/plugin';
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID, SEPOLIA_CHAIN_ID } from '../../src/config/chains';

describe('Plugin Configuration (README: Basic Setup)', () => {
  beforeEach(() => {
    // Reset to defaults
    configureCotiPlugin({
      snapId: 'npm:@coti-io/coti-snap',
      snapVersion: undefined,
      snapEnabled: true,
      defaultNetworkId: undefined,
      aesKeyChainId: undefined,
      clearSessionKeyOnWagmiDisconnect: false,
      waitForBalanceRefreshAfterTransfer: false,
      onboardingGrantEnabled: true,
      grantApiUrlTestnet: DEFAULT_GRANT_API_URL_TESTNET,
      grantApiUrlMainnet: undefined,
      onboardingGrantMinBalanceWei: DEFAULT_ONBOARDING_GRANT_MIN_BALANCE_WEI,
      onboardingServices: { mode: 'disabled' },
    });
  });

  it('returns default configuration when not configured', () => {
    const config = getPluginConfig();
    expect(config.snapId).toBe('npm:@coti-io/coti-snap');
    expect(config.defaultNetworkId).toBeUndefined();
    expect(config.onboardingGrantEnabled).toBe(true);
    expect(config.grantApiUrlTestnet).toBe(DEFAULT_GRANT_API_URL_TESTNET);
    expect(config.onboardingGrantMinBalanceWei).toBe(DEFAULT_ONBOARDING_GRANT_MIN_BALANCE_WEI);
  });

  it('resolves a grant callback when enabled and no custom callback is set', () => {
    expect(isOnboardingGrantEnabled()).toBe(true);
    expect(resolveGrantNativeCoti()).toEqual(expect.any(Function));
  });

  it('disables grant resolution when onboardingGrantEnabled is false', () => {
    configureCotiPlugin({ onboardingGrantEnabled: false });
    expect(isOnboardingGrantEnabled()).toBe(false);
    expect(resolveGrantNativeCoti()).toBeUndefined();
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

  it('defaults waitForBalanceRefreshAfterTransfer to false', () => {
    expect(getPluginConfig().waitForBalanceRefreshAfterTransfer).toBe(false);
  });

  it('allows enabling waitForBalanceRefreshAfterTransfer', () => {
    configureCotiPlugin({ waitForBalanceRefreshAfterTransfer: true });
    expect(getPluginConfig().waitForBalanceRefreshAfterTransfer).toBe(true);
  });

  it('allows setting aesKeyChainId to COTI Testnet or Mainnet', () => {
    configureCotiPlugin({ aesKeyChainId: COTI_TESTNET_CHAIN_ID });
    expect(getPluginConfig().aesKeyChainId).toBe(COTI_TESTNET_CHAIN_ID);

    configureCotiPlugin({ aesKeyChainId: COTI_MAINNET_CHAIN_ID });
    expect(getPluginConfig().aesKeyChainId).toBe(COTI_MAINNET_CHAIN_ID);
  });

  it('throws when aesKeyChainId is not a COTI AES chain', () => {
    expect(() => configureCotiPlugin({ aesKeyChainId: SEPOLIA_CHAIN_ID as never })).toThrow(
      'Invalid aesKeyChainId',
    );
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

  it('defaults snapEnabled to true', () => {
    expect(getPluginConfig().snapEnabled).toBe(true);
    expect(isSnapEnabled()).toBe(true);
  });

  it('allows disabling snap entirely', () => {
    configureCotiPlugin({ snapEnabled: false });
    expect(getPluginConfig().snapEnabled).toBe(false);
    expect(isSnapEnabled()).toBe(false);
  });
});
