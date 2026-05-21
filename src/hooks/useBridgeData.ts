import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, BRIDGE_ABI, BRIDGE_ERC20_ABI, ERC20_ABI, SUPPORTED_TOKENS } from '../contracts/config';
import { fetchBridgeFees, BridgeFees } from './useBridgeFees';

export interface BridgeData extends BridgeFees {
  bridgeName: string;
  bridgeAddress: string;
  publicToken: string;
  publicTokenIcon: string;
  privateToken: string;
  privateTokenIcon: string;
  minDepositAmount: string;
  maxDepositAmount: string;
  minWithdrawAmount: string;
  maxWithdrawAmount: string;
  accumulatedFees: string;
  accumulatedCotiFees: string;
  nativeCotiFee: string;
  bridgeBalance: string;
  isPaused: boolean;
  tokenDecimals: number;
  isLoading: boolean;
  error: string | null;
}

export const useBridgeData = (chainId: number) => {
  const [bridgesData, setBridgesData] = useState<BridgeData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  useEffect(() => {
    const fetchBridgeData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const rpcUrl = chainId === 7082400
          ? 'https://testnet.coti.io/rpc'
          : 'https://mainnet.coti.io/rpc';

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const addresses = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES];

        if (!addresses) {
          throw new Error(`Unsupported chain ID: ${chainId}`);
        }

        const bridges: BridgeData[] = [];

        const bridgeTokens = SUPPORTED_TOKENS.filter(
          token => !token.isPrivate && token.bridgeAddressKey
        );

        for (const token of bridgeTokens) {
          if (!token.bridgeAddressKey) continue;

          const bridgeAddress = addresses[token.bridgeAddressKey as keyof typeof addresses] as string;

          if (!bridgeAddress || bridgeAddress === '') {
            console.warn(`Bridge address not found for ${token.symbol}`);
            continue;
          }

          try {
            const isNative = token.symbol === 'COTI';
            const abi = isNative ? BRIDGE_ABI : BRIDGE_ERC20_ABI;
            const contract = new ethers.Contract(bridgeAddress, abi, provider);

            const tokenAddress = token.addressKey
              ? addresses[token.addressKey as keyof typeof addresses] as string
              : null;

            const balancePromise = isNative
              ? contract.getBridgeBalance().catch(() => '0')
              : tokenAddress
                ? new ethers.Contract(tokenAddress, ERC20_ABI, provider)
                    .balanceOf(bridgeAddress).catch(() => '0')
                : Promise.resolve('0');

            const [fees, accCotiFees, paused, balance, minDeposit, maxDeposit, minWithdraw, maxWithdraw] = await Promise.all([
              fetchBridgeFees(bridgeAddress, isNative, provider),
              contract.accumulatedCotiFees().catch(() => '0'),
              contract.paused().catch(() => false),
              balancePromise,
              contract.minDepositAmount().catch(() => '0'),
              contract.maxDepositAmount().catch(() => '0'),
              contract.minWithdrawAmount().catch(() => '0'),
              contract.maxWithdrawAmount().catch(() => '0'),
            ]);

            const privateToken = SUPPORTED_TOKENS.find(
              t => t.isPrivate && t.bridgeAddressKey === token.bridgeAddressKey
            );

            bridges.push({
              bridgeName: `${token.symbol} Bridge`,
              bridgeAddress,
              publicToken: token.symbol,
              publicTokenIcon: token.icon,
              privateToken: privateToken?.symbol || 'N/A',
              privateTokenIcon: privateToken?.icon || '',
              ...fees,
              minDepositAmount: ethers.formatUnits(minDeposit, token.decimals),
              maxDepositAmount: ethers.formatUnits(maxDeposit, token.decimals),
              minWithdrawAmount: ethers.formatUnits(minWithdraw, token.decimals),
              maxWithdrawAmount: ethers.formatUnits(maxWithdraw, token.decimals),
              accumulatedFees: '0',
              accumulatedCotiFees: ethers.formatEther(accCotiFees),
              nativeCotiFee: '0',
              bridgeBalance: ethers.formatUnits(balance, token.decimals),
              isPaused: paused,
              tokenDecimals: token.decimals,
              isLoading: false,
              error: null,
            });
          } catch (err) {
            console.error(`Error fetching data for ${token.symbol} bridge:`, err);
            bridges.push({
              bridgeName: `${token.symbol} Bridge`,
              bridgeAddress,
              publicToken: token.symbol,
              publicTokenIcon: token.icon,
              privateToken: 'N/A',
              privateTokenIcon: '',
              depositFixedFee: 'Error',
              depositPercentageBps: 'Error',
              depositMaxFee: 'Error',
              withdrawFixedFee: 'Error',
              withdrawPercentageBps: 'Error',
              withdrawMaxFee: 'Error',
              minDepositAmount: 'Error',
              maxDepositAmount: 'Error',
              minWithdrawAmount: 'Error',
              maxWithdrawAmount: 'Error',
              accumulatedFees: 'Error',
              accumulatedCotiFees: 'Error',
              nativeCotiFee: 'Error',
              bridgeBalance: 'Error',
              isPaused: false,
              tokenDecimals: token.decimals,
              isLoading: false,
              error: err instanceof Error ? err.message : 'Unknown error',
            });
          }
        }

        setBridgesData(bridges);
      } catch (err) {
        console.error('Error fetching bridge data:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    if (chainId) {
      fetchBridgeData();
    }
  }, [chainId, refreshTrigger]);

  return { bridgesData, isLoading, error, refresh };
};
