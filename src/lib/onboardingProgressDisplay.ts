import {
  ONBOARDING_STEPS,
  type OnboardingStep,
} from '../hooks/useAesKeyProvider';

export type OnboardingStepStatus = 'pending' | 'active' | 'complete' | 'error';

export function getDisplayOnboardingSteps(saveBackup = true) {
  if (saveBackup) return ONBOARDING_STEPS;
  return ONBOARDING_STEPS.filter(step => step.id !== 'persisting-key');
}

export function getVisibleOnboardingStep(
  stepId: OnboardingStep,
  saveBackup = true,
): OnboardingStep {
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
      return saveBackup ? 'persisting-key' : 'retrieving-key';
    default:
      return stepId;
  }
}

export function getOnboardingStepStatus(
  stepId: OnboardingStep,
  currentStep: OnboardingStep,
  hasError: boolean,
  saveBackup = true,
): OnboardingStepStatus {
  const visibleCurrentStep = getVisibleOnboardingStep(currentStep, saveBackup);

  if (hasError && (currentStep === 'error' || visibleCurrentStep === 'error')) {
    return 'error';
  }

  const displaySteps = getDisplayOnboardingSteps(saveBackup);
  const stepIndex = displaySteps.findIndex(step => step.id === stepId);
  const currentIndex = displaySteps.findIndex(step => step.id === visibleCurrentStep);

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
