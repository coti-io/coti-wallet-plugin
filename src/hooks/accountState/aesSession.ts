import {
    accountStateFailed,
    type AccountStateFailureReason,
} from '../../context/plugin/sessionShared';
import {
    isAesKeyValidatedForUnlock,
} from '../../crypto/aesKeyValidation';
import type {
    AccountStateOptions,
    GetAesKeyFromSnap,
    IsStale,
    ValidateMetaMaskAesKeyOnUnlock,
} from './types';

export const allowSnapOperations = (
    canUseSnapOperations: boolean,
    options: AccountStateOptions | undefined,
): boolean =>
    canUseSnapOperations
    && !options?.forceContractOnboarding
    && (!options?.restoreOnly || options?.snapSideDecrypt === true);

export const shouldFetchAesKey = ({
    aesKeyOverride,
    sessionAesKey,
    forceContractOnboarding,
    checkSnap,
    allowSnap,
    snapSideDecrypt,
}: {
    aesKeyOverride?: string | null;
    sessionAesKey?: string | null;
    forceContractOnboarding: boolean;
    checkSnap: boolean;
    allowSnap: boolean;
    snapSideDecrypt?: boolean;
}): boolean => {
    const effectiveSessionAesKey = forceContractOnboarding ? null : sessionAesKey;
    return !aesKeyOverride
        && !effectiveSessionAesKey
        && checkSnap
        && !(allowSnap && snapSideDecrypt);
};

export const initialAesKey = (
    aesKeyOverride: string | null | undefined,
    sessionAesKey: string | null | undefined,
    forceContractOnboarding: boolean,
): string | null => {
    const effectiveSessionAesKey = forceContractOnboarding ? null : sessionAesKey;
    return aesKeyOverride ?? effectiveSessionAesKey ?? null;
};

/** Default Snap/provider AES load (unlock + autoInitTokens=false). */
export const loadAesKeyFromSnap = async (
    account: string,
    options: AccountStateOptions | undefined,
    validateOnUnlock: boolean,
    getAESKeyFromSnap: GetAesKeyFromSnap,
): Promise<string | null> => {
    const { validateOnUnlock: _validateOnUnlock, ...aesKeyOptions } = options ?? {};
    if (validateOnUnlock) {
        return Object.keys(aesKeyOptions).length === 0
            ? getAESKeyFromSnap(account, { skipCache: true })
            : getAESKeyFromSnap(account, { skipCache: true, ...aesKeyOptions });
    }
    return options === undefined
        ? getAESKeyFromSnap(account)
        : getAESKeyFromSnap(account, aesKeyOptions);
};

/** Restore-only load always passes an options object when not validating. */
export const loadAesKeyFromSnapForRestore = async (
    account: string,
    options: AccountStateOptions | undefined,
    validateOnUnlock: boolean,
    getAESKeyFromSnap: GetAesKeyFromSnap,
): Promise<string | null> => {
    const { validateOnUnlock: _validateOnUnlock, ...aesKeyOptions } = options ?? {};
    return validateOnUnlock
        ? getAESKeyFromSnap(account, { skipCache: true, ...aesKeyOptions })
        : getAESKeyFromSnap(account, aesKeyOptions);
};

export const validateAesKeyOnUnlock = async ({
    aesKey,
    account,
    chainId,
    options,
    validateOnUnlock,
    validateMetaMaskAesKeyOnUnlock,
    isStale,
}: {
    aesKey: string | null;
    account: string;
    chainId?: number | null;
    options: AccountStateOptions | undefined;
    validateOnUnlock: boolean;
    validateMetaMaskAesKeyOnUnlock?: ValidateMetaMaskAesKeyOnUnlock;
    isStale: IsStale;
}): Promise<{ ok: false; reason: AccountStateFailureReason } | { ok: true; markValidatedAfterSuccess: boolean }> => {
    let markValidatedAfterSuccess = false;

    if (
        aesKey
        && validateOnUnlock
        && validateMetaMaskAesKeyOnUnlock
        && !options?.forceContractOnboarding
        && !isAesKeyValidatedForUnlock(account, aesKey)
    ) {
        await validateMetaMaskAesKeyOnUnlock(aesKey, account, chainId ?? null);
        if (isStale()) return accountStateFailed('stale');
        markValidatedAfterSuccess = true;
    }

    if (aesKey && options?.forceContractOnboarding) {
        markValidatedAfterSuccess = true;
    }

    return { ok: true, markValidatedAfterSuccess };
};
