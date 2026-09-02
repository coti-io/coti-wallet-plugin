import { createContext, useContext } from 'react';

/**
 * Package-internal plaintext session AES key.
 * Not part of the public unlock context — hosts must not read this.
 */
export const SessionAesKeyContext = createContext<string | null>(null);

/** Internal: plugin-owned unlock UI (OnboardModal) reads the session key here. */
export const useSessionAesKey = (): string | null => useContext(SessionAesKeyContext);
