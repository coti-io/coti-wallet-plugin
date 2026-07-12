import {
  ONBOARDING_STEPS,
  type OnboardingStep,
} from '../hooks/useAesKeyProvider';

export type OnboardingStepStatus = 'pending' | 'active' | 'complete' | 'error';

export function getVisibleOnboardingStep(stepId: OnboardingStep): OnboardingStep {
  switch (stepId) {
    case 'restoring-backup':
    case 'granting-funds':
    case 'waiting-for-funds':
    case 'switching-network':
    case 'creating-provider':
    case 'preparing-onboard':
      return 'preparing-onboard';
    case 'validating-key':
    case 'restoring-network':
    case 'persisting-key':
    case 'saving-backup':
      return 'persisting-key';
    default:
      return stepId;
  }
}

export function getOnboardingStepStatus(
  stepId: OnboardingStep,
  currentStep: OnboardingStep,
  hasError: boolean,
): OnboardingStepStatus {
  const visibleCurrentStep = getVisibleOnboardingStep(currentStep);

  if (hasError && (currentStep === 'error' || visibleCurrentStep === 'error')) {
    return 'error';
  }

  const stepIndex = ONBOARDING_STEPS.findIndex(step => step.id === stepId);
  const currentIndex = ONBOARDING_STEPS.findIndex(step => step.id === visibleCurrentStep);

  if (currentIndex === -1) return 'pending';
  if (visibleCurrentStep === 'complete') return 'complete';
  if (stepIndex < currentIndex) return 'complete';
  if (stepIndex === currentIndex) return 'active';
  return 'pending';
}

export function getProgressTitle(currentStep: OnboardingStep): string {
  if (currentStep === 'granting-funds') return 'Requesting COTI Grant';
  if (currentStep === 'waiting-for-funds') return 'Waiting for Grant Funds';
  return 'Onboarding in Progress';
}

export function getProgressDescription(currentStep: OnboardingStep): string {
  if (currentStep === 'granting-funds') {
    return 'Waiting for the grant service to fund your wallet before onboarding continues...';
  }
  if (currentStep === 'waiting-for-funds') {
    return 'The grant request was submitted. Waiting for the native COTI balance to update...';
  }
  return 'Please wait while we retrieve your AES encryption key...';
}
