/**
 * Module-level flag to suppress UI chain-change reactions during onboarding.
 * When muted, consuming apps should ignore provider chainChanged events
 * so the UI stays on the original chain while onboarding executes on COTI.
 */
let muted = false;

export function muteChainUpdates() { muted = true; }
export function unmuteChainUpdates() { muted = false; }
export function isChainUpdatesMuted() { return muted; }
