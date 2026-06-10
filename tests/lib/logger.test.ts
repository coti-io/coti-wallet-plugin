import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger, setDebugLogging } from '../../src/lib/logger';
import { configureCotiPlugin, getPluginConfig } from '../../src/config/plugin';

describe('logger', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;

  beforeEach(() => {
    methods.forEach((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    setDebugLogging(false);
  });

  afterEach(() => {
    setDebugLogging(false);
    vi.restoreAllMocks();
  });

  it('is silent by default', () => {
    methods.forEach((m) => {
      logger[m]('should not appear');
      expect(console[m]).not.toHaveBeenCalled();
    });
  });

  it('forwards to console when debug is enabled', () => {
    setDebugLogging(true);
    methods.forEach((m) => {
      logger[m]('hello', 123);
      expect(console[m]).toHaveBeenCalledWith('hello', 123);
    });
  });

  it('respects configureCotiPlugin({ debug }) at call time', () => {
    configureCotiPlugin({ debug: true });
    logger.log('on');
    expect(console.log).toHaveBeenCalledTimes(1);

    configureCotiPlugin({ debug: false });
    logger.log('off');
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('setDebugLogging toggles the plugin config flag', () => {
    setDebugLogging(true);
    expect(getPluginConfig().debug).toBe(true);
    setDebugLogging(false);
    expect(getPluginConfig().debug).toBe(false);
  });
});
