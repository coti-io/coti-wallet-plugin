import { useEffect, useState, useCallback } from 'react';
import { useAccount, useBalance, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import {
  useWallet,
  usePrivateTokenBalance,
  ERC20_ABI,
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

// p.COTI legacy contract uses version 64; all other private tokens use 256
const PCOTI_ADDRESS = '0x6cE8907414986E73De9e7D28d62Ea2080F8E88E1';

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
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const {
    sessionAesKey,
    isPrivateUnlocked,
    unlockPrivateBalances,
    lockPrivateBalances,
    disconnect,
  } = useWallet();
  const { fetchPrivateBalance } = usePrivateTokenBalance();

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

  // Filter tokens for the current chain
  const chainTokens = tokens.filter((t) => t.chainId === chainId);
  const publicTokens = chainTokens.filter((t) => !t.private && t.address !== '');
  const privateTokens = chainTokens.filter((t) => t.private);
  const nativeToken = chainTokens.find((t) => !t.private && t.address === '');

  // --- Native COTI balance ---
  const { data: nativeBalance } = useBalance({
    address: address,
    query: { enabled: isConnected },
  });

  // --- Public ERC20 balances via useReadContracts ---
  const publicContracts = publicTokens.map((t) => ({
    address: t.address as `0x${string}`,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf' as const,
    args: [address!] as const,
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
          <div style={{ display: 'flex', gap: 8 }}>
            {!isPrivateUnlocked ? (
              <button
                onClick={unlockPrivateBalances}
                style={{ padding: '8px 16px', cursor: 'pointer' }}
              >
                🔓 Unlock Private Balances
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
              onClick={disconnect}
              style={{ padding: '8px 16px', cursor: 'pointer' }}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {/* Token Balances */}
      {isConnected && (
        <>
          {loadingTokens ? (
            <p>Loading token list...</p>
          ) : chainTokens.length === 0 ? (
            <p>No tokens found for chain {chainId}. Switch to COTI Testnet (7082400).</p>
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
                {nativeToken && (
                  <tr style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: 8, fontWeight: 600 }}>{nativeToken.symbol}</td>
                    <td style={{ padding: 8 }}>{nativeToken.name}</td>
                    <td style={{ padding: 8 }}>Native</td>
                    <td style={{ padding: 8, fontFamily: 'monospace' }}>
                      {nativeBalance
                        ? formatUnits(nativeBalance.value, nativeBalance.decimals)
                        : '—'}
                    </td>
                  </tr>
                )}

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
    </div>
  );
}
