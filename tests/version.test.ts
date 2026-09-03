import { describe, it, expect, afterEach, vi } from 'vitest';
import pkg from '../package.json';
import {
  PLUGIN_VERSION,
  announcePluginVersion,
  resetPluginVersionAnnouncement,
} from '../src/version';

describe('PLUGIN_VERSION', () => {
  afterEach(() => {
    resetPluginVersionAnnouncement();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('matches package.json', () => {
    expect(PLUGIN_VERSION).toBe(pkg.version);
  });

  it('does not print during tests', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    resetPluginVersionAnnouncement();
    expect(announcePluginVersion()).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });

  it('prints the version once in a browser app', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'development');
    resetPluginVersionAnnouncement();

    expect(announcePluginVersion()).toBe(true);
    expect(info).toHaveBeenCalledWith(
      `[@coti-io/coti-wallet-plugin@${PLUGIN_VERSION}] loaded`,
    );
    expect(announcePluginVersion()).toBe(false);
    expect(info).toHaveBeenCalledTimes(1);
  });
});
