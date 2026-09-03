/**
 * Build-time package version. tsup and vitest replace `__PLUGIN_VERSION__`
 * from `package.json`.
 */
export const PLUGIN_VERSION: string = __PLUGIN_VERSION__;

let announced = false;

function shouldAnnounce(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    return false;
  }
  return true;
}

/**
 * Prints the plugin version once so hosts can confirm which build is in the page.
 * Not gated by `debug` — configureCotiPlugin() usually runs after this module loads.
 */
export function announcePluginVersion(): boolean {
  if (announced || !shouldAnnounce()) return false;
  announced = true;
  console.info(`[@coti-io/coti-wallet-plugin@${PLUGIN_VERSION}] loaded`);
  return true;
}

/** @internal */
export function resetPluginVersionAnnouncement(): void {
  announced = false;
}

announcePluginVersion();
