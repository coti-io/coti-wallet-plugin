import type { ReactElement } from 'react';
import type { OnboardModalTheme } from '../components/OnboardModal';
import { usePrivacyBridgeUnlock } from '../context/privacyBridge/contexts';
import { usePrivateUnlockController } from '../context/privateUnlock/usePrivateUnlockController';

export interface UsePrivateUnlockFlowOptions {
  theme?: OnboardModalTheme;
  warning?: string;
  /** Called after a successful unlock (restore, onboarding, or manual key). */
  onUnlocked?: () => void | Promise<void>;
  /** Called when the user cancels backup-restore signing — modal is not opened. */
  onRestoreCancelled?: () => void;
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
  sendPrivateToken: ReturnType<typeof usePrivacyBridgeUnlock>['sendPrivateToken'];
  refreshPrivateBalances: ReturnType<typeof usePrivacyBridgeUnlock>['refreshPrivateBalances'];
  encryptPrivateValue: ReturnType<typeof usePrivacyBridgeUnlock>['encryptPrivateValue'];
  decryptPrivateValue: ReturnType<typeof usePrivacyBridgeUnlock>['decryptPrivateValue'];
}

/** Orchestrates restore / onboarding modal flows with cancel-safe async unlock. */
export function usePrivateUnlockFlow(
  options: UsePrivateUnlockFlowOptions = {},
): UsePrivateUnlockFlowResult {
  return usePrivateUnlockController(options);
}
