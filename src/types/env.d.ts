/// <reference types="vite/client" />

/** Replaced at build time from package.json (see tsup.config.ts / vitest.config.ts). */
declare const __PLUGIN_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
