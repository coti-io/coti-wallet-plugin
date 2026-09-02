import type { OnboardingStep } from '../../hooks/useAesKeyProvider';

export type OnboardScreen = 'intro' | 'progress' | 'success' | 'error' | 'none';

export interface DeriveOnboardScreenInput {
  currentStep: OnboardingStep;
  isLoading: boolean;
  error: string | null;
}

export function deriveOnboardScreen({
  currentStep,
  error,
}: DeriveOnboardScreenInput): OnboardScreen {
  if (error || currentStep === 'error') return 'error';
  if (currentStep === 'complete') return 'success';
  if (currentStep === 'signing-backup') return 'none';
  if (currentStep === 'idle') return 'intro';
  return 'progress';
}
