import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from '../contracts/config';

const ERC20_ESTIMATE_FEE_ABI = [
  'function estimateDepositFee(uint256 amount) view returns (uint256 fee, uint256 cotiLastUpdated, uint256 tokenLastUpdated, uint256 blockTimestamp)',
  'function estimateWithdrawFee(uint256 amount) view returns (uint256 fee, uint256 cotiLastUpdated, uint256 tokenLastUpdated, uint256 blockTimestamp)',
] as const;

const NATIVE_ESTIMATE_FEE_ABI = [
  'function estimateDepositFee(uint256 amount) view returns (uint256 fee, uint256 cotiLastUpdated, uint256 blockTimestamp)',
  'function estimateWithdrawFee(uint256 amount) view returns (uint256 fee, uint256 cotiLastUpdated, uint256 blockTimestamp)',
] as const;

export interface FeeEstimate {
  depositFee: string;
  withdrawFee: string;
  cotiLastUpdated: string;
  tokenLastUpdated: string;
  blockTimestamp: string;
}

const ERROR_ESTIMATE: FeeEstimate = { depositFee: 'Error', withdrawFee: 'Error', cotiLastUpdated: '0', tokenLastUpdated: '0', blockTimestamp: '0' };

interface TokenMeta {
  bridgeAddressKey: string;
  decimals: number;
  isNative: boolean;
}

const TOKEN_META: Record<string, TokenMeta> = {
  COTI:     { bridgeAddressKey: 'PrivacyBridgeCotiNative', decimals: 18, isNative: true },
  WETH:     { bridgeAddressKey: 'PrivacyBridgeWETH',       decimals: 18, isNative: false },
  WBTC:     { bridgeAddressKey: 'PrivacyBridgeWBTC',       decimals: 8,  isNative: false },
  USDT:     { bridgeAddressKey: 'PrivacyBridgeUSDT',       decimals: 6,  isNative: false },
  'USDC.e': { bridgeAddressKey: 'PrivacyBridgeUSDCe',      decimals: 6,  isNative: false },
  WADA:     { bridgeAddressKey: 'PrivacyBridgeWADA',       decimals: 6,  isNative: false },
  gCOTI:    { bridgeAddressKey: 'PrivacyBridgegCOTI',      decimals: 18, isNative: false },
};

export async function estimateBridgeFee(
  symbol: string,
  amount: string,
  provider: ethers.JsonRpcProvider | ethers.BrowserProvider,
): Promise<FeeEstimate> {
  const meta = TOKEN_META[symbol];
  if (!meta) {
    console.warn(`No token metadata for symbol: ${symbol}`);
    return ERROR_ESTIMATE;
  }

  try {
    const chainId = Number((await provider.getNetwork()).chainId);
    const addresses = CONTRACT_ADDRESSES[chainId as keyof typeof CONTRACT_ADDRESSES];
    if (!addresses) return ERROR_ESTIMATE;

    const bridgeAddress = addresses[meta.bridgeAddressKey as keyof typeof addresses];
    if (!bridgeAddress) return ERROR_ESTIMATE;

    const abi = meta.isNative ? NATIVE_ESTIMATE_FEE_ABI : ERC20_ESTIMATE_FEE_ABI;
    const contract = new ethers.Contract(bridgeAddress, abi, provider);
    const amountWei = ethers.parseUnits(amount, meta.decimals);

    if (meta.isNative) {
      // Native 3-tuple: (fee, cotiLastUpdated, blockTimestamp)
      const [depositResult, withdrawResult] = await Promise.all([
        contract.estimateDepositFee(amountWei).catch(() => [0n, 0n, 0n]),
        contract.estimateWithdrawFee(amountWei).catch(() => [0n, 0n, 0n]),
      ]);

      const cotiLastUpdated = depositResult[1].toString();
      return {
        depositFee: ethers.formatEther(depositResult[0]),
        withdrawFee: ethers.formatEther(withdrawResult[0]),
        cotiLastUpdated,
        tokenLastUpdated: cotiLastUpdated,
        blockTimestamp: depositResult[2].toString(),
      };
    } else {
      // ERC20 4-tuple: (fee, cotiLastUpdated, tokenLastUpdated, blockTimestamp)
      const [depositResult, withdrawResult] = await Promise.all([
        contract.estimateDepositFee(amountWei).catch(() => [0n, 0n, 0n, 0n]),
        contract.estimateWithdrawFee(amountWei).catch(() => [0n, 0n, 0n, 0n]),
      ]);

      return {
        depositFee: ethers.formatEther(depositResult[0]),
        withdrawFee: ethers.formatEther(withdrawResult[0]),
        cotiLastUpdated: depositResult[1].toString(),
        tokenLastUpdated: depositResult[2].toString(),
        blockTimestamp: depositResult[3].toString(),
      };
    }
  } catch (err) {
    console.error(`Error estimating bridge fees for ${symbol}:`, err);
    return ERROR_ESTIMATE;
  }
}
