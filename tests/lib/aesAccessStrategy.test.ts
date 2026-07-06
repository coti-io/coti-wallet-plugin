import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AesAccessStrategy,
  buildUnlockPlanFromStrategy,
  resolveAesAccessStrategy,
  resolveAesKeyChainId,
  resolveAesAccessMode,
  shouldUseLocalCrypto,
  shouldUseSnapCrypto,
} from '../../src/lib/aesAccessStrategy';
import { configureCotiPlugin } from '../../src/config/plugin';
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID, SEPOLIA_CHAIN_ID } from '../../src/config/chains';

const strategy = (overrides: Partial<AesAccessStrategy> = {}): AesAccessStrategy => ({
  mode: 'local' as const,
  aesKeyChainId: COTI_TESTNET_CHAIN_ID,
  snapInstalled: false,
  snapHasKey: false,
  hasEncryptedBackup: true,
  ...overrides,
});

beforeEach(() => {
  configureCotiPlugin({ aesKeyChainId: undefined, onboardingServices: { mode: 'disabled' } });
});

describe('resolveAesAccessMode', () => {
  it('onboards when no snap and no local backup', () => {
    expect(resolveAesAccessMode({
      snapInstalled: false,
      snapHasKey: false,
      hasEncryptedBackup: false,
    })).toBe('onboard');
  });

  it('onboards when snap has no key and no local backup', () => {
    expect(resolveAesAccessMode({
      snapInstalled: true,
      snapHasKey: false,
      hasEncryptedBackup: false,
    })).toBe('onboard');
  });

  it('uses local key when snap has no key but local backup exists', () => {
    expect(resolveAesAccessMode({
      snapInstalled: true,
      snapHasKey: false,
      hasEncryptedBackup: true,
    })).toBe('local');
  });

  it('uses snap when snap has a key even if local backup exists', () => {
    expect(resolveAesAccessMode({
      snapInstalled: true,
      snapHasKey: true,
      hasEncryptedBackup: true,
    })).toBe('snap');
  });

  it('uses snap when snap has a key and no local backup', () => {
    expect(resolveAesAccessMode({
      snapInstalled: true,
      snapHasKey: true,
      hasEncryptedBackup: false,
    })).toBe('snap');
  });

  it('uses local when session key is already present without snap key', () => {
    expect(resolveAesAccessMode({
      snapInstalled: true,
      snapHasKey: false,
      hasEncryptedBackup: false,
      sessionAesKey: 'a'.repeat(32),
    })).toBe('local');
  });
});

describe('buildUnlockPlanFromStrategy', () => {
  const baseOptions = { validateOnUnlock: true as const };

  it('routes snap mode through snap-side decrypt', () => {
    const plan = buildUnlockPlanFromStrategy(
      strategy({ mode: 'snap', snapInstalled: true, snapHasKey: true, hasEncryptedBackup: false }),
      baseOptions,
    );

    expect(plan.unlockOptions.snapSideDecrypt).toBe(true);
    expect(plan.checkSnap).toBe(false);
    expect(plan.keyForUnlock).toBeUndefined();
  });

  it('routes local mode without session key through restore-only unlock', () => {
    const plan = buildUnlockPlanFromStrategy(
      strategy({ mode: 'local', snapInstalled: true, snapHasKey: false, hasEncryptedBackup: true }),
      baseOptions,
    );

    expect(plan.unlockOptions.restoreOnly).toBe(true);
    expect(plan.checkSnap).toBe(true);
  });

  it('routes local mode with session key through in-memory unlock', () => {
    const sessionKey = 'b'.repeat(32);
    const plan = buildUnlockPlanFromStrategy(
      strategy({ mode: 'local', snapInstalled: false, snapHasKey: false, hasEncryptedBackup: true }),
      baseOptions,
      sessionKey,
    );

    expect(plan.unlockOptions.restoreOnly).toBeUndefined();
    expect(plan.checkSnap).toBe(false);
    expect(plan.keyForUnlock).toBe(sessionKey);
  });

  it('routes onboard mode through contract onboarding unless restore-only', () => {
    const plan = buildUnlockPlanFromStrategy(
      strategy({ mode: 'onboard', snapInstalled: true, snapHasKey: false, hasEncryptedBackup: false }),
      baseOptions,
    );

    expect(plan.unlockOptions.forceContractOnboarding).toBe(true);
  });

  it('does not force onboarding during restore-only probing', () => {
    const plan = buildUnlockPlanFromStrategy(
      strategy({ mode: 'onboard', snapInstalled: true, snapHasKey: false, hasEncryptedBackup: false }),
      { ...baseOptions, restoreOnly: true },
    );

    expect(plan.unlockOptions.forceContractOnboarding).toBeUndefined();
    expect(plan.unlockOptions.restoreOnly).toBe(true);
  });
});

