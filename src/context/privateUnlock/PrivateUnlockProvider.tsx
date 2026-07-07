import React, { createContext, useContext, useMemo } from 'react';
import {
  usePrivateUnlockController,
  type PrivateUnlockControllerOptions,
} from './usePrivateUnlockController';

export type PrivateUnlockProviderOptions = PrivateUnlockControllerOptions;

export interface PrivateUnlockControllerValue {
  isUnlocked: boolean;
  isUnlocking: boolean;
  unlock: () => Promise<void>;
  lock: () => void;
  toggleLock: () => void;
  requireUnlock: (pendingAction?: () => void | Promise<void>) => Promise<boolean>;
  reset: () => void;
}

const PrivateUnlockContext = createContext<PrivateUnlockControllerValue | undefined>(undefined);

export interface PrivateUnlockProviderProps {
  children: React.ReactNode;
  options?: PrivateUnlockProviderOptions;
}

export const PrivateUnlockProvider: React.FC<PrivateUnlockProviderProps> = ({
  children,
  options,
}) => {
  const controller = usePrivateUnlockController(options);
  const {
    isPrivateUnlocked,
    isUnlocking,
    openUnlockFlow,
    lockPrivateBalances,
    handleToggleLock,
    ensurePrivateUnlocked,
    resetUnlockUi,
    onboardModal,
  } = controller;

  const value = useMemo<PrivateUnlockControllerValue>(() => ({
    isUnlocked: isPrivateUnlocked,
    isUnlocking,
    unlock: openUnlockFlow,
    lock: lockPrivateBalances,
    toggleLock: handleToggleLock,
    requireUnlock: ensurePrivateUnlocked,
    reset: resetUnlockUi,
  }), [
    ensurePrivateUnlocked,
    handleToggleLock,
    isPrivateUnlocked,
    isUnlocking,
    lockPrivateBalances,
    openUnlockFlow,
    resetUnlockUi,
  ]);

  return (
    <PrivateUnlockContext.Provider value={value}>
      {children}
      {onboardModal}
    </PrivateUnlockContext.Provider>
  );
};

export const usePrivateUnlock = (): PrivateUnlockControllerValue => {
  const context = useContext(PrivateUnlockContext);
  if (context === undefined) {
    throw new Error('usePrivateUnlock must be used within a PrivateUnlockProvider');
  }
  return context;
};
