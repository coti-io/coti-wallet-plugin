import { getPluginRuntime } from './pluginRuntime';

/**
 * Suppress UI chain-change reactions during onboarding.
 * When muted, consuming apps should ignore provider chainChanged events
 * so the UI stays on the original chain while onboarding executes on COTI.
 */
export function muteChainUpdates() {
  getPluginRuntime().muteChainUpdates();
}
export function unmuteChainUpdates() {
  getPluginRuntime().unmuteChainUpdates();
}
export function isChainUpdatesMuted() {
  return getPluginRuntime().isChainUpdatesMuted();
}
