/**
 * Per-plugin mutable state that used to live as module singletons.
 *
 * {@link CotiPluginProvider} leases one instance for its tree. Non-React
 * call sites (RPC, AES validation) use {@link getPluginRuntime}, which is the
 * innermost leased runtime or a process default when no provider is mounted.
 *
 * WalletConnect's wagmi config is not stored here. RainbowKit/WC Core is a
 * process singleton and lives outside CotiPluginProvider.
 */
export class PluginRuntime {
  private chainMuted = false;
  private readonly snapAesKeyCache: Record<string, string> = Object.create(null);
  private readonly validatedUnlockKeys = new Map<string, string>();
  private readonly preferFallbackRpcByChainId = new Set<number>();

  muteChainUpdates(): void {
    this.chainMuted = true;
  }

  unmuteChainUpdates(): void {
    this.chainMuted = false;
  }

  isChainUpdatesMuted(): boolean {
    return this.chainMuted;
  }

  getSnapAesKey(cacheKey: string): string | undefined {
    return this.snapAesKeyCache[cacheKey];
  }

  setSnapAesKey(cacheKey: string, key: string): void {
    this.snapAesKeyCache[cacheKey] = key;
  }

  deleteSnapAesKey(cacheKey: string): void {
    delete this.snapAesKeyCache[cacheKey];
  }

  clearSnapAesKeyCache(): void {
    for (const key of Object.keys(this.snapAesKeyCache)) {
      delete this.snapAesKeyCache[key];
    }
  }

  markPrimaryRateLimited(chainId: number): void {
    this.preferFallbackRpcByChainId.add(chainId);
  }

  prefersFallbackRpc(chainId: number): boolean {
    return this.preferFallbackRpcByChainId.has(chainId);
  }

  markAesKeyValidatedForUnlock(address: string, keyHex: string): void {
    this.validatedUnlockKeys.set(address, keyHex);
  }

  clearAesKeyValidatedForUnlock(address?: string): void {
    if (address) {
      this.validatedUnlockKeys.delete(address);
    } else {
      this.validatedUnlockKeys.clear();
    }
  }

  getValidatedAesKeyForUnlock(address: string): string | undefined {
    return this.validatedUnlockKeys.get(address);
  }

  reset(): void {
    this.chainMuted = false;
    this.clearSnapAesKeyCache();
    this.validatedUnlockKeys.clear();
    this.preferFallbackRpcByChainId.clear();
  }
}

const runtimeStack: PluginRuntime[] = [new PluginRuntime()];

export function createPluginRuntime(): PluginRuntime {
  return new PluginRuntime();
}

export function getPluginRuntime(): PluginRuntime {
  return runtimeStack[runtimeStack.length - 1]!;
}

export function installPluginRuntime(runtime: PluginRuntime): void {
  if (runtimeStack[runtimeStack.length - 1] === runtime) return;
  runtimeStack.push(runtime);
}

export function uninstallPluginRuntime(runtime: PluginRuntime): void {
  const index = runtimeStack.lastIndexOf(runtime);
  if (index === -1) return;
  runtimeStack.splice(index, 1);
  if (runtimeStack.length === 0) {
    runtimeStack.push(new PluginRuntime());
  }
}

/** Clears every leased runtime. Used by tests so module state cannot leak. */
export function resetPluginRuntime(): void {
  for (const runtime of runtimeStack) {
    runtime.reset();
  }
}
