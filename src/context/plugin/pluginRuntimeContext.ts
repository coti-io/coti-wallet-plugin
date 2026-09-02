import { createContext, useContext, useEffect, useRef } from 'react';
import {
  createPluginRuntime,
  getPluginRuntime,
  installPluginRuntime,
  uninstallPluginRuntime,
  type PluginRuntime,
} from '../../lib/pluginRuntime';

export const PluginRuntimeContext = createContext<PluginRuntime | null>(null);

/** Runtime for this plugin tree, or the active lease when no provider is mounted. */
export function useOptionalPluginRuntime(): PluginRuntime {
  return useContext(PluginRuntimeContext) ?? getPluginRuntime();
}

/**
 * Owns a {@link PluginRuntime} for the current CotiPluginProvider and installs
 * it as the active lease so non-React helpers see the same instance.
 */
export function usePluginRuntimeLease(): PluginRuntime {
  const runtimeRef = useRef<PluginRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = createPluginRuntime();
    installPluginRuntime(runtimeRef.current);
  }
  const runtime = runtimeRef.current;

  useEffect(() => {
    installPluginRuntime(runtime);
    return () => {
      runtime.reset();
      uninstallPluginRuntime(runtime);
    };
  }, [runtime]);

  return runtime;
}
