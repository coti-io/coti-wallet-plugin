import { describe, expect, it } from 'vitest';
import {
  getDisplayOnboardingSteps,
  getOnboardingStepStatus,
  getProgressDescription,
  getProgressTitle,
  getVisibleOnboardingStep,
} from '../../src/lib/onboardingProgressDisplay';

describe('onboardingProgressDisplay', () => {
  it('maps hidden pre-signing steps to the preparing step', () => {
    expect(getVisibleOnboardingStep('restoring-backup')).toBe('preparing-onboard');
    expect(getVisibleOnboardingStep('granting-funds')).toBe('preparing-onboard');
    expect(getVisibleOnboardingStep('waiting-for-funds')).toBe('preparing-onboard');
    expect(getVisibleOnboardingStep('switching-network')).toBe('preparing-onboard');
    expect(getVisibleOnboardingStep('creating-provider')).toBe('preparing-onboard');
  });

  it('maps hidden post-retrieval steps to the persisting step when saving locally', () => {
    expect(getVisibleOnboardingStep('validating-key')).toBe('persisting-key');
    expect(getVisibleOnboardingStep('restoring-network')).toBe('persisting-key');
    expect(getVisibleOnboardingStep('saving-backup')).toBe('persisting-key');
  });

  it('maps hidden post-retrieval steps to retrieving-key when not saving locally', () => {
    expect(getVisibleOnboardingStep('validating-key', false)).toBe('retrieving-key');
    expect(getVisibleOnboardingStep('restoring-network', false)).toBe('retrieving-key');
    expect(getVisibleOnboardingStep('saving-backup', false)).toBe('retrieving-key');
  });

  it('omits persisting-key from display steps when post-retrieval persistence is skipped', () => {
    expect(getDisplayOnboardingSteps(false).map(step => step.id)).toEqual([
      'preparing-onboard',
      'signing-transaction',
      'retrieving-key',
    ]);
  });

  it('computes step statuses from the visible current step', () => {
    expect(getOnboardingStepStatus('preparing-onboard', 'signing-transaction', false)).toBe('complete');
    expect(getOnboardingStepStatus('signing-transaction', 'signing-transaction', false)).toBe('active');
    expect(getOnboardingStepStatus('retrieving-key', 'signing-transaction', false)).toBe('pending');
  });

  it('uses hidden steps when computing progress status', () => {
    expect(getOnboardingStepStatus('preparing-onboard', 'granting-funds', false)).toBe('active');
    expect(getOnboardingStepStatus('persisting-key', 'validating-key', false)).toBe('active');
    expect(getOnboardingStepStatus('retrieving-key', 'validating-key', false)).toBe('complete');
  });

  it('keeps retrieving-key active when save backup is disabled', () => {
    expect(getOnboardingStepStatus('retrieving-key', 'validating-key', false, false)).toBe('active');
  });

  it('returns error status only for the visible error step', () => {
    expect(getOnboardingStepStatus('preparing-onboard', 'error', true)).toBe('error');
    expect(getOnboardingStepStatus('preparing-onboard', 'signing-transaction', true)).toBe('complete');
  });

  it('returns specialized progress copy for grant steps', () => {
    expect(getProgressTitle('granting-funds')).toBe('Requesting COTI Grant');
    expect(getProgressDescription('granting-funds')).toContain('grant service');
    expect(getProgressTitle('waiting-for-funds')).toBe('Waiting for Grant Funds');
    expect(getProgressDescription('waiting-for-funds')).toContain('native COTI balance');
  });

  it('returns default progress copy for regular onboarding steps', () => {
    expect(getProgressTitle('signing-transaction')).toBe('Onboarding in Progress');
    expect(getProgressDescription('signing-transaction')).toContain('retrieve your AES encryption key');
  });
});
