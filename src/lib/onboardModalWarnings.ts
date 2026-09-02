export type OnboardModalPage = 'intro' | 'progress' | 'success' | 'error';

export type OnboardModalWarnings = Partial<Record<OnboardModalPage, string>>;

export function mergeOnboardModalWarnings(
  ...sources: Array<OnboardModalWarnings | null | undefined>
): OnboardModalWarnings {
  const merged: OnboardModalWarnings = {};

  for (const source of sources) {
    if (!source) continue;
    for (const page of Object.keys(source) as OnboardModalPage[]) {
      const message = source[page];
      if (message) {
        merged[page] = message;
      }
    }
  }

  return merged;
}

export function getDefaultSuccessWarning(saveBackup: boolean): string {
  return saveBackup
    ? 'Important: An encrypted backup can restore this key later. The plaintext key stays in this session only.'
    : 'Important: This session key is cleared when you refresh. Enable Save Locally next time if you want an encrypted backup.';
}

/** One warning per page: runtime > app > plugin default (success only). */
export function resolveOnboardPageWarning(
  page: OnboardModalPage,
  options: {
    warnings?: OnboardModalWarnings;
    runtimeWarnings?: OnboardModalWarnings;
    saveBackup?: boolean;
  },
): string | null {
  const runtime = options.runtimeWarnings?.[page]?.trim();
  if (runtime) return runtime;

  const app = options.warnings?.[page]?.trim();
  if (app) return app;

  if (page === 'success') {
    return getDefaultSuccessWarning(options.saveBackup ?? true);
  }

  return null;
}

export function hasOnboardModalWarnings(
  warnings?: OnboardModalWarnings | null,
): boolean {
  if (!warnings) return false;
  return Object.values(warnings).some((message) => !!message?.trim());
}
