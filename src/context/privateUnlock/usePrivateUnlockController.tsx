import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { OnboardModal, type OnboardModalTheme } from '../../components/OnboardModal';
import { WalletSignPrompt, type WalletSignPromptPurpose } from '../../components/WalletSignPrompt';
import { usePrivacyBridgeUnlock, usePrivacyBridgeWallet } from '../privacyBridge/contexts';
import { formatOnboardingError, isMetaMaskMobileBrowser } from '../../lib/metaMaskMobile';
import { isUserRejection } from '../../lib/walletErrors';
import type {
  OnboardingProgressDetails,
  OnboardingStep,
} from '../../hooks/useAesKeyProvider';
import { isSnapInstallEnabled } from '../../config/plugin';
import { useWalletType } from '../../hooks/useWalletType';
import { logger } from '../../lib/logger';

const MIN_BACKUP_SAVE_PROGRESS_MS = 600;

const CONTRACT_PROGRESS_ORDER: Partial<Record<OnboardingStep, number>> = {
  idle: 0,
  'preparing-onboard': 1,
  'signing-transaction': 2,
  'retrieving-key': 3,
  'validating-key': 4,
  'restoring-network': 4,
  'persisting-key': 4,
  'saving-backup': 4,
  complete: 5,
};

function keepForwardContractProgress(previous: OnboardingStep, next: OnboardingStep): OnboardingStep {
  const previousOrder = CONTRACT_PROGRESS_ORDER[previous] ?? 0;
  const nextOrder = CONTRACT_PROGRESS_ORDER[next] ?? previousOrder;
  return nextOrder >= previousOrder ? next : previous;
}

export interface PrivateUnlockControllerOptions {
  theme?: OnboardModalTheme;
  warning?: string;
  /** Called after a successful unlock (restore, onboarding, or manual key). */
  onUnlocked?: () => void | Promise<void>;
  /** Called when the user cancels backup-restore signing — modal is not opened. */
  onRestoreCancelled?: () => void;
  /** Called when the user cancels contract onboarding signing — modal is dismissed. */
  onOnboardingCancelled?: () => void;
}

export interface PrivateUnlockController {
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
  walletSignPrompt: ReactElement;
  sendPrivateToken: ReturnType<typeof usePrivacyBridgeUnlock>['sendPrivateToken'];
  refreshPrivateBalances: ReturnType<typeof usePrivacyBridgeUnlock>['refreshPrivateBalances'];
  encryptPrivateValue: ReturnType<typeof usePrivacyBridgeUnlock>['encryptPrivateValue'];
  decryptPrivateValue: ReturnType<typeof usePrivacyBridgeUnlock>['decryptPrivateValue'];
  /** Non-blocking message shown below the unlock control after a cancelled attempt. */
  statusMessage: string | null;
}

