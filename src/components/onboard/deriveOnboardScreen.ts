import type { OnboardingStep } from '../../hooks/useAesKeyProvider';

export type OnboardScreen = 'intro' | 'progress' | 'success' | 'error' | 'none';

export interface DeriveOnboardScreenInput {
  currentStep: OnboardingStep;
  isLoading: boolean;
  error: string | null;
  aesKey?: string | null;
}

export function deriveOnboardScreen({
  currentStep,
  isLoading,
  error,
  aesKey,
}: DeriveOnboardScreenInput): OnboardScreen {
  if (error || currentStep === 'error') return 'error';
  if (currentStep === 'complete' && aesKey) return 'success';
  if (currentStep === 'idle' && !aesKey) return 'intro';

  if (
    isLoading
    || (
      currentStep !== 'idle'
      && currentStep !== 'complete'
      && currentStep !== 'signing-backup'
      && !aesKey
    )
  ) {
    return 'progress';
  }

  return 'none';
}
