import { beforeEach, describe, expect, it } from 'vitest';
import { configureCotiPlugin } from '../../src/config/plugin';
import { isOnboardingServicesEnabled } from '../../src/lib/onboardingServices';

describe('onboardingServices', () => {
  beforeEach(() => {
    configureCotiPlugin({ onboardingServices: { mode: 'disabled' } });
  });

  it('is disabled by default or when mode is disabled', () => {
    expect(isOnboardingServicesEnabled()).toBe(false);
    configureCotiPlugin({ onboardingServices: { mode: 'disabled' } });
    expect(isOnboardingServicesEnabled()).toBe(false);
  });

  it('is enabled for custom and official modes', () => {
    configureCotiPlugin({ onboardingServices: { mode: 'custom' } });
    expect(isOnboardingServicesEnabled()).toBe(true);

    configureCotiPlugin({ onboardingServices: { mode: 'official' } });
    expect(isOnboardingServicesEnabled()).toBe(true);
  });
});
