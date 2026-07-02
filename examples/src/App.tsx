import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import {
  configureCotiPlugin,
  OnboardModal,
  usePrivacyBridgeNetwork,
  usePrivacyBridgeTokens,
  usePrivacyBridgeUnlock,
  usePrivacyBridgeWallet,
  useWalletType,
  type EncryptedAesBackup,
  type OnboardingStep,
} from '@coti-io/coti-wallet-plugin';

const COTI_TESTNET_CHAIN_ID = 7082400;
const COTI_MAINNET_CHAIN_ID = 2632500;

const AES_BACKUP_API_URL = import.meta.env.VITE_AES_BACKUP_API_URL?.replace(/\/$/, '');
const GRANT_API_URL_BY_CHAIN: Record<number, string | undefined> = {
  [COTI_TESTNET_CHAIN_ID]: normalizeGrantApiUrl(import.meta.env.VITE_GRANT_API_URL_TESTNET),
  [COTI_MAINNET_CHAIN_ID]: normalizeGrantApiUrl(import.meta.env.VITE_GRANT_API_URL_MAINNET),
};
const HAS_GRANT_API_URL = Object.values(GRANT_API_URL_BY_CHAIN).some(Boolean);
const ONBOARDING_GRANT_MIN_BALANCE_COTI =
  import.meta.env.VITE_ONBOARDING_GRANT_MIN_BALANCE_COTI ?? '0.2';

function normalizeGrantApiUrl(url: string | undefined): string | undefined {
  return url?.replace(/\/$/, '');
}

const backupKey = (address: string, chainId: number) =>
  `coti-example:aes-backup:${chainId}:${address.toLowerCase()}`;

const backupApiUrl = (address: string, chainId: number) =>
  `${AES_BACKUP_API_URL}/aes-backups/${chainId}/${address.toLowerCase()}`;

const fetchEncryptedAesBackup = async (address: string, chainId: number) => {
  const raw = window.localStorage.getItem(backupKey(address, chainId));
  if (AES_BACKUP_API_URL) {
    const response = await fetch(backupApiUrl(address, chainId));
    if (response.status === 404) return raw ? JSON.parse(raw) as EncryptedAesBackup : null;
    if (!response.ok) throw new Error(`Backup restore failed: ${response.status}`);
    return response.json() as Promise<EncryptedAesBackup>;
  }
  return raw ? JSON.parse(raw) as EncryptedAesBackup : null;
};

const saveEncryptedAesBackup = async (
  address: string,
  chainId: number,
  backup: EncryptedAesBackup,
  action: 'save' | 'replace' = 'save',
) => {
  if (AES_BACKUP_API_URL) {
    const response = await fetch(backupApiUrl(address, chainId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(backup),
    });
    if (!response.ok) throw new Error(`Backup ${action} failed: ${response.status}`);
  }
  window.localStorage.setItem(backupKey(address, chainId), JSON.stringify(backup));
};

configureCotiPlugin({
  debug: true,
  onboardingGrantMinBalanceWei: (
    BigInt(Math.trunc(Number(ONBOARDING_GRANT_MIN_BALANCE_COTI) * 1e6)) *
    10n ** 12n
  ).toString(),
  onboardingServices: {
    mode: 'custom',
    fetchEncryptedAesBackup: async ({ address, chainId }) =>
      fetchEncryptedAesBackup(address, chainId),
    saveEncryptedAesBackup: async ({ address, chainId, backup }) =>
      saveEncryptedAesBackup(address, chainId, backup, 'save'),
    replaceEncryptedAesBackup: async ({ address, chainId, backup }) =>
      saveEncryptedAesBackup(address, chainId, backup, 'replace'),
    grantNativeCoti: HAS_GRANT_API_URL
      ? async ({ address, chainId }) => {
          const grantApiUrl = GRANT_API_URL_BY_CHAIN[chainId];
          if (!grantApiUrl) return { status: 'skipped' };
          const response = await fetch(grantApiUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ address, chainId }),
          });
          if (!response.ok) return { status: 'skipped' };
          return response.json();
        }
      : undefined,
  },
});

type SnapAesKeyStatus = 'idle' | 'checking' | 'saved' | 'missing' | 'unknown';

