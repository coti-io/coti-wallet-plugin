import { describe, expect, it } from 'vitest';
import { deriveOnboardScreen } from '../../../src/components/onboard/deriveOnboardScreen';

describe('deriveOnboardScreen', () => {
  it('shows intro for the idle starting state', () => {
    expect(deriveOnboardScreen({
      currentStep: 'idle',
      isLoading: false,
      error: null,
    })).toBe('intro');
  });

  it('keeps the intro visible during idle restore probing', () => {
    expect(deriveOnboardScreen({
      currentStep: 'idle',
      isLoading: true,
      error: null,
    })).toBe('intro');
  });

  it('shows progress for hidden onboarding steps', () => {
    expect(deriveOnboardScreen({
      currentStep: 'validating-key',
      isLoading: false,
      error: null,
    })).toBe('progress');
  });

  it('keeps backup signing out of the main modal', () => {
    expect(deriveOnboardScreen({
      currentStep: 'signing-backup',
      isLoading: false,
      error: null,
    })).toBe('none');
  });

  it('shows success when onboarding is complete', () => {
    expect(deriveOnboardScreen({
      currentStep: 'complete',
      isLoading: false,
      error: null,
    })).toBe('success');

    expect(deriveOnboardScreen({
      currentStep: 'complete',
      isLoading: true,
      error: null,
    })).toBe('success');
  });

  it('gives errors precedence over loading and success state', () => {
    expect(deriveOnboardScreen({
      currentStep: 'complete',
      isLoading: true,
      error: 'boom',
    })).toBe('error');

    expect(deriveOnboardScreen({
      currentStep: 'error',
      isLoading: false,
      error: null,
    })).toBe('error');
  });
});
