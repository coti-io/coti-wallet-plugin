import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAccount, useBalance, useReadContracts, useDisconnect, useSwitchChain } from 'wagmi';
import { formatUnits } from 'viem';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { BrowserProvider } from 'ethers';
import {
  configureCotiPlugin,
  useWalletType,
  useAesKeyProvider,
  usePrivateTokenBalance,
  OnboardModal,
  ERC20_ABI,
  normalizeAesKey,
  encryptAesKeyBackup,
  type EncryptedAesBackup,
  type OnboardingStep,
} from '@coti-io/coti-wallet-plugin';

// --- Types ---

interface TokenEntry {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI: string;
  private: boolean;
}

interface TokenListResponse {
  tokens: TokenEntry[];
}

// --- Constants ---

const TOKEN_LIST_URL =
  'https://raw.githubusercontent.com/coti-io/coti-token-list/coti-testnet/coti-tokens.json';

// COTI Testnet chain ID — app only shows tokens for this chain
const COTI_TESTNET_CHAIN_ID = 7082400;
const COTI_MAINNET_CHAIN_ID = 2632500;

// p.COTI legacy contract uses version 64; all other private tokens use 256
const PCOTI_ADDRESS = '0x6cE8907414986E73De9e7D28d62Ea2080F8E88E1';
const AES_BACKUP_API_URL = import.meta.env.VITE_AES_BACKUP_API_URL?.replace(/\/$/, '');
const GRANT_API_URL_BY_CHAIN: Record<number, string | undefined> = {
  [COTI_TESTNET_CHAIN_ID]: normalizeGrantApiUrl(
    import.meta.env.VITE_GRANT_API_URL_TESTNET,
  ),
  [COTI_MAINNET_CHAIN_ID]: normalizeGrantApiUrl(
    import.meta.env.VITE_GRANT_API_URL_MAINNET,
  ),
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
  // Local example only: wait until the wallet has enough testnet COTI to pay
  // the onboarding transaction gas before calling generateOrRecoverAes().
  onboardingGrantMinBalanceWei: (BigInt(Math.trunc(Number(ONBOARDING_GRANT_MIN_BALANCE_COTI) * 1e6)) * 10n ** 12n).toString(),
  onboardingServices: {
    mode: 'custom',
    fetchEncryptedAesBackup: async ({ address, chainId }) => {
      return fetchEncryptedAesBackup(address, chainId);
    },
    saveEncryptedAesBackup: async ({ address, chainId, backup }) => {
      return saveEncryptedAesBackup(address, chainId, backup, 'save');
    },
    replaceEncryptedAesBackup: async ({ address, chainId, backup }) => {
      return saveEncryptedAesBackup(address, chainId, backup, 'replace');
    },
    grantNativeCoti:
      HAS_GRANT_API_URL
        ? async ({ address, chainId }) => {
            const grantApiUrl = GRANT_API_URL_BY_CHAIN[chainId];
            if (!grantApiUrl) {
              return { status: 'skipped' };
            }
            const response = await fetch(grantApiUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ address, chainId }),
            });
            if (!response.ok) {
              return { status: 'skipped' };
            }
            return response.json();
          }
        : undefined,
  },
});

// Minimal ERC20 balanceOf ABI for wagmi useReadContracts
const erc20BalanceOfAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// --- App ---

