import { getPluginConfig } from '../config/plugin';

export function isOnboardingServicesEnabled(): boolean {
  const mode = getPluginConfig().onboardingServices?.mode;
  return mode === 'custom' || mode === 'official';
}
