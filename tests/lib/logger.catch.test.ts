import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force getPluginConfig to throw so we exercise the catch branch in isDebugEnabled.
vi.mock('../../src/config/plugin', () => ({
  getPluginConfig: vi.fn(() => {
    throw new Error('config unavailable');
  }),
  configureCotiPlugin: vi.fn(),
}));

import { logger } from '../../src/lib/logger';

describe('logger isDebugEnabled catch branch', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;

  beforeEach(() => {
    methods.forEach(m => vi.spyOn(console, m).mockImplementation(() => {}));
  });

  it('stays silent when getPluginConfig throws (catch returns false)', () => {
    methods.forEach(m => {
      logger[m]('should not appear');
      expect(console[m]).not.toHaveBeenCalled();
    });
  });
});