export default function App() {
  const { address, isConnected, chainId, connector } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();

  // Wallet type detection & AES key provider (routes Snap vs onboard contract)
  const { getAesKey, isOnboarding, onboardingError, onboardingWarning, currentStep, onboardingDebugTrace } = useAesKeyProvider(walletTypeInfo);
  const { fetchPrivateBalance } = usePrivateTokenBalance();

  // Session AES key state
  const [sessionAesKey, setSessionAesKey] = useState<string | null>(null);
  const isPrivateUnlocked = sessionAesKey !== null;

  // Modal state
  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('idle');
  const [retrievedAesKey, setRetrievedAesKey] = useState<string | null>(null);
  const [saveAesBackup, setSaveAesBackup] = useState(true);
  const [manualAesWarning, setManualAesWarning] = useState<string | null>(null);

  // Unlock: restore backup first; show onboarding only when no saved key exists.
  const unlockPrivateBalances = useCallback(async () => {
    if (!address) return;
    // Ensure wallet is on COTI Testnet before showing modal
    if (chainId !== COTI_TESTNET_CHAIN_ID) {
      try {
        await switchChainAsync({ chainId: COTI_TESTNET_CHAIN_ID });
      } catch (err) {
        console.error('Failed to switch to COTI Testnet:', err);
        return;
      }
    }
    let restoreCancelled = false;
    const restoredKey = await getAesKey(address, setOnboardingStep, {
      restoreOnly: true,
      onRestoreCancelled: () => {
        restoreCancelled = true;
      },
    });
    if (restoredKey) {
      setSessionAesKey(restoredKey);
      setOnboardingStep('idle');
      return;
    }
    if (restoreCancelled) {
      setOnboardingStep('idle');
      return;
    }
    setOnboardingStep('idle');
    setShowOnboardModal(true);
  }, [address, chainId, getAesKey, switchChainAsync]);

  // Begin onboarding (called from modal's "Begin Onboarding" button)
  const beginOnboarding = useCallback(async () => {
    if (!address) return;
    setManualAesWarning(null);
    try {
      const key = await getAesKey(address, setOnboardingStep, { saveBackup: saveAesBackup });
      if (key) {
        setRetrievedAesKey(key);
        // Don't set sessionAesKey yet — let user see success screen and copy key
      }
    } catch (err) {
      console.error('Failed to retrieve AES key:', err);
    }
  }, [address, getAesKey, saveAesBackup]);

  const saveManualAesKey = useCallback(async (
    aesKey: string,
    options: { saveBackup: boolean } = { saveBackup: saveAesBackup },
  ) => {
    let key: string;
    try {
      key = normalizeAesKey(aesKey.trim());
    } catch {
      throw new Error('AES key must be 32 hexadecimal characters.');
    }

    setManualAesWarning(null);
    if (options.saveBackup) {
      try {
        if (!address || !connector) throw new Error('Connect your wallet first.');
        const walletProvider = await connector.getProvider() as any;
        const provider = new BrowserProvider(walletProvider);
        const signer = await provider.getSigner(address);
        const backup = await encryptAesKeyBackup(key, signer, {
          address,
          chainId: COTI_TESTNET_CHAIN_ID,
        });
        await saveEncryptedAesBackup(address, COTI_TESTNET_CHAIN_ID, backup, 'save');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Encrypted AES backup could not be saved.';
        console.error('Manual AES key backup failed:', err);
        setManualAesWarning(`AES key accepted, but encrypted backup was not saved. ${message}`);
      }
    }

    setSessionAesKey(key);
    setShowOnboardModal(false);
    setOnboardingStep('idle');
    setRetrievedAesKey(null);
  }, [address, connector, saveAesBackup]);

  // Close modal and finalize (called from success screen's "Done" button)
  const closeModal = useCallback(() => {
    setShowOnboardModal(false);
    if (retrievedAesKey) {
      setSessionAesKey(retrievedAesKey);
    }
    // Reset modal state
    setOnboardingStep('idle');
    setRetrievedAesKey(null);
    setManualAesWarning(null);
  }, [retrievedAesKey]);

  // Lock: clear session key
  const lockPrivateBalances = useCallback(() => {
    setSessionAesKey(null);
  }, []);

  // Token list from remote
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);

  // Private balances keyed by address
  const [privateBalances, setPrivateBalances] = useState<Record<string, string>>({});
  const [loadingPrivate, setLoadingPrivate] = useState(false);

  // --- Fetch token list ---
  useEffect(() => {
    fetch(TOKEN_LIST_URL)
      .then((res) => res.json())
      .then((data: TokenListResponse) => {
        setTokens(data.tokens);
        setLoadingTokens(false);
      })
      .catch((err) => {
        console.error('Failed to fetch token list:', err);
        setLoadingTokens(false);
      });
  }, []);

  // Filter tokens for COTI Testnet only (memoized to keep stable references)
  const chainTokens = useMemo(
    () => tokens.filter((t) => t.chainId === COTI_TESTNET_CHAIN_ID),
    [tokens]
  );
  const publicTokens = useMemo(() => chainTokens.filter((t) => !t.private), [chainTokens]);
  const privateTokens = useMemo(() => chainTokens.filter((t) => t.private), [chainTokens]);

  // --- Native COTI balance ---
  const { data: nativeBalance } = useBalance({
    address: address,
    chainId: COTI_TESTNET_CHAIN_ID,
    query: { enabled: isConnected },
  });

  // --- Public ERC20 balances via useReadContracts ---
  const publicContracts = publicTokens.map((t) => ({
    address: t.address as `0x${string}`,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf' as const,
    args: [address!] as const,
    chainId: COTI_TESTNET_CHAIN_ID,
  }));

  const { data: publicBalancesData } = useReadContracts({
    contracts: publicContracts,
    query: { enabled: isConnected && publicContracts.length > 0 },
  });

  // --- Fetch private balances when AES key is available ---
  const fetchAllPrivateBalances = useCallback(async () => {
    if (!address || !sessionAesKey || privateTokens.length === 0) return;
    setLoadingPrivate(true);
    const results: Record<string, string> = {};
    for (const token of privateTokens) {
      try {
        const version =
          token.address.toLowerCase() === PCOTI_ADDRESS.toLowerCase() ? 64 : 256;
        const bal = await fetchPrivateBalance(
          address,
          sessionAesKey,
          token.address,
          version,
          token.decimals
        );
        results[token.address] = bal;
      } catch (err) {
        console.error(`Error fetching private balance for ${token.symbol}:`, err);
        results[token.address] = 'Error';
      }
    }
    setPrivateBalances(results);
    setLoadingPrivate(false);
  }, [address, sessionAesKey, privateTokens, fetchPrivateBalance]);

  useEffect(() => {
    if (isPrivateUnlocked) {
      fetchAllPrivateBalances();
    } else {
      setPrivateBalances({});
    }
  }, [isPrivateUnlocked, fetchAllPrivateBalances]);

  // Sync onboarding step from hook to local state
  useEffect(() => {
    setOnboardingStep(currentStep);
  }, [currentStep]);

  // --- Render ---
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>COTI Wallet Plugin — Example</h1>

      {/* Connection */}
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
            Connected: <code>{address}</code>
          </p>
          <p>Chain ID: {chainId}</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!isPrivateUnlocked ? (
              <button
                onClick={unlockPrivateBalances}
                disabled={isOnboarding}
                style={{ padding: '8px 16px', cursor: isOnboarding ? 'wait' : 'pointer' }}
              >
                {isOnboarding ? '⏳ Signing...' : '🔓 Unlock Private Balances'}
              </button>
            ) : (
              <button
                onClick={lockPrivateBalances}
                style={{ padding: '8px 16px', cursor: 'pointer' }}
              >
                🔒 Lock Private Balances
              </button>
            )}
            <button
              onClick={() => wagmiDisconnect()}
              style={{ padding: '8px 16px', cursor: 'pointer' }}
            >
              Disconnect
            </button>
            {onboardingError && (
              <span style={{ color: 'red', fontSize: 12 }}>{onboardingError}</span>
            )}
          </div>
          <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
            Wallet: {walletTypeInfo.walletType} {walletTypeInfo.isMetaMaskWithSnap ? '(Snap)' : '(Contract onboarding)'}
          </p>
        </div>
      )}

      {/* Token Balances */}
      {isConnected && (
        <>
          {loadingTokens ? (
            <p>Loading token list...</p>
          ) : chainTokens.length === 0 ? (
            <p>No tokens found for COTI Testnet.</p>
          ) : (
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
                {/* Native COTI */}
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>COTI</td>
                  <td style={{ padding: 8 }}>COTI (Native)</td>
                  <td style={{ padding: 8 }}>Native</td>
                  <td style={{ padding: 8, fontFamily: 'monospace' }}>
                    {nativeBalance
                      ? formatUnits(nativeBalance.value, nativeBalance.decimals)
                      : '—'}
                  </td>
                </tr>

                {/* Public ERC20 tokens */}
                {publicTokens.map((token, i) => (
                  <tr key={token.address} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: 8, fontWeight: 600 }}>{token.symbol}</td>
                    <td style={{ padding: 8 }}>{token.name}</td>
                    <td style={{ padding: 8 }}>Public</td>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>
                      {publicBalancesData?.[i]?.result != null
                        ? formatUnits(publicBalancesData[i].result as bigint, token.decimals)
                        : '—'}
                    </td>
                  </tr>
                ))}

                {/* Private tokens */}
                {privateTokens.map((token) => (
                  <tr key={token.address} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: 8, fontWeight: 600 }}>{token.symbol}</td>
                    <td style={{ padding: 8 }}>{token.name}</td>
                    <td style={{ padding: 8 }}>🔒 Private</td>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>
                      {!isPrivateUnlocked
                        ? 'Locked'
                        : loadingPrivate
                          ? 'Loading...'
                          : privateBalances[token.address] ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* Onboarding Modal */}
      <OnboardModal
        isOpen={showOnboardModal}
        onClose={closeModal}
        onConfirm={beginOnboarding}
        isLoading={isOnboarding}
        error={onboardingError}
        walletType={walletTypeInfo.walletType}
        currentStep={onboardingStep}
        aesKey={retrievedAesKey}
        hasSnap={walletTypeInfo.isMetaMaskWithSnap}
        debugTrace={onboardingDebugTrace}
        saveBackup={saveAesBackup}
        onSaveBackupChange={setSaveAesBackup}
        onManualAesKeySubmit={saveManualAesKey}
        warning={manualAesWarning || onboardingWarning}
      />
    </div>
  );
}