function snapAesKeyStatusLabel(status: SnapAesKeyStatus): string {
  switch (status) {
    case 'checking':
      return 'Checking…';
    case 'saved':
      return 'Saved in Snap';
    case 'missing':
      return 'Not saved in Snap';
    case 'unknown':
      return 'Could not check Snap';
    default:
      return '';
  }
}

function snapAesKeyStatusColor(status: SnapAesKeyStatus): string {
  switch (status) {
    case 'saved':
      return '#0a7a3e';
    case 'missing':
      return '#b45309';
    case 'unknown':
      return '#666';
    default:
      return '#666';
  }
}

export default function App() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const walletTypeInfo = useWalletType();
  const wallet = usePrivacyBridgeWallet();
  const network = usePrivacyBridgeNetwork();
  const unlock = usePrivacyBridgeUnlock();
  const { publicTokens, privateTokens } = usePrivacyBridgeTokens();

  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isInstallingSnap, setIsInstallingSnap] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [snapInstallError, setSnapInstallError] = useState<string | null>(null);
  const [snapConnectedInModal, setSnapConnectedInModal] = useState(false);
  const [saveBackup, setSaveBackup] = useState(true);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('idle');
  const [snapAesKeyStatus, setSnapAesKeyStatus] = useState<SnapAesKeyStatus>('idle');

  const connectedAddress = wallet.walletAddress || address || '';
  const isMetaMaskWallet = walletTypeInfo.walletType === 'metamask';
  const hasConnectedSnap =
    isMetaMaskWallet && (walletTypeInfo.isMetaMaskWithSnap || snapConnectedInModal);
  const tokenRows = useMemo(
    () => [
      ...publicTokens.map(token => ({ ...token, type: 'Public' })),
      ...privateTokens.map(token => ({ ...token, type: 'Private' })),
    ],
    [publicTokens, privateTokens],
  );

  useEffect(() => {
    if (!isConnected) {
      setSnapConnectedInModal(false);
      setSnapInstallError(null);
      setSnapAesKeyStatus('idle');
    }
  }, [isConnected]);

  const refreshSnapAesKeyStatus = useCallback(async () => {
    if (!isConnected || !connectedAddress || !isMetaMaskWallet) {
      setSnapAesKeyStatus('idle');
      return;
    }

    if (!walletTypeInfo.isMetaMaskWithSnap && !snapConnectedInModal) {
      setSnapAesKeyStatus('idle');
      return;
    }

    setSnapAesKeyStatus('checking');
    try {
      const saved = await unlock.hasAesKeyInSnap();
      if (saved === true) setSnapAesKeyStatus('saved');
      else if (saved === false) setSnapAesKeyStatus('missing');
      else setSnapAesKeyStatus('unknown');
    } catch {
      setSnapAesKeyStatus('unknown');
    }
  }, [
    connectedAddress,
    isConnected,
    isMetaMaskWallet,
    snapConnectedInModal,
    unlock,
    walletTypeInfo.isMetaMaskWithSnap,
  ]);

  useEffect(() => {
    void refreshSnapAesKeyStatus();
  }, [refreshSnapAesKeyStatus]);

  const unlockPrivateBalances = useCallback(async () => {
    if (!connectedAddress) return;

    setModalError(null);
    setIsUnlocking(true);
    setCurrentStep('restoring-backup');
    try {
      const ok = await unlock.refreshPrivateBalances({ restoreOnly: true });
      if (ok) {
        setShowOnboardModal(false);
        await refreshSnapAesKeyStatus();
        return;
      }
      setCurrentStep('idle');
      setShowOnboardModal(true);
    } catch (error) {
      setCurrentStep('idle');
      setShowOnboardModal(true);
      const message = error instanceof Error ? error.message : 'Private unlock failed.';
      setModalError(message === 'SNAP_REQUIRED' ? null : message);
    } finally {
      setIsUnlocking(false);
    }
  }, [connectedAddress, unlock, refreshSnapAesKeyStatus]);

  const beginOnboarding = useCallback(async () => {
    if (!connectedAddress) return;

    setModalError(null);
    setIsUnlocking(true);
    setCurrentStep('signing-transaction');
    try {
      const ok = await unlock.refreshPrivateBalances({
        forceContractOnboarding: true,
        saveBackup,
        onProgress: setCurrentStep,
      });
      if (!ok) {
        setCurrentStep('idle');
        return;
      }
      setShowOnboardModal(false);
      setCurrentStep('complete');
      await refreshSnapAesKeyStatus();
    } catch (error) {
      setCurrentStep('error');
      setModalError(error instanceof Error ? error.message : 'Onboarding failed.');
    } finally {
      setIsUnlocking(false);
    }
  }, [connectedAddress, saveBackup, unlock, refreshSnapAesKeyStatus]);

  const connectSnap = useCallback(async () => {
    setModalError(null);
    setSnapInstallError(null);
    setIsInstallingSnap(true);
    try {
      const connected = await unlock.requestSnapConnection();
      if (!connected) return false;
      setSnapConnectedInModal(true);
      await refreshSnapAesKeyStatus();
      return true;
    } catch (error) {
      setSnapInstallError(error instanceof Error ? error.message : 'Could not install COTI Snap.');
      return false;
    } finally {
      setIsInstallingSnap(false);
    }
  }, [unlock, refreshSnapAesKeyStatus]);

  const lockPrivateBalances = useCallback(() => {
    unlock.lockPrivateBalances();
    setShowOnboardModal(false);
    setCurrentStep('idle');
    setModalError(null);
    setSnapInstallError(null);
    setSnapAesKeyStatus('idle');
  }, [unlock]);

  const handleDisconnect = useCallback(() => {
    lockPrivateBalances();
    setSnapConnectedInModal(false);
    wallet.handleDisconnect().catch(() => undefined);
    disconnect();
  }, [disconnect, lockPrivateBalances, wallet]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>COTI Wallet Plugin - Example dApp</h1>

      {!isConnected ? (
        <button
          onClick={openConnectModal}
          style={{ padding: '10px 20px', fontSize: 16, cursor: 'pointer' }}
        >
          Connect Wallet
        </button>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <p>
            Connected: <code>{connectedAddress}</code>
          </p>
          <p>Network: {network.networkName || network.chainId || 'Unknown'}</p>
          <p style={{ fontSize: 12, color: '#666' }}>
            Wallet: {walletTypeInfo.walletType}
            {hasConnectedSnap ? ' (COTI Snap connected)' : ''}
          </p>
          {hasConnectedSnap && snapAesKeyStatus !== 'idle' && (
            <p style={{ fontSize: 12, color: snapAesKeyStatusColor(snapAesKeyStatus) }}>
              Snap AES key: {snapAesKeyStatusLabel(snapAesKeyStatus)}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {!unlock.isPrivateUnlocked ? (
              <button
                onClick={unlockPrivateBalances}
                disabled={isUnlocking}
                style={{ padding: '8px 16px', cursor: isUnlocking ? 'wait' : 'pointer' }}
              >
                {isUnlocking ? 'Unlocking...' : 'Unlock Private Balances'}
              </button>
            ) : (
              <button
                onClick={lockPrivateBalances}
                style={{ padding: '8px 16px', cursor: 'pointer' }}
              >
                Lock Private Balances
              </button>
            )}
            <button
              onClick={handleDisconnect}
              style={{ padding: '8px 16px', cursor: 'pointer' }}
            >
              Disconnect
            </button>
            {modalError && (
              <span style={{ color: 'red', fontSize: 12 }}>
                {modalError}
              </span>
            )}
          </div>
        </div>
      )}

      {isConnected && (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: 16,
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>Symbol</th>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {tokenRows.map(token => (
              <tr key={`${token.type}:${token.symbol}`} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8, fontWeight: 600 }}>{token.symbol}</td>
                <td style={{ padding: 8 }}>{token.name}</td>
                <td style={{ padding: 8 }}>{token.type}</td>
                <td style={{ padding: 8, fontFamily: 'monospace' }}>
                  {token.isPrivate && !unlock.isPrivateUnlocked ? 'Locked' : token.balance}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <OnboardModal
        isOpen={showOnboardModal}
        onClose={() => {
          setShowOnboardModal(false);
          setCurrentStep('idle');
          setModalError(null);
          setSnapInstallError(null);
        }}
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
        onSaveBackupChange={setSaveBackup}
        onManualAesKeySubmit={unlock.saveManualAesKey}
        warning="The example dApp never stores or receives the AES key. Onboarding, backup restore, Snap storage, and decrypt/encrypt operations stay inside the plugin."
      />
    </div>
  );
}
