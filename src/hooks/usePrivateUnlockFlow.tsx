import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { OnboardModal, type OnboardModalTheme } from '../components/OnboardModal';
import { usePrivacyBridgeUnlock, usePrivacyBridgeWallet } from '../context/privacyBridge/contexts';
import { useWalletType } from './useWalletType';
import type { OnboardingStep } from './useAesKeyProvider';

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
  const { theme, warning, onUnlocked, onRestoreCancelled } = options;
  const unlock = usePrivacyBridgeUnlock();
  const wallet = usePrivacyBridgeWallet();
  const walletTypeInfo = useWalletType();

  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isInstallingSnap, setIsInstallingSnap] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [snapInstallError, setSnapInstallError] = useState<string | null>(null);
  const [snapConnectedInModal, setSnapConnectedInModal] = useState(false);
  const [saveBackup, setSaveBackup] = useState(true);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('idle');
  const [isUnlockInProgress, setIsUnlockInProgress] = useState(false);
  const [pendingUnlockAfterConnect, setPendingUnlockAfterConnect] = useState(false);

  const unlockRequestIdRef = useRef(0);
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);
  const prevWalletAddressRef = useRef(wallet.walletAddress);

  const connectedAddress = wallet.walletAddress || '';
  const isMetaMaskWallet = walletTypeInfo.walletType === 'metamask';
  const usesSnapStorage =
    isMetaMaskWallet && (walletTypeInfo.isMetaMaskWithSnap || snapConnectedInModal);
  const hasConnectedSnap = usesSnapStorage;

  const isActiveUnlockRequest = useCallback(
    (requestId: number) => requestId === unlockRequestIdRef.current,
    [],
  );

  const beginUnlockRequest = useCallback(() => {
    const requestId = unlockRequestIdRef.current + 1;
    unlockRequestIdRef.current = requestId;
    return requestId;
  }, []);

  const dismissOnboardModal = useCallback(() => {
    unlockRequestIdRef.current += 1;
    pendingActionRef.current = null;
    setShowOnboardModal(false);
    setCurrentStep('idle');
    setModalError(null);
    setSnapInstallError(null);
    setIsUnlockInProgress(false);
    setIsUnlocking(false);
  }, []);

  const runPendingAction = useCallback(async () => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (!action) return;
    await action();
  }, []);

  const notifyUnlocked = useCallback(async () => {
    if (onUnlocked) {
      await onUnlocked();
    }
  }, [onUnlocked]);

  useEffect(() => {
    if (usesSnapStorage) {
      setSaveBackup(false);
    }
  }, [usesSnapStorage]);

  useEffect(() => {
    if (!wallet.isConnected) {
      setPendingUnlockAfterConnect(false);
      setSnapConnectedInModal(false);
      setSnapInstallError(null);
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
    setModalError(null);
    setSnapInstallError(null);
    setIsInstallingSnap(true);
    try {
      const connected = await unlock.requestSnapConnection();
      if (!connected) return false;
      setSnapConnectedInModal(true);
      return true;
    } catch (error) {
      setSnapInstallError(
        error instanceof Error ? error.message : 'Could not install COTI Snap.',
      );
      return false;
    } finally {
      setIsInstallingSnap(false);
    }
  }, [unlock]);

  const completeUnlock = useCallback(async (requestId: number) => {
    if (!isActiveUnlockRequest(requestId)) return false;

    setShowOnboardModal(false);
    setIsUnlockInProgress(false);
    await notifyUnlocked();
    await runPendingAction();
    return true;
  }, [isActiveUnlockRequest, notifyUnlocked, runPendingAction]);

  const restorePrivateUnlock = useCallback(async (
    requestId: number,
    pendingAction?: () => void | Promise<void>,
  ): Promise<boolean> => {
    if (pendingAction) {
      pendingActionRef.current = pendingAction;
    }

    setModalError(null);
    setIsUnlocking(true);
    setCurrentStep('restoring-backup');

    try {
      try {
        await unlock.unlockCachedAesKey();
        if (!isActiveUnlockRequest(requestId)) return false;
        return completeUnlock(requestId);
      } catch {
        // No cached session key — continue restore / modal flow.
      }

      let restoreCancelled = false;
      if (await unlock.refreshPrivateBalances({
        restoreOnly: true,
        onRestoreCancelled: () => {
          restoreCancelled = true;
          pendingActionRef.current = null;
          onRestoreCancelled?.();
        },
      })) {
        if (!isActiveUnlockRequest(requestId)) return false;
        return completeUnlock(requestId);
      }

      if (!isActiveUnlockRequest(requestId)) return false;

      if (restoreCancelled) {
        return false;
      }

      setCurrentStep('idle');
      setShowOnboardModal(true);
      return false;
    } catch (error) {
      if (!isActiveUnlockRequest(requestId)) return false;

      setCurrentStep('idle');
      setShowOnboardModal(true);
      const message = error instanceof Error ? error.message : 'Private unlock failed.';
      setModalError(message === 'SNAP_REQUIRED' ? null : message);
      return false;
    } finally {
      if (isActiveUnlockRequest(requestId)) {
        setIsUnlocking(false);
      }
    }
  }, [completeUnlock, isActiveUnlockRequest, onRestoreCancelled, unlock]);

  const unlockPrivateBalances = useCallback(async () => {
    if (!connectedAddress) return false;

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

    const requestId = beginUnlockRequest();
    return restorePrivateUnlock(requestId, pendingAction);
  }, [beginUnlockRequest, connectedAddress, restorePrivateUnlock, unlock.isPrivateUnlocked]);

  const beginOnboarding = useCallback(async () => {
    if (!connectedAddress) return;

    setModalError(null);
    setIsUnlocking(true);
    setCurrentStep('signing-transaction');
    try {
      const ok = await unlock.refreshPrivateBalances({
        forceContractOnboarding: true,
        saveBackup: usesSnapStorage ? false : saveBackup,
        onProgress: setCurrentStep,
      });
      if (!ok) {
        setCurrentStep('idle');
        return;
      }

      setShowOnboardModal(false);
      setCurrentStep('complete');
      setIsUnlockInProgress(false);
      await notifyUnlocked();
      await runPendingAction();
    } catch (error) {
      setCurrentStep('error');
      setModalError(error instanceof Error ? error.message : 'Onboarding failed.');
    } finally {
      setIsUnlocking(false);
    }
  }, [connectedAddress, notifyUnlocked, runPendingAction, saveBackup, unlock, usesSnapStorage]);

  const openUnlockFlow = useCallback(async () => {
    if (!wallet.isConnected) {
      setPendingUnlockAfterConnect(true);
      await wallet.handleConnect();
      return;
    }
    if (unlock.isPrivateUnlocked) {
      setIsUnlockInProgress(false);
      return;
    }
    if (isUnlockInProgress) return;

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
    setPendingUnlockAfterConnect(false);
  }, [dismissOnboardModal]);

  const lockPrivateBalances = useCallback(() => {
    unlock.lockPrivateBalances();
    setPendingUnlockAfterConnect(false);
    dismissOnboardModal();
  }, [dismissOnboardModal, unlock]);

  const onboardModal = (
    <OnboardModal
      isOpen={showOnboardModal}
      onClose={dismissOnboardModal}
      onConfirm={beginOnboarding}
      isLoading={isUnlocking}
      error={modalError}
      walletType={walletTypeInfo.walletType}
      currentStep={currentStep}
      hasSnap={hasConnectedSnap}
      onInstallSnap={connectSnap}
      isInstallingSnap={isInstallingSnap}
      snapError={snapInstallError}
      saveBackup={saveBackup}
      showSaveBackupOption={!usesSnapStorage}
      onSaveBackupChange={setSaveBackup}
      onManualAesKeySubmit={async (aesKey) => {
        await unlock.saveManualAesKey(aesKey);
        setShowOnboardModal(false);
        setIsUnlockInProgress(false);
        await notifyUnlocked();
        await runPendingAction();
      }}
      theme={theme}
      warning={warning ?? null}
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
    sendPrivateToken: unlock.sendPrivateToken,
    refreshPrivateBalances: unlock.refreshPrivateBalances,
    encryptPrivateValue: unlock.encryptPrivateValue,
    decryptPrivateValue: unlock.decryptPrivateValue,
  };
}
