import type { ReactElement } from 'react';
import type { OnboardModalTheme, OnboardModalWarnings } from '../components/OnboardModal';
import { useCotiUnlock } from '../context/plugin/contexts';
import { usePrivateUnlockController } from '../context/privateUnlock/usePrivateUnlockController';

export interface UsePrivateUnlockFlowOptions {
  theme?: OnboardModalTheme;
  warnings?: OnboardModalWarnings;
  /** Called after a successful unlock (restore, onboarding, or manual key). */
  onUnlocked?: () => void | Promise<void>;
  /** Called when the user cancels backup-restore signing — modal is not opened. */
  onRestoreCancelled?: () => void;
  /** Called when the user cancels contract onboarding signing — modal is dismissed. */
  onOnboardingCancelled?: () => void;
}

export interface UsePrivateUnlockFlowResult {
  isPrivateUnlocked: boolean;
  isUnlocking: boolean;
  showOnboardModal: boolean;
  openUnlockFlow: () => Promise<void>;
  unlockPrivateBalances: () => Promise<boolean>;
  ensurePrivateUnlocked: (pendingAction?: () => void | Promise<void>) => Promise<boolean>;
  handleToggleLock: () => void;
  resetUnlockUi: () => void;
  lockPrivateBalances: () => void;
  onboardModal: ReactElement;
  sendPrivateToken: ReturnType<typeof useCotiUnlock>['sendPrivateToken'];
  refreshPrivateBalances: ReturnType<typeof useCotiUnlock>['refreshPrivateBalances'];
  encryptPrivateValue: ReturnType<typeof useCotiUnlock>['encryptPrivateValue'];
  decryptPrivateValue: ReturnType<typeof useCotiUnlock>['decryptPrivateValue'];
  statusMessage: string | null;
}

/** Orchestrates restore / onboarding modal flows with cancel-safe async unlock. */
export function usePrivateUnlockFlow(
  options: UsePrivateUnlockFlowOptions = {},
): UsePrivateUnlockFlowResult {
  return usePrivateUnlockController(options);
}