describe('crypto route helpers', () => {
  it('prefers snap crypto only in snap mode', () => {
    const snapStrategy = strategy({ mode: 'snap', snapInstalled: true, snapHasKey: true, hasEncryptedBackup: false });
    const localStrategy = strategy({ mode: 'local', snapInstalled: true, snapHasKey: false, hasEncryptedBackup: true });

    expect(shouldUseSnapCrypto(snapStrategy)).toBe(true);
    expect(shouldUseSnapCrypto(localStrategy)).toBe(false);
    expect(shouldUseLocalCrypto(localStrategy, 'c'.repeat(32))).toBe(true);
    expect(shouldUseLocalCrypto(snapStrategy, 'c'.repeat(32))).toBe(false);
  });
});

describe('resolveAesKeyChainId', () => {
  it('uses configured AES chain before current chain', () => {
    configureCotiPlugin({ aesKeyChainId: COTI_MAINNET_CHAIN_ID });

    expect(resolveAesKeyChainId(COTI_TESTNET_CHAIN_ID)).toBe(COTI_MAINNET_CHAIN_ID);
  });

  it('uses current COTI chain when no override is configured', () => {
    expect(resolveAesKeyChainId(COTI_MAINNET_CHAIN_ID)).toBe(COTI_MAINNET_CHAIN_ID);
  });

  it('falls back to COTI testnet for PoD chains without explicit config', () => {
    expect(resolveAesKeyChainId(SEPOLIA_CHAIN_ID)).toBe(COTI_TESTNET_CHAIN_ID);
  });

  it('throws for invalid per-call AES chain override', () => {
    expect(() => resolveAesKeyChainId(SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID)).toThrow('Invalid aesKeyChainId');
  });
});

describe('resolveAesAccessStrategy', () => {
  it('uses configured AES chain for encrypted backup probing', async () => {
    const fetchEncryptedAesBackup = vi.fn().mockResolvedValue(null);
    configureCotiPlugin({
      aesKeyChainId: COTI_MAINNET_CHAIN_ID,
      onboardingServices: { mode: 'custom', fetchEncryptedAesBackup },
    });

    await resolveAesAccessStrategy({
      address: '0xabc',
      chainId: SEPOLIA_CHAIN_ID,
      snapInstalled: false,
      hasAesKeyInSnap: vi.fn(),
    });

    expect(fetchEncryptedAesBackup).toHaveBeenCalledWith({
      address: '0xabc',
      chainId: COTI_MAINNET_CHAIN_ID,
    });
  });

  it('retries null Snap key probes then throws a recoverable error', async () => {
    const hasAesKeyInSnap = vi.fn().mockResolvedValue(null);

    await expect(resolveAesAccessStrategy({
      address: '0xabc',
      chainId: COTI_TESTNET_CHAIN_ID,
      snapInstalled: true,
      hasAesKeyInSnap,
      confirmSnapInstalled: vi.fn().mockResolvedValue(true),
      snapKeyProbeRetries: 1,
    })).rejects.toThrow('Could not check Snap AES key');

    expect(hasAesKeyInSnap).toHaveBeenCalledTimes(2);
  });

  it('treats null Snap key probe as no key when Snap is not installed', async () => {
    const hasAesKeyInSnap = vi.fn().mockResolvedValue(null);

    const strategy = await resolveAesAccessStrategy({
      address: '0xabc',
      chainId: COTI_TESTNET_CHAIN_ID,
      snapInstalled: true,
      hasAesKeyInSnap,
      confirmSnapInstalled: vi.fn().mockResolvedValue(false),
      snapKeyProbeRetries: 1,
    });

    expect(strategy.snapHasKey).toBe(false);
    expect(strategy.mode).toBe('onboard');
    expect(hasAesKeyInSnap).toHaveBeenCalledTimes(2);
  });
});