/** Internal engine for private unlock orchestration. Public apps should use usePrivateUnlock(). */
export function usePrivateUnlockController(
  options: PrivateUnlockControllerOptions = {},
): PrivateUnlockController {
  const { theme, warning, onUnlocked, onRestoreCancelled, onOnboardingCancelled } = options;
  const unlock = usePrivacyBridgeUnlock();
  const wallet = usePrivacyBridgeWallet();
  const walletTypeInfo = useWalletType();

  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalWarning, setModalWarning] = useState<string | null>(null);
  const [snapConnectedInModal, setSnapConnectedInModal] = useState(false);
  const [saveBackup, setSaveBackup] = useState(true);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('idle');
  const [walletSignPromptPurpose, setWalletSignPromptPurpose] =
    useState<WalletSignPromptPurpose>('decrypt-backup');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isUnlockInProgress, setIsUnlockInProgress] = useState(false);
  const [pendingUnlockAfterConnect, setPendingUnlockAfterConnect] = useState(false);

  const unlockRequestIdRef = useRef(0);
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);
  const pendingActionOwnerRef = useRef<number | null>(null);
  const prevWalletAddressRef = useRef(wallet.walletAddress);
  const snapConnectedInModalRef = useRef(false);
  const backupSaveProgressStartedAtRef = useRef<number | null>(null);
  const pendingCompleteRequestIdRef = useRef<number | null>(null);
  const contractOnboardingCancelledRef = useRef(false);
  const contractOnboardingFailureRef = useRef<string | null>(null);
  const inFlightRestoreRequestIdRef = useRef<number | null>(null);
  const unlockInProgressOwnerRef = useRef<number | null>(null);
  const isPrivateUnlockedRef = useRef(unlock.isPrivateUnlocked);
  isPrivateUnlockedRef.current = unlock.isPrivateUnlocked;

  const connectedAddress = wallet.walletAddress || '';
  const isMetaMaskWallet = walletTypeInfo.walletType === 'metamask';
  const canAttemptSnapInstall =
    isMetaMaskWallet && !isMetaMaskMobileBrowser() && isSnapInstallEnabled();
  const usesSnapStorage =
    canAttemptSnapInstall && (walletTypeInfo.isMetaMaskWithSnap || snapConnectedInModal);

  const isActiveUnlockRequest = useCallback(
    (requestId: number) => requestId === unlockRequestIdRef.current,
    [],
  );

  const beginUnlockRequest = useCallback(() => {
    const requestId = unlockRequestIdRef.current + 1;
    unlockRequestIdRef.current = requestId;
    unlockInProgressOwnerRef.current = requestId;
    pendingActionRef.current = null;
    pendingActionOwnerRef.current = null;
    setCurrentStep('idle');
    setModalError(null);
    setModalWarning(null);
    backupSaveProgressStartedAtRef.current = null;
    pendingCompleteRequestIdRef.current = null;
    contractOnboardingCancelledRef.current = false;
    contractOnboardingFailureRef.current = null;
    return requestId;
  }, []);

  const clearPendingActionForRequest = useCallback((requestId: number) => {
    if (pendingActionOwnerRef.current !== requestId) return;
    pendingActionRef.current = null;
    pendingActionOwnerRef.current = null;
  }, []);

  const setPendingActionForRequest = useCallback((
    requestId: number,
    pendingAction: () => void | Promise<void>,
  ) => {
    pendingActionRef.current = pendingAction;
    pendingActionOwnerRef.current = requestId;
  }, []);

  const releaseUnlockInProgress = useCallback((requestId: number) => {
    if (unlockInProgressOwnerRef.current !== requestId) return;
    unlockInProgressOwnerRef.current = null;
    setIsUnlockInProgress(false);
  }, []);

  const dismissOnboardModal = useCallback(() => {
    unlockRequestIdRef.current += 1;
    unlockInProgressOwnerRef.current = null;
    pendingActionRef.current = null;
    pendingActionOwnerRef.current = null;
    setShowOnboardModal(false);
    setCurrentStep('idle');
    setModalError(null);
    setModalWarning(null);
    setIsUnlockInProgress(false);
    setIsUnlocking(false);
    backupSaveProgressStartedAtRef.current = null;
    pendingCompleteRequestIdRef.current = null;
    contractOnboardingCancelledRef.current = false;
    contractOnboardingFailureRef.current = null;
  }, []);

  const runPendingAction = useCallback(async (requestId: number) => {
    if (pendingActionOwnerRef.current !== requestId) return;
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    pendingActionOwnerRef.current = null;
    if (!action) return;
    await action();
  }, []);

  const notifyUnlocked = useCallback(async () => {
    if (onUnlocked) {
      await onUnlocked();
    }
  }, [onUnlocked]);

  const finishSuccessfulOnboarding = useCallback(async () => {
    setShowOnboardModal(false);
    setCurrentStep('idle');
    setModalError(null);
    setModalWarning(null);
    unlockInProgressOwnerRef.current = null;
    setIsUnlockInProgress(false);
    setIsUnlocking(false);
    pendingCompleteRequestIdRef.current = null;
    await notifyUnlocked();
    await runPendingAction(unlockRequestIdRef.current);
  }, [notifyUnlocked, runPendingAction]);

  useEffect(() => {
    if (usesSnapStorage) {
      setSaveBackup(false);
    }
  }, [usesSnapStorage]);

  useEffect(() => {
    if (!wallet.isConnected) {
      setPendingUnlockAfterConnect(false);
      setSnapConnectedInModal(false);
      snapConnectedInModalRef.current = false;
      backupSaveProgressStartedAtRef.current = null;
      pendingCompleteRequestIdRef.current = null;
    }
  }, [wallet.isConnected]);

  useEffect(() => {
    const previousAddress = prevWalletAddressRef.current;
    prevWalletAddressRef.current = wallet.walletAddress;

    if (
      !previousAddress
      || !wallet.walletAddress
      || previousAddress.toLowerCase() === wallet.walletAddress.toLowerCase()
    ) {
      return;
    }

    dismissOnboardModal();
  }, [dismissOnboardModal, wallet.walletAddress]);

  const connectSnap = useCallback(async () => {
    if (!canAttemptSnapInstall) return false;

    setModalError(null);
    try {
      const connected = await unlock.requestSnapConnection();
      if (!connected) {
        setModalWarning('Snap connection was skipped or rejected. Continuing without Snap storage.');
        return false;
      }
      snapConnectedInModalRef.current = true;
      setSnapConnectedInModal(true);
      return true;
    } catch {
      setModalWarning('Snap connection failed. Continuing without Snap storage.');
      return false;
    }
  }, [canAttemptSnapInstall, unlock]);

  const handleRestoreUnlockProgress = useCallback((step: OnboardingStep) => {
    if (step === 'signing-backup') {
      setCurrentStep(step);
      return;
    }

    if (
      step === 'complete'
      || step === 'idle'
      || step === 'persisting-key'
      || step === 'error'
    ) {
      setCurrentStep((previous) => (previous === 'signing-backup' ? 'idle' : previous));
    }
  }, []);

  const completeUnlock = useCallback(async (requestId: number) => {
    if (!isActiveUnlockRequest(requestId)) return false;

    setShowOnboardModal(false);
    setCurrentStep('idle');
    releaseUnlockInProgress(requestId);
    await notifyUnlocked();
    await runPendingAction(requestId);
    return true;
  }, [isActiveUnlockRequest, notifyUnlocked, releaseUnlockInProgress, runPendingAction]);

  const handleOnboardingIncomplete = useCallback((
    requestId: number,
  ) => {
    if (!isActiveUnlockRequest(requestId)) return;

    if (contractOnboardingCancelledRef.current) {
      dismissOnboardModal();
      setStatusMessage('Signature cancelled.');
      onOnboardingCancelled?.();
      return;
    }

    const failureMessage = contractOnboardingFailureRef.current;
    if (failureMessage) {
      setCurrentStep('error');
      setModalError(failureMessage);
      setModalWarning(unlock.onboardingWarning ?? null);
      releaseUnlockInProgress(requestId);
      return;
    }

    setCurrentStep('error');
    setModalError('Onboarding did not complete. Please retry.');
    setModalWarning(unlock.onboardingWarning ?? null);
    releaseUnlockInProgress(requestId);
  }, [dismissOnboardModal, isActiveUnlockRequest, onOnboardingCancelled, releaseUnlockInProgress, unlock.onboardingWarning]);

  const handleStaleRestoreCompletion = useCallback((
    requestId: number,
    refreshSucceeded: boolean,
  ): boolean => {
    clearPendingActionForRequest(requestId);

    const unlocked = refreshSucceeded || isPrivateUnlockedRef.current;
    if (!unlocked) return false;

    // Stale request ids never match unlockInProgressOwnerRef after supersede/dismiss,
    // so releaseUnlockInProgress(staleId) is a no-op. Clear the gate only when:
    // - session is already unlocked (openUnlockFlow/ensure will early-return), or
    // - this restore is still the latest in-flight restore finishing successfully.
    if (
      isPrivateUnlockedRef.current
      || inFlightRestoreRequestIdRef.current === requestId
    ) {
      unlockInProgressOwnerRef.current = null;
      setIsUnlockInProgress(false);
    }
    return true;
  }, [clearPendingActionForRequest]);

  const restorePrivateUnlock = useCallback(async (
    requestId: number,
    pendingAction?: () => void | Promise<void>,
  ): Promise<boolean> => {
    if (pendingAction) {
      setPendingActionForRequest(requestId, pendingAction);
    }

    setModalError(null);
    setModalWarning(null);
    inFlightRestoreRequestIdRef.current = requestId;
    setIsUnlocking(true);

    try {
      let restoreCancelled = false;
      if (await unlock.refreshPrivateBalances({
        restoreOnly: true,
        onRestoreCancelled: () => {
          if (!isActiveUnlockRequest(requestId)) return;
          restoreCancelled = true;
          clearPendingActionForRequest(requestId);
          onRestoreCancelled?.();
        },
        onProgress: (step) => {
          if (!isActiveUnlockRequest(requestId)) return;
          if (step === 'signing-backup') {
            setWalletSignPromptPurpose('decrypt-backup');
          }
          handleRestoreUnlockProgress(step);
        },
      })) {
        if (!isActiveUnlockRequest(requestId)) {
          return handleStaleRestoreCompletion(requestId, true);
        }
        return completeUnlock(requestId);
      }

      if (!isActiveUnlockRequest(requestId)) {
        return handleStaleRestoreCompletion(requestId, false);
      }

      if (restoreCancelled) {
        releaseUnlockInProgress(requestId);
        return false;
      }

      setCurrentStep('idle');
      setModalWarning(unlock.onboardingWarning ?? null);
      setShowOnboardModal(true);
      return false;
    } catch (error) {
      if (!isActiveUnlockRequest(requestId)) {
        return handleStaleRestoreCompletion(requestId, false);
      }

      setCurrentStep('idle');
      setShowOnboardModal(true);
      const message = error instanceof Error ? error.message : 'Private unlock failed.';
      setModalError(message === 'SNAP_REQUIRED' ? null : message);
      return false;
    } finally {
      if (inFlightRestoreRequestIdRef.current === requestId) {
        inFlightRestoreRequestIdRef.current = null;
        setIsUnlocking(false);
      }
    }
  }, [clearPendingActionForRequest, completeUnlock, handleRestoreUnlockProgress, handleStaleRestoreCompletion, isActiveUnlockRequest, onRestoreCancelled, releaseUnlockInProgress, setPendingActionForRequest, unlock]);

  const unlockPrivateBalances = useCallback(async () => {
    if (!connectedAddress) return false;

    setStatusMessage(null);
    const requestId = beginUnlockRequest();
    return restorePrivateUnlock(requestId);
  }, [beginUnlockRequest, connectedAddress, restorePrivateUnlock]);

  const ensurePrivateUnlocked = useCallback(async (
    pendingAction?: () => void | Promise<void>,
  ): Promise<boolean> => {
    if (unlock.isPrivateUnlocked) {
      if (pendingAction) await pendingAction();
      return true;
    }
    if (!connectedAddress) return false;

    setStatusMessage(null);
    const requestId = beginUnlockRequest();
    return restorePrivateUnlock(requestId, pendingAction);
  }, [beginUnlockRequest, connectedAddress, restorePrivateUnlock, unlock.isPrivateUnlocked]);

  const handleContractOnboardingProgress = useCallback((
    step: OnboardingStep,
    details?: OnboardingProgressDetails,
  ) => {
    logger.debug('[PrivateUnlock] contract onboarding progress', {
      step,
      details,
      currentStep,
      showOnboardModal,
    });

    if (details?.cancelled) {
      contractOnboardingCancelledRef.current = true;
    }

    if (details?.error) {
      contractOnboardingFailureRef.current = details.error;
    }

    if (step === 'signing-backup') {
      backupSaveProgressStartedAtRef.current = Date.now();
      setCurrentStep('saving-backup');
      return;
    }

    if (step === 'complete') {
      return;
    }

    if (step === 'error') {
      const failureMessage = details?.error ?? contractOnboardingFailureRef.current;
      if (failureMessage) {
        contractOnboardingFailureRef.current = failureMessage;
        setCurrentStep('error');
        setModalError(failureMessage);
        setModalWarning(unlock.onboardingWarning ?? null);
        releaseUnlockInProgress(unlockRequestIdRef.current);
      }
      return;
    }

    if (contractOnboardingFailureRef.current) {
      return;
    }

    setCurrentStep((previous) => keepForwardContractProgress(previous, step));
    if (step === 'idle') {
      setModalError(null);
    }
  }, [currentStep, showOnboardModal, releaseUnlockInProgress, unlock.onboardingWarning]);

  const showOnboardingComplete = useCallback((requestId: number) => {
    if (!isActiveUnlockRequest(requestId)) return;

    pendingCompleteRequestIdRef.current = null;
    setShowOnboardModal(true);
    setCurrentStep('complete');
    releaseUnlockInProgress(requestId);
    setIsUnlocking(false);
  }, [isActiveUnlockRequest, releaseUnlockInProgress]);

  useEffect(() => {
    const requestId = pendingCompleteRequestIdRef.current;
    if (requestId === null || !unlock.sessionAesKey) return;

    showOnboardingComplete(requestId);
  }, [showOnboardingComplete, unlock.sessionAesKey]);

  const beginOnboarding = useCallback(async () => {
    if (!connectedAddress) return;

    const requestId = unlockRequestIdRef.current;
    setModalError(null);
    setModalWarning(null);
    setIsUnlocking(true);
    setShowOnboardModal(true);
    setCurrentStep('preparing-onboard');
    contractOnboardingCancelledRef.current = false;
    contractOnboardingFailureRef.current = null;
    try {
      let useSnapStorageForOnboarding =
        usesSnapStorage || snapConnectedInModalRef.current;

      if (!useSnapStorageForOnboarding && canAttemptSnapInstall) {
        useSnapStorageForOnboarding = await connectSnap();
      }

      if (!isActiveUnlockRequest(requestId)) {
        return;
      }

      const ok = await unlock.refreshPrivateBalances({
        forceContractOnboarding: true,
        saveBackup: useSnapStorageForOnboarding ? false : saveBackup,
        onProgress: (step, details) => {
          if (isActiveUnlockRequest(requestId)) {
            handleContractOnboardingProgress(step, details);
          }
        },
      });
      if (!ok) {
        handleOnboardingIncomplete(requestId);
        return;
      }

      if (!isActiveUnlockRequest(requestId)) {
        return;
      }

      logger.debug('[PrivateUnlock] contract onboarding result', {
        ok,
        currentStep,
        hasSessionAesKey: !!unlock.sessionAesKey,
        hasOnboardingError: !!unlock.onboardingError,
        hasOnboardingWarning: !!unlock.onboardingWarning,
      });

      const backupSaveProgressStartedAt = backupSaveProgressStartedAtRef.current;
      if (backupSaveProgressStartedAt !== null) {
        const elapsedMs = Date.now() - backupSaveProgressStartedAt;
        const remainingMs = MIN_BACKUP_SAVE_PROGRESS_MS - elapsedMs;
        if (remainingMs > 0) {
          await new Promise(resolve => setTimeout(resolve, remainingMs));
        }
        backupSaveProgressStartedAtRef.current = null;
      }

      if (!isActiveUnlockRequest(requestId)) {
        return;
      }

      if (unlock.sessionAesKey) {
        showOnboardingComplete(requestId);
      } else {
        pendingCompleteRequestIdRef.current = requestId;
        setShowOnboardModal(true);
        setCurrentStep('validating-key');
      }
    } catch (error) {
      if (!isActiveUnlockRequest(requestId)) return;

      if (isUserRejection(error)) {
        dismissOnboardModal();
        setStatusMessage('Signature cancelled.');
        onOnboardingCancelled?.();
        return;
      }

      setCurrentStep('error');
      setModalError(formatOnboardingError(error));
    } finally {
      if (!isActiveUnlockRequest(requestId)) return;
      if (pendingCompleteRequestIdRef.current === null) {
        setIsUnlocking(false);
      }
    }
  }, [canAttemptSnapInstall, connectSnap, connectedAddress, currentStep, dismissOnboardModal, handleContractOnboardingProgress, handleOnboardingIncomplete, isActiveUnlockRequest, onOnboardingCancelled, saveBackup, showOnboardingComplete, unlock, usesSnapStorage]);

  const handleOnboardModalClose = useCallback(() => {
    if (currentStep === 'complete') {
      void finishSuccessfulOnboarding();
      return;
    }
    dismissOnboardModal();
  }, [currentStep, dismissOnboardModal, finishSuccessfulOnboarding]);

  const openUnlockFlow = useCallback(async () => {
    if (!wallet.isConnected) {
      setPendingUnlockAfterConnect(true);
      await wallet.handleConnect();
      return;
    }
    if (unlock.isPrivateUnlocked) {
      unlockInProgressOwnerRef.current = null;
      setIsUnlockInProgress(false);
      return;
    }
    if (isUnlockInProgress) return;

    setStatusMessage(null);
    setIsUnlockInProgress(true);
    await unlockPrivateBalances();
  }, [isUnlockInProgress, unlock.isPrivateUnlocked, unlockPrivateBalances, wallet]);

  useEffect(() => {
    if (wallet.isConnected && pendingUnlockAfterConnect) {
      setPendingUnlockAfterConnect(false);
      void openUnlockFlow();
    }
  }, [openUnlockFlow, pendingUnlockAfterConnect, wallet.isConnected]);

  const handleToggleLock = useCallback(() => {
    if (!wallet.isConnected) {
      setPendingUnlockAfterConnect(true);
      void wallet.handleConnect();
      return;
    }
    if (unlock.isPrivateUnlocked) {
      unlock.lockPrivateBalances();
      dismissOnboardModal();
      return;
    }
    void openUnlockFlow();
  }, [dismissOnboardModal, openUnlockFlow, unlock, wallet]);

  const resetUnlockUi = useCallback(() => {
    dismissOnboardModal();
    setStatusMessage(null);
    setPendingUnlockAfterConnect(false);
  }, [dismissOnboardModal]);

  const lockPrivateBalances = useCallback(() => {
    unlock.lockPrivateBalances();
    setPendingUnlockAfterConnect(false);
    dismissOnboardModal();
  }, [dismissOnboardModal, unlock]);

  const walletSignPrompt = (
    <WalletSignPrompt
      isOpen={currentStep === 'signing-backup'}
      walletType={walletTypeInfo.walletType}
      theme={theme}
      purpose={walletSignPromptPurpose}
    />
  );

  const visibleModalError = modalError;

  const onboardModal = (
    <OnboardModal
      isOpen={showOnboardModal && currentStep !== 'signing-backup'}
      onClose={handleOnboardModalClose}
      onConfirm={beginOnboarding}
      isLoading={isUnlocking}
      error={visibleModalError}
      walletType={walletTypeInfo.walletType}
      currentStep={currentStep}
      aesKey={currentStep === 'complete' ? unlock.sessionAesKey : null}
      saveBackup={saveBackup}
      showSaveBackupOption={!usesSnapStorage}
      onSaveBackupChange={setSaveBackup}
      onManualAesKeySubmit={async (aesKey, { saveBackup: shouldSaveBackup }) => {
        const requestId = unlockRequestIdRef.current;
        setModalWarning(null);
        const manualSaveResult = await unlock.saveManualAesKey(aesKey, {
          saveBackup: shouldSaveBackup,
          onProgress: (step) => {
            if (!isActiveUnlockRequest(requestId)) return;
            if (step === 'signing-backup') {
              setWalletSignPromptPurpose('save-backup');
              setShowOnboardModal(false);
            }
            handleRestoreUnlockProgress(step);
          },
        });
        if (!isActiveUnlockRequest(requestId)) {
          return;
        }
        if (manualSaveResult.backupWarning) {
          setModalWarning(manualSaveResult.backupWarning);
          setShowOnboardModal(true);
          setCurrentStep('complete');
          releaseUnlockInProgress(requestId);
          return;
        }
        await completeUnlock(requestId);
      }}
      theme={theme}
      warning={modalWarning ?? unlock.onboardingWarning ?? warning ?? null}
    />
  );

  return {
    isPrivateUnlocked: unlock.isPrivateUnlocked,
    isUnlocking,
    showOnboardModal,
    openUnlockFlow,
    unlockPrivateBalances,
    ensurePrivateUnlocked,
    handleToggleLock,
    resetUnlockUi,
    lockPrivateBalances,
    onboardModal,
    walletSignPrompt,
    statusMessage,
    sendPrivateToken: unlock.sendPrivateToken,
    refreshPrivateBalances: unlock.refreshPrivateBalances,
    encryptPrivateValue: unlock.encryptPrivateValue,
    decryptPrivateValue: unlock.decryptPrivateValue,
  };
}
