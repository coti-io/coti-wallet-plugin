import { describe, expect, it } from 'vitest';
import {
  getDefaultSuccessWarning,
  mergeOnboardModalWarnings,
  resolveOnboardPageWarning,
} from '../../src/lib/onboardModalWarnings';

describe('onboardModalWarnings', () => {
  it('merges warnings with later sources overriding the same page', () => {
    expect(
      mergeOnboardModalWarnings(
        { intro: 'app intro' },
        { intro: 'runtime intro', success: 'runtime success' },
      ),
    ).toEqual({
      intro: 'runtime intro',
      success: 'runtime success',
    });
  });

  it('prefers runtime warnings over app warnings on the same page', () => {
    expect(
      resolveOnboardPageWarning('intro', {
        warnings: { intro: 'Portal disclaimer' },
        runtimeWarnings: { intro: 'Backup restore failed' },
      }),
    ).toBe('Backup restore failed');
  });

  it('uses app warnings when no runtime warning exists for that page', () => {
    expect(
      resolveOnboardPageWarning('intro', {
        warnings: { intro: 'Portal disclaimer' },
      }),
    ).toBe('Portal disclaimer');
  });

  it('falls back to the plugin success warning when nothing else is configured', () => {
    expect(resolveOnboardPageWarning('success', { saveBackup: false })).toBe(
      getDefaultSuccessWarning(false),
    );
  });

  it('returns null for pages without app, runtime, or plugin defaults', () => {
    expect(resolveOnboardPageWarning('progress', {})).toBeNull();
    expect(resolveOnboardPageWarning('error', {})).toBeNull();
  });
});
