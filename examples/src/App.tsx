import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import {
  configureCotiPlugin,
  usePrivacyBridgeNetwork,
  usePrivacyBridgeSwap,
  usePrivacyBridgeTokens,
  usePrivacyBridgeUnlock,
  usePrivacyBridgeWallet,
  usePrivateUnlockFlow,
  useWalletType,
  type EncryptedAesBackup,
  type OnboardModalTheme,
} from '@coti-io/coti-wallet-plugin';

const ONBOARD_MODAL_THEME: OnboardModalTheme = {
  checkboxText: {
    color: 'rgba(255, 255, 255, 0.86)',
  },
  tooltipButton: {
    color: 'rgba(255, 255, 255, 0.86)',
  },
};

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

const LOCAL_SNAP_ID = import.meta.env.VITE_SNAP_ID?.trim();
const LOCAL_SNAP_VERSION = import.meta.env.VITE_SNAP_VERSION?.trim();
const LOCAL_SNAP_AES_WRITE_ORIGINS =
  (LOCAL_SNAP_ID?.startsWith('local:') || import.meta.env.DEV) && typeof window !== 'undefined'
    ? [window.location.origin]
    : [];

configureCotiPlugin({
  ...(LOCAL_SNAP_ID ? { snapId: LOCAL_SNAP_ID } : {}),
  ...(LOCAL_SNAP_VERSION ? { snapVersion: LOCAL_SNAP_VERSION } : {}),
  aesKeyChainId: COTI_TESTNET_CHAIN_ID,
  additionalSnapAesWriteOrigins: LOCAL_SNAP_AES_WRITE_ORIGINS,
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
  const walletTypeInfo = useWalletType();
  const wallet = usePrivacyBridgeWallet();
  const network = usePrivacyBridgeNetwork();
  const unlock = usePrivacyBridgeUnlock();
  const swap = usePrivacyBridgeSwap();
  const { publicTokens, privateTokens } = usePrivacyBridgeTokens();

  const [cryptoStatus, setCryptoStatus] = useState<string | null>(null);
  const [snapAesKeyStatus, setSnapAesKeyStatus] = useState<SnapAesKeyStatus>('idle');
  const [portalAmount, setPortalAmount] = useState('');
  const [portalTokenIndex, setPortalTokenIndex] = useState(0);
  const [portalStatus, setPortalStatus] = useState<string | null>(null);
  const [privateSendSymbol, setPrivateSendSymbol] = useState('');
  const [privateSendRecipient, setPrivateSendRecipient] = useState('');
  const [privateSendAmount, setPrivateSendAmount] = useState('');
  const [privateSendStatus, setPrivateSendStatus] = useState<string | null>(null);
  const [cryptoAmount, setCryptoAmount] = useState('1.0');
  const [cryptoDecimals, setCryptoDecimals] = useState('18');
  const [cryptoCiphertext, setCryptoCiphertext] = useState('');
  const [cryptoDecrypted, setCryptoDecrypted] = useState('');
  const [unlockStatus, setUnlockStatus] = useState<string | null>(null);

  const privateUnlock = usePrivateUnlockFlow({
    theme: ONBOARD_MODAL_THEME,
    warning:
      'The example dApp never stores or receives the AES key. Onboarding, backup restore, Snap storage, and decrypt/encrypt operations stay inside the plugin.',
    onRestoreCancelled: () => {
      setUnlockStatus('User canceled');
      setCryptoStatus('User canceled');
    },
  });
  const connectedAddress = wallet.walletAddress || address || '';
  const isMetaMaskWallet = walletTypeInfo.walletType === 'metamask';
  const hasConnectedSnap = isMetaMaskWallet && unlock.hasSnap;
  const tokenRows = useMemo(
    () => [
      ...publicTokens.map(token => ({ ...token, type: 'Public' })),
      ...privateTokens.map(token => ({ ...token, type: 'Private' })),
    ],
    [publicTokens, privateTokens],
  );
  const selectedPortalToken = publicTokens[portalTokenIndex] ?? publicTokens[0];
  const privateSendTokens = useMemo(
    () => privateTokens.filter(token => token.addressKey),
    [privateTokens],
  );

  useEffect(() => {
    if (!isConnected) {
      setSnapAesKeyStatus('idle');
    }
  }, [isConnected]);

  useEffect(() => {
    if (portalTokenIndex >= publicTokens.length) setPortalTokenIndex(0);
  }, [portalTokenIndex, publicTokens.length]);

  useEffect(() => {
    if (!privateSendSymbol && privateSendTokens[0]) {
      setPrivateSendSymbol(privateSendTokens[0].symbol);
    }
  }, [privateSendSymbol, privateSendTokens]);

  const refreshSnapAesKeyStatus = useCallback(async () => {
    if (!isConnected || !connectedAddress || !isMetaMaskWallet) {
      setSnapAesKeyStatus('idle');
      return;
    }

    const snapInstalled = unlock.hasSnap || await unlock.checkSnapStatus();
    if (!snapInstalled) {
      setSnapAesKeyStatus('idle');
      return;
    }

    setSnapAesKeyStatus('checking');
    try {
      const saved = await unlock.hasAesKeyInSnap(connectedAddress);
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
    unlock,
  ]);

  useEffect(() => {
    void refreshSnapAesKeyStatus();
  }, [refreshSnapAesKeyStatus]);

  useEffect(() => {
    if (privateUnlock.isPrivateUnlocked) {
      void refreshSnapAesKeyStatus();
    }
  }, [privateUnlock.isPrivateUnlocked, refreshSnapAesKeyStatus, unlock.hasSnap]);

  const performEncryptPrivateValue = useCallback(async () => {
    setCryptoStatus('Encrypting value...');
    setCryptoDecrypted('');
    try {
      const decimals = Number(cryptoDecimals);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
        throw new Error('Decimals must be an integer between 0 and 36.');
      }

      const result = await privateUnlock.encryptPrivateValue({
        amount: cryptoAmount,
        decimals,
      });
      setCryptoCiphertext(result.ciphertext);
      setCryptoStatus('Encrypted ctUint256 payload ready.');
    } catch (error) {
      setCryptoStatus(error instanceof Error ? error.message : 'Encrypt failed.');
    }
  }, [cryptoAmount, cryptoDecimals, privateUnlock]);

  const performDecryptPrivateValue = useCallback(async () => {
    setCryptoStatus('Decrypting value...');
    try {
      const decimals = Number(cryptoDecimals);
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
        throw new Error('Decimals must be an integer between 0 and 36.');
      }

      const result = await privateUnlock.decryptPrivateValue({
        ciphertext: cryptoCiphertext,
        decimals,
      });
      setCryptoDecrypted(result.amount);
      setCryptoStatus('Decrypted amount ready.');
    } catch (error) {
      setCryptoStatus(error instanceof Error ? error.message : 'Decrypt failed.');
    }
  }, [cryptoCiphertext, cryptoDecimals, privateUnlock]);

  const handleDisconnect = useCallback(() => {
    privateUnlock.resetUnlockUi();
    privateUnlock.lockPrivateBalances();
    setSnapAesKeyStatus('idle');
    wallet.handleDisconnect().catch(() => undefined);
  }, [privateUnlock, wallet]);

  const prevConnectedAddressRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const previousAddress = prevConnectedAddressRef.current;
    prevConnectedAddressRef.current = connectedAddress;

    if (
      !previousAddress
      || !connectedAddress
      || previousAddress.toLowerCase() === connectedAddress.toLowerCase()
    ) {
      return;
    }

    setSnapAesKeyStatus('idle');
    setCryptoStatus('Wallet account changed — unlock again for the new address.');
  }, [connectedAddress]);

  const syncSwapForm = useCallback((direction: 'to-private' | 'to-public') => {
    swap.setAmount(portalAmount);
    swap.setDirection(direction);
    swap.setSelectedTokenIndex(portalTokenIndex);
  }, [portalAmount, portalTokenIndex, swap]);

  const onSwapProgress = useCallback<NonNullable<Parameters<typeof swap.handleSwap>[3]>>((stage, txHash) => {
    const label = stage.replace('-', ' ');
    setPortalStatus(txHash ? `${label}: ${txHash}` : label);
  }, []);

  const runPortalSwap = useCallback(async (direction: 'to-private' | 'to-public') => {
    if (!selectedPortalToken) {
      setPortalStatus('No portal token available on this network.');
      return;
    }
    if (direction === 'to-public' && !privateUnlock.isPrivateUnlocked) {
      setPortalStatus('Unlock private balances before portal out.');
      return;
    }

    syncSwapForm(direction);
    setPortalStatus(direction === 'to-private' ? 'Portal in started...' : 'Portal out started...');
    try {
      await swap.handleSwap(portalAmount, direction, portalTokenIndex, onSwapProgress);
      setPortalStatus(direction === 'to-private' ? 'Portal in submitted.' : 'Portal out submitted.');
    } catch (error) {
      setPortalStatus(error instanceof Error ? error.message : 'Portal swap failed.');
    }
  }, [
    onSwapProgress,
    portalAmount,
    portalTokenIndex,
    selectedPortalToken,
    swap,
    syncSwapForm,
    privateUnlock.isPrivateUnlocked,
  ]);

  const approvePortalOut = useCallback(async () => {
    syncSwapForm('to-public');
    setPortalStatus('Approval started...');
    try {
      await swap.handleApprove();
      setPortalStatus('Approval complete.');
    } catch (error) {
      setPortalStatus(error instanceof Error ? error.message : 'Approval failed.');
    }
  }, [swap, syncSwapForm]);

  const sendPrivateToken = useCallback(async () => {
    if (!privateUnlock.isPrivateUnlocked) {
      setPrivateSendStatus('Unlock private balances before private send.');
      return;
    }
    setPrivateSendStatus('Private send started...');
    try {
      const result = await privateUnlock.sendPrivateToken({
        symbol: privateSendSymbol,
        recipient: privateSendRecipient,
        amount: privateSendAmount,
      });
      setPrivateSendStatus(`Private send confirmed: ${result.txHash}`);
    } catch (error) {
      setPrivateSendStatus(error instanceof Error ? error.message : 'Private send failed.');
    }
  }, [
    privateSendAmount,
    privateSendRecipient,
    privateSendSymbol,
    privateUnlock,
  ]);

  const runEncryptPrivateValue = useCallback(async () => {
    if (!cryptoAmount.trim()) {
      setCryptoStatus('Enter an amount to encrypt.');
      return;
    }

    setCryptoStatus('Checking onboarding status...');
    await privateUnlock.ensurePrivateUnlocked(performEncryptPrivateValue);
  }, [cryptoAmount, performEncryptPrivateValue, privateUnlock]);

  const runDecryptPrivateValue = useCallback(async () => {
    if (!cryptoCiphertext.trim()) {
      setCryptoStatus('Paste or generate a ctUint256 ciphertext first.');
      return;
    }

    setCryptoStatus('Checking onboarding status...');
    await privateUnlock.ensurePrivateUnlocked(performDecryptPrivateValue);
  }, [cryptoCiphertext, performDecryptPrivateValue, privateUnlock]);

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
            {!privateUnlock.isPrivateUnlocked ? (
              <button
                onClick={() => {
                  setUnlockStatus(null);
                  void privateUnlock.openUnlockFlow();
                }}
                disabled={privateUnlock.isUnlocking}
                style={{ padding: '8px 16px', cursor: privateUnlock.isUnlocking ? 'wait' : 'pointer' }}
              >
                {privateUnlock.isUnlocking ? 'Unlocking...' : 'Unlock Private Balances'}
              </button>
            ) : (
              <button
                onClick={() => {
                  privateUnlock.lockPrivateBalances();
                  void refreshSnapAesKeyStatus();
                }}
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
          </div>
          {unlockStatus && <p style={{ fontSize: 12, marginTop: 8 }}>{unlockStatus}</p>}
        </div>
      )}

      {isConnected && (
        <section style={{ marginTop: 16, padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
          <h2 style={{ fontSize: 18, marginTop: 0 }}>Encrypt / Decrypt Private Value</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Uses <code>encryptPrivateValue()</code> and <code>decryptPrivateValue()</code> from{' '}
            <code>usePrivacyBridgeUnlock()</code>. If you are not onboarded yet, clicking either
            button opens the onboarding modal first.
          </p>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '2fr 1fr', marginBottom: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>Plain amount</span>
              <input
                value={cryptoAmount}
                onChange={event => setCryptoAmount(event.target.value)}
                placeholder="1.0"
                style={{ padding: 8 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>Decimals</span>
              <input
                value={cryptoDecimals}
                onChange={event => setCryptoDecimals(event.target.value)}
                placeholder="18"
                style={{ padding: 8 }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              onClick={() => void runEncryptPrivateValue()}
              disabled={privateUnlock.isUnlocking}
              style={{ padding: '8px 16px', cursor: privateUnlock.isUnlocking ? 'wait' : 'pointer' }}
            >
              {privateUnlock.isUnlocking ? 'Unlocking...' : 'Encrypt'}
            </button>
            <button
              onClick={() => void runDecryptPrivateValue()}
              disabled={privateUnlock.isUnlocking}
              style={{ padding: '8px 16px', cursor: privateUnlock.isUnlocking ? 'wait' : 'pointer' }}
            >
              {privateUnlock.isUnlocking ? 'Unlocking...' : 'Decrypt'}
            </button>
          </div>

          <label style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: '#555' }}>ctUint256 ciphertext JSON</span>
            <textarea
              value={cryptoCiphertext}
              onChange={event => setCryptoCiphertext(event.target.value)}
              placeholder='{"ciphertextHigh":"...","ciphertextLow":"..."}'
              rows={4}
              style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}
            />
          </label>

          {cryptoDecrypted && (
            <p style={{ fontSize: 12 }}>
              Decrypted amount: <code>{cryptoDecrypted}</code>
            </p>
          )}
          {cryptoStatus && <p style={{ fontSize: 12 }}>{cryptoStatus}</p>}
        </section>
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
                  {token.isPrivate && !privateUnlock.isPrivateUnlocked ? 'Locked' : token.balance}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isConnected && (
        <section style={{ marginTop: 24, padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
          <h2 style={{ fontSize: 18, marginTop: 0 }}>Portal In / Portal Out</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Uses <code>usePrivacyBridgeSwap()</code>. Portal in moves public token balance to private.
            Portal out moves private balance back to public and may need private approval first.
          </p>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr', marginBottom: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>Token</span>
              <select
                value={portalTokenIndex}
                onChange={event => setPortalTokenIndex(Number(event.target.value))}
                style={{ padding: 8 }}
              >
                {publicTokens.map((token, index) => (
                  <option key={token.symbol} value={index}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>Amount</span>
              <input
                value={portalAmount}
                onChange={event => setPortalAmount(event.target.value)}
                placeholder="0.1"
                style={{ padding: 8 }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => void runPortalSwap('to-private')}
              disabled={swap.isBridgingLoading || !portalAmount}
              style={{ padding: '8px 16px', cursor: swap.isBridgingLoading ? 'wait' : 'pointer' }}
            >
              Portal In
            </button>
            <button
              onClick={() => void runPortalSwap('to-public')}
              disabled={swap.isBridgingLoading || !portalAmount || !privateUnlock.isPrivateUnlocked}
              style={{ padding: '8px 16px', cursor: swap.isBridgingLoading ? 'wait' : 'pointer' }}
            >
              Portal Out
            </button>
            {swap.isApprovalNeeded && (
              <button
                onClick={() => void approvePortalOut()}
                disabled={swap.isApproving || !privateUnlock.isPrivateUnlocked}
                style={{ padding: '8px 16px', cursor: swap.isApproving ? 'wait' : 'pointer' }}
              >
                {swap.isApproving ? 'Approving...' : 'Approve Private Spend'}
              </button>
            )}
          </div>

          <p style={{ fontSize: 12, color: '#666' }}>
            Selected: {selectedPortalToken?.symbol ?? 'None'} | Estimated gas:{' '}
            {swap.isGasEstimating ? 'estimating...' : swap.estimatedGasFee ?? 'n/a'} | Portal fee:{' '}
            {swap.portalFeeCoti ?? 'n/a'} COTI
          </p>
          {portalStatus && <p style={{ fontSize: 12 }}>{portalStatus}</p>}
        </section>
      )}

      {isConnected && (
        <section style={{ marginTop: 16, padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
          <h2 style={{ fontSize: 18, marginTop: 0 }}>Send Private Token</h2>
          <p style={{ fontSize: 13, color: '#666' }}>
            Uses <code>usePrivacyBridgeUnlock().sendPrivateToken()</code>. The example does not
            implement regular public-token send because that is standard wallet/app code, not plugin
            behavior.
          </p>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 2fr 1fr', marginBottom: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>Private token</span>
              <select
                value={privateSendSymbol}
                onChange={event => setPrivateSendSymbol(event.target.value)}
                style={{ padding: 8 }}
              >
                {privateSendTokens.map(token => (
                  <option key={token.symbol} value={token.symbol}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>Recipient</span>
              <input
                value={privateSendRecipient}
                onChange={event => setPrivateSendRecipient(event.target.value)}
                placeholder="0x..."
                style={{ padding: 8 }}
              />
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#555' }}>Amount</span>
              <input
                value={privateSendAmount}
                onChange={event => setPrivateSendAmount(event.target.value)}
                placeholder="0.1"
                style={{ padding: 8 }}
              />
            </label>
          </div>

          <button
            onClick={() => void sendPrivateToken()}
            disabled={!privateUnlock.isPrivateUnlocked || !privateSendSymbol || !privateSendRecipient || !privateSendAmount}
            style={{ padding: '8px 16px', cursor: privateUnlock.isPrivateUnlocked ? 'pointer' : 'not-allowed' }}
          >
            Send Private Token
          </button>
          {privateSendStatus && <p style={{ fontSize: 12 }}>{privateSendStatus}</p>}
        </section>
      )}

      {privateUnlock.onboardModal}
    </div>
  );
}
