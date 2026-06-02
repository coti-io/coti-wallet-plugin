import { useState, useCallback, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, BRIDGE_ABI, BRIDGE_ERC20_ABI, ERC20_ABI, TOKEN_ABI } from '../contracts/config';
import { formatTokenBalanceDisplay, truncateDecimalValue } from '../lib/utils';
import { estimateBridgeFee } from './useEstimateBridgeFees';
import { getEthereumProvider } from '../lib/ethereum';
import { CotiPluginError, CotiErrorCode } from '../errors';


export interface Token {
    symbol: string;
    name: string;
    balance: string;
    isPrivate: boolean;
    icon?: string;
    addressKey?: string;
    bridgeAddressKey?: string;
}



import { SUPPORTED_TOKENS } from '../contracts/config';

export const getInitialPublicTokens = (): Token[] =>
    SUPPORTED_TOKENS.filter(t => !t.isPrivate).map(t => ({
        symbol: t.symbol,
        name: t.name,
        balance: '0.00',
        isPrivate: false,
        icon: t.icon,
        addressKey: t.addressKey,
        bridgeAddressKey: t.bridgeAddressKey
    }));

export const getInitialPrivateTokens = (): Token[] =>
    SUPPORTED_TOKENS.filter(t => t.isPrivate).map(t => ({
        symbol: t.symbol,
        name: t.name,
        balance: '0.00',
        isPrivate: true,
        icon: t.icon,
        addressKey: t.addressKey,
        bridgeAddressKey: t.bridgeAddressKey
    }));

interface ToastState {
    visible: boolean;
    title: string;
    message: string | React.ReactNode;
}

/**
 * Custom 256-bit encrypt and sign helper for COTI MPC (itUint256)
 *
 * Signing strategy — mirrors the snap site's buildItUint256:
 *   1. AES-encrypt the amount locally
 *   2. Pack message as solidityPacked(sender, contract, selector, ctHigh uint256, ctLow uint256)
 *   3. Sign via signer.signMessage() — personal_sign (Ethereum-prefixed), same as PrivateERC20
 *
 * No snap required — uses standard MetaMask signing.
 */
async function encryptValue256(
    amountWei: bigint,
    aesKeyHex: string,
    contractAddress: string,
    functionSelector: string,
    walletAddress: string,
    signer: ethers.JsonRpcSigner
) {
    const { encodeKey, encrypt } = await import('@coti-io/coti-sdk-typescript');

    const BLOCK_SIZE = 16;
    const CT_SIZE = 32;

    const userAesKey = encodeKey(aesKeyHex);
    const plaintextBigInt = BigInt(amountWei);
    const bitSize = plaintextBigInt === 0n ? 0 : plaintextBigInt.toString(2).length;

    function writeBE(buf: Uint8Array, value: bigint) {
        for (let i = buf.length - 1; i >= 0; i--) {
            buf[i] = Number(value & 0xffn);
            value >>= 8n;
        }
    }

    let ct: Uint8Array;
    if (bitSize <= 128) {
        const lowBytes = new Uint8Array(BLOCK_SIZE);
        writeBE(lowBytes, plaintextBigInt);
        const { ciphertext: ctLow, r: rLow } = encrypt(userAesKey, lowBytes);
        const highBytes = new Uint8Array(BLOCK_SIZE);
        const { ciphertext: ctHigh, r: rHigh } = encrypt(userAesKey, highBytes);
        ct = new Uint8Array([...ctHigh, ...rHigh, ...ctLow, ...rLow]);
    } else {
        const fullBytes = new Uint8Array(CT_SIZE);
        writeBE(fullBytes, plaintextBigInt);
        const { ciphertext: ctHigh, r: rHigh } = encrypt(userAesKey, fullBytes.slice(0, BLOCK_SIZE));
        const { ciphertext: ctLow, r: rLow } = encrypt(userAesKey, fullBytes.slice(BLOCK_SIZE));
        ct = new Uint8Array([...ctHigh, ...rHigh, ...ctLow, ...rLow]);
    }

    // Split ct into high/low uint256 values
    const ctHighHex = Array.from(ct.slice(0, CT_SIZE)).map(b => b.toString(16).padStart(2, '0')).join('');
    const ctLowHex = Array.from(ct.slice(CT_SIZE)).map(b => b.toString(16).padStart(2, '0')).join('');
    const ciphertextHigh = BigInt('0x' + ctHighHex);
    const ciphertextLow = BigInt('0x' + ctLowHex);

    // Pack message the same way as the snap site's buildItUint256:
    // solidityPacked(sender, contract, selector, ctHigh as uint256, ctLow as uint256)
    const message = ethers.solidityPacked(
        ['address', 'address', 'bytes4', 'uint256', 'uint256'],
        [walletAddress, contractAddress, functionSelector, ciphertextHigh, ciphertextLow]
    );

    // Sign with personal_sign via signer.signMessage() — same as snap site
    const signature = await signer.signMessage(ethers.getBytes(message));

    console.log('🔐 encryptValue256: ciphertextHigh:', ciphertextHigh.toString(16), 'ciphertextLow:', ciphertextLow.toString(16));
    console.log('🔐 encryptValue256: signature:', signature);

    return {
        ciphertext: { ciphertextHigh, ciphertextLow },
        signature,
    };
}


/**
 * Configuration properties for the usePrivacyBridge hook.
 */
interface UsePrivacyBridgeProps {
    /** Connection status of the wallet */
    isConnected: boolean;
    /** The connected wallet address */
    walletAddress: string;
    /** List of public tokens available */
    publicTokens: Token[];
    /** Function to force refresh of private balances */
    refreshPrivateBalances?: () => Promise<boolean>;
    /** State setter for public tokens */
    setPublicTokens: React.Dispatch<React.SetStateAction<Token[]>>;
    /** State setter for private tokens */
    setPrivateTokens: React.Dispatch<React.SetStateAction<Token[]>>;
    /** State setter for toast notifications */
    setToastState: React.Dispatch<React.SetStateAction<ToastState>>;

    // Swap Handler Props
    /** The amount to bridge/swap */
    amount: string;
    /** State setter for the amount */
    setAmount: React.Dispatch<React.SetStateAction<string>>;
    /** The direction of the swap (to-private or to-public) */
    direction: 'to-private' | 'to-public';
    /** State setter for the direction */
    setDirection: React.Dispatch<React.SetStateAction<'to-private' | 'to-public'>>;
    /** Index of the currently selected token */
    selectedTokenIndex: number;
    /** State setter for the selected token index */
    setSelectedTokenIndex: React.Dispatch<React.SetStateAction<number>>;
    /** Current error state, if any */
    error: { title: string; message: string } | null;
    /** Boolean indicating if the Snap is installed/connected */
    hasSnap: boolean;
    /** State setter for the Snap connection status */
    setHasSnap: (hasSnap: boolean) => void;
    /** Function to retrieve the AES key from the Snap */
    /** Function to retrieve the AES key from the Snap */
    getAESKeyFromSnap: (accountAddress: string) => Promise<string | null>;
    /** Function to trigger manual onboarding */
    handleOnboard: () => Promise<string | null>;
}

export type SwapProgressStage =
    | 'approve-start'
    | 'approve-complete'
    | 'transfer-start'
    | 'transfer-complete';

/**
 * Custom hook that orchestrates the entire privacy bridge interaction flow.
 * 
 * This hook acts as the central coordinator for:
 * 1. **Bridge Logic**: Validating balances, allowances, and executing Deposit/Withdraw transactions.
 * 2. **Swap Initiation**: Handling the user's intent to swap (via `handleSwap`), managing overrides, and validating input.
 * 3. **Privacy Integration**: Ensuring the Coti Snap is connected and the AES key is retrieved before bridging private assets.
 * 4. **Allowance Management**: checking and approving ERC20 tokens for the bridge.
 * 5. **UI Feedback**: Managing loading states (`isBridgingLoading`) and triggering toast notifications.
 * 
 * It combines the low-level transaction execution with the high-level user flow requirements.
 * 
 * @param props - See {@link UsePrivacyBridgeProps} for full configuration details.
 * @returns 
 * - `handleSwap`: The primary entry point for the UI to trigger a swap/bridge action.
 * - `executeTransaction`: The underlying transaction executor (can be used directly if needed).
 * - `isBridgingLoading`: Boolean indicating if a bridge transaction is currently in progress.
 * - `allowance`: The current allowance for the selected token.
 * - `isApproving`: Boolean indicating if an approval transaction is in progress.
 * - `handleApprove`: Function to trigger the approval transaction.
 * - `checkAllowance`: Function to manually refresh the allowance.
 * - `isApprovalNeeded`: Boolean indicating if approval is required for the current amount.
 * - `estimatedGasFee`: The estimated gas fee for the bridge transaction in COTI.
 */
export const usePrivacyBridge = ({
    isConnected,
    walletAddress,
    publicTokens,
    setPublicTokens,
    setPrivateTokens,
    setToastState,
    amount,
    setAmount,
    direction,
    setDirection,
    selectedTokenIndex,
    setSelectedTokenIndex,
    error,
    hasSnap,
    setHasSnap,

    getAESKeyFromSnap,
    handleOnboard,
    refreshPrivateBalances
}: UsePrivacyBridgeProps) => {
    const [isBridgingLoading, setIsBridgingLoading] = useState(false);




    // Allowance State
    const [allowance, setAllowance] = useState<string>('0');
    const [isApproving, setIsApproving] = useState(false);

    /**
     * Checks the current allowance of the selected token for the bridge.
     * Updates the `allowance` state.
     */
    const checkAllowance = useCallback(async () => {
        if (!isConnected || !window.ethereum || !walletAddress) return;

        const token = publicTokens[selectedTokenIndex];

        // Native COTI doesn't need allowance for deposit (to-private).
        // For withdrawal (to-public), PrivateCoti still requires an encrypted approval.
        if (token?.symbol === 'COTI' && direction === 'to-private') {
            setAllowance('999999999999999999');
            return;
        }

        // Reset to 0 to prevent stale state from previous token
        setAllowance('0');

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const network = await provider.getNetwork();
            const currentChainId = Number(network.chainId);
            const addresses = CONTRACT_ADDRESSES[currentChainId];

            let tokenAddress: string | undefined;
            let bridgeAddress: string | undefined;
            let decimals = 18;

            if (token.symbol === 'WETH') {
                tokenAddress = addresses?.WETH;
                bridgeAddress = addresses?.PrivacyBridgeWETH;
                decimals = 18;
            } else if (token.symbol === 'WBTC') {
                tokenAddress = addresses?.WBTC;
                bridgeAddress = addresses?.PrivacyBridgeWBTC;
                decimals = 8;
            } else if (token.symbol === 'USDT') {
                tokenAddress = addresses?.USDT;
                bridgeAddress = addresses?.PrivacyBridgeUSDT;
                decimals = 6;
            } else if (token.symbol === 'USDC.e') {
                tokenAddress = addresses?.USDC_E;
                bridgeAddress = addresses?.PrivacyBridgeUSDCe;
                decimals = 6;
            } else if (token.symbol === 'WADA') {
                tokenAddress = addresses?.WADA;
                bridgeAddress = addresses?.PrivacyBridgeWADA;
                decimals = 18;
            } else if (token.symbol === 'gCOTI') {
                tokenAddress = addresses?.gCOTI;
                bridgeAddress = addresses?.PrivacyBridgegCOTI;
                decimals = 18;
            } else if (token.symbol === 'COTI') {
                // Native COTI: no public tokenAddress, but bridge address is needed for to-public allowance check
                bridgeAddress = addresses?.PrivacyBridgeCotiNative;
            }

            // For to-public (withdraw), only bridgeAddress is required — tokenAddress is the private token
            // resolved below. For to-private (deposit), both are needed.
            if (direction === 'to-private' && (!tokenAddress || !bridgeAddress)) return;
            if (!bridgeAddress) return;

            let currentAllowance = 0n;

            // Check direction to decide which token to check
            if (direction === 'to-public') {
                // For Portal Out, we need to check the allowance of the Private Token.
                // Resolving private token address and decimals
                let privateTokenKey = "";
                let privateDecimals = 18;
                if (token.symbol === 'COTI') {
                    privateTokenKey = 'PrivateCoti';
                    privateDecimals = 18;
                } else {
                    privateTokenKey = 'p.' + token.symbol;
                    if (token.symbol === 'WETH' || token.symbol === 'gCOTI') privateDecimals = 18;
                    else if (token.symbol === 'WBTC') privateDecimals = 8;
                    else privateDecimals = 6; // USDT, USDC.e, WADA
                }
                if (token.symbol === 'USDC.e') privateTokenKey = 'p.USDC_E';

                const privateTokenAddress = addresses[privateTokenKey];
                if (!privateTokenAddress) {
                    setAllowance('0');
                    return;
                }

                try {
                    const tokenContract = new ethers.Contract(privateTokenAddress, [
                        "function allowance(address owner, address spender) view returns (tuple(tuple(uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, tuple(uint256 ciphertextHigh, uint256 ciphertextLow) ownerCiphertext, tuple(uint256 ciphertextHigh, uint256 ciphertextLow) spenderCiphertext))"
                    ], provider);
                    
                    const currentAllowance = await tokenContract.allowance(walletAddress, bridgeAddress);

                    // If the allowance is clearly uninitialized or 0, return early:
                    if (currentAllowance.ownerCiphertext.ciphertextHigh === 0n &&
                        currentAllowance.ownerCiphertext.ciphertextLow === 0n) {
                        setAllowance('0');
                        return;
                    }

                    // Attempt dynamic decryption if we have a snap connection to avoid prompting the user unexpectedly
                    if (hasSnap) {
                        try {
                            const aesKey = await getAESKeyFromSnap(walletAddress);
                            if (aesKey) {
                                // Dynamically import CotiSDK
                                const CotiSDK = await import('@coti-io/coti-sdk-typescript');
                                const decryptedVal = CotiSDK.decryptUint256({
                                    ciphertextHigh: currentAllowance.ownerCiphertext.ciphertextHigh,
                                    ciphertextLow: currentAllowance.ownerCiphertext.ciphertextLow
                                }, aesKey);

                                // Sanity check to avoid rendering garbage
                                const insaneThreshold = BigInt("1000000000000") * BigInt(10) ** BigInt(privateDecimals);
                                if (decryptedVal > insaneThreshold) {
                                    setAllowance('0');
                                } else {
                                    setAllowance(ethers.formatUnits(decryptedVal, privateDecimals));
                                }
                                return;
                            }
                        } catch (decryptErr) {
                            console.warn("Could not decrypt private allowance, defaulting to 0", decryptErr);
                        }
                    }
                    
                    // If no AES key or user rejected, fall back to 0 so they can re-approve
                    setAllowance('0');
                } catch (e) {
                    console.warn("Could not check private allowance, defaulting to 0", e);
                    setAllowance('0');
                }
                return;
            } else {
                // Public Token Allowance Check
                const tokenContract = new ethers.Contract(tokenAddress!, ERC20_ABI, provider);
                currentAllowance = await tokenContract.allowance(walletAddress, bridgeAddress);
            }

            setAllowance(ethers.formatUnits(currentAllowance, decimals));
        } catch (err) {
            console.error("Failed to check allowance", err);
            setAllowance('0');
        }
    }, [isConnected, walletAddress, selectedTokenIndex, publicTokens, hasSnap, getAESKeyFromSnap, direction]);

    // Auto-check allowance on dependencies change
    useEffect(() => {
        checkAllowance();
    }, [checkAllowance]);

    /**
     * Initiates the token approval transaction.
     * Sets `isApproving` to true during the process and shows toast notifications.
     */
    const handleApprove = async () => {
        if (!isConnected || !window.ethereum) return;

        const token = publicTokens[selectedTokenIndex];
        // Only approve ERC20 tokens (Everything except Native COTI - actually, Private COTI needs approval too for withdraw!)
        // If direction is to-public (Withdraw), even COTI (PrivateCoti) needs approval.
        if (direction === 'to-private' && token?.symbol === 'COTI') return;

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const network = await provider.getNetwork();
            const currentChainId = Number(network.chainId);
            const addresses = CONTRACT_ADDRESSES[currentChainId];

            let tokenAddress: string | undefined;
            let bridgeAddress: string | undefined;
            let decimals = 18;

            // Resolve Addresses based on Token
            if (token.symbol === 'WETH') {
                tokenAddress = addresses?.WETH;
                bridgeAddress = addresses?.PrivacyBridgeWETH;
                decimals = 18;
            } else if (token.symbol === 'WBTC') {
                tokenAddress = addresses?.WBTC;
                bridgeAddress = addresses?.PrivacyBridgeWBTC;
                decimals = 8;
            } else if (token.symbol === 'USDT') {
                tokenAddress = addresses?.USDT;
                bridgeAddress = addresses?.PrivacyBridgeUSDT;
                decimals = 6;
            } else if (token.symbol === 'USDC.e') {
                tokenAddress = addresses?.USDC_E;
                bridgeAddress = addresses?.PrivacyBridgeUSDCe;
                decimals = 6;
            } else if (token.symbol === 'WADA') {
                tokenAddress = addresses?.WADA;
                bridgeAddress = addresses?.PrivacyBridgeWADA;
                decimals = 18;
            } else if (token.symbol === 'gCOTI') {
                tokenAddress = addresses?.gCOTI;
                bridgeAddress = addresses?.PrivacyBridgegCOTI;
                decimals = 18;
            } else if (token.symbol === 'COTI') {
                // Native COTI doesn't need approval for Deposit
                if (direction === 'to-private') return;
                
                bridgeAddress = addresses?.PrivacyBridgeCotiNative;
            }

            // For to-public (withdraw), only bridgeAddress is required — tokenAddress is the private token
            if (direction === 'to-private' && (!tokenAddress || !bridgeAddress)) return;
            if (!bridgeAddress) return;

            const amountToApprove = amount ? ethers.parseUnits(amount, decimals) : ethers.MaxUint256;

            setIsApproving(true);
            setToastState({
                visible: true,
                title: 'Approve Allowance',
                message: `Please approve the bridge to access your ${direction === 'to-public' ? 'Private ' : ''}${token.symbol}.`
            });

            let tx;

            if (direction === 'to-public') {
                // Private Token Approval (Encrypted)
                
                // 1. Resolve private token address and decimals
                let privateTokenKey = "";
                let privateDecimals = 18;
                if (token.symbol === 'COTI') {
                    privateTokenKey = 'PrivateCoti';
                    privateDecimals = 18;
                } else {
                    privateTokenKey = 'p.' + token.symbol;
                    if (token.symbol === 'WETH' || token.symbol === 'gCOTI') privateDecimals = 18;
                    else if (token.symbol === 'WBTC') privateDecimals = 8;
                    else privateDecimals = 6; // USDT, USDC.e, WADA
                }
                if (token.symbol === 'USDC.e') privateTokenKey = 'p.USDC_E';

                const privateTokenAddress = addresses[privateTokenKey];
                if (!privateTokenAddress) throw new CotiPluginError(CotiErrorCode.CONTRACT_NOT_FOUND, 'Private token address not found');

                // 2. Get AES key for encrypted approval
                const aesKey = await getAESKeyFromSnap(walletAddress);
                if (!aesKey) throw new CotiPluginError(CotiErrorCode.AES_KEY_MISSING, 'AES key required for private token approval. Please connect your Snap.');

                // 3. Create itValue with 256-bit encryption
                setIsApproving(true);
                setToastState({
                    visible: true,
                    title: 'Approve Private Token',
                    message: `Please approve the bridge to access your Private ${token.symbol} tokens.`
                });

                const amountToApprove = amount ? ethers.parseUnits(amount, privateDecimals) : ethers.MaxUint256;

                // approve(address,itUint256) — Encrypted approval using manual 256-bit encryption.
                const approveSig = ethers.id('approve(address,((uint256,uint256),bytes))').slice(0, 10);
                const itValue = await encryptValue256(
                    amountToApprove,
                    aesKey,
                    privateTokenAddress,
                    approveSig,
                    walletAddress,
                    signer
                );

                console.log("🔄 Approving private token for bridge (256-bit)...");

                // Manually encode the calldata
                const approveInterface = new ethers.Interface([
                    "function approve(address spender, tuple(tuple(uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) value) returns (bool)"
                ]);
                const calldata = approveInterface.encodeFunctionData("approve", [
                    bridgeAddress,
                    [[itValue.ciphertext.ciphertextHigh, itValue.ciphertext.ciphertextLow], itValue.signature]
                ]);

                // Bypassing Coti provider
                const rawTxHash = await getEthereumProvider()!.request({
                    method: 'eth_sendTransaction',
                    params: [{
                        from: walletAddress,
                        to: privateTokenAddress,
                        data: calldata,
                        gas: '0xB71B00'  // 12,000,000 in hex
                    }]
                });

                console.log("🔄 Waiting for approve tx hash:", rawTxHash);
                await provider.waitForTransaction(rawTxHash);
                
                setIsApproving(false);
                setToastState(prev => ({ ...prev, visible: false }));
                await checkAllowance();
                return;

            } else {
                // Public Token Approval (Standard)
                // Use public tokenAddress defined above
                const tokenContract = new ethers.Contract(tokenAddress!, ERC20_ABI, signer);
                tx = await tokenContract.approve(bridgeAddress, amountToApprove);
            }

            setToastState({
                visible: true,
                title: 'Approving...',
                message: 'Waiting for allowance confirmation...'
            });

            await tx.wait();

            // Refresh allowance
            await checkAllowance();

            setIsApproving(false);
            setToastState(prev => ({ ...prev, visible: false }));

        } catch (err) {
            console.error("Approval failed", err);
            setIsApproving(false);
            setToastState(prev => ({ ...prev, visible: false }));
            throw err; // Rethrow to allow UI to handle error (e.g. show message, reset state)
        }
    };

    /**
     * Determines if an approval is required for the current transaction.
     * @returns `true` if approval is needed, `false` otherwise.
     */
    const isApprovalNeeded = (() => {
        const token = publicTokens[selectedTokenIndex];
        // For Native COTI in to-private (Deposit), no approval needed.
        if (direction === 'to-private' && token?.symbol === 'COTI') return false;

        const amountNum = parseFloat(amount || '0');
        const allowanceNum = parseFloat(allowance);
        return amountNum > allowanceNum;
    })();

    // Internal execution function 
    const calculateGasMargin = async (
        contract: ethers.Contract,
        methodName: string,
        args: any[],
        fallbackGasLimit: bigint,
        overrides: any = {}
    ): Promise<bigint> => {
        try {
            console.log(`Estimating gas for ${methodName}...`);
            const estimatedGas = await contract[methodName].estimateGas(...args, overrides);
            // removing 20% buffer as requested
            // const safeGas = (estimatedGas * 120n) / 100n;
            const safeGas = estimatedGas;
            console.log(`Gas estimation successful: ${estimatedGas.toString()} -> Safe limit: ${safeGas.toString()}`);
            return safeGas;
        } catch (error: any) {
            console.warn(`Gas estimation failed for ${methodName}`, error);
            // Log specific error reason if available
            if (error.reason) console.warn(`   Reason: ${error.reason}`);
            if (error.data) console.warn(`   Data: ${error.data}`);

            return fallbackGasLimit;
        }
    };

    const executeTransaction = useCallback(async (
        txAmount: string,
        txDirection: 'to-private' | 'to-public',
        txTokenIndex: number,
        onProgress?: (stage: SwapProgressStage, txHash?: string) => void
    ) => {
        console.log(`🚀 Initiating swap transaction: ${txAmount} (Direction: ${txDirection}, Token Index: ${txTokenIndex})`);
        setIsBridgingLoading(true);
        try {
            if (!window.ethereum) throw new CotiPluginError(CotiErrorCode.NO_PROVIDER, 'No wallet provider found');

            // Initialize Ethers
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();

            const network = await provider.getNetwork();
            const currentChainId = Number(network.chainId);
            const addresses = CONTRACT_ADDRESSES[currentChainId];

            if (!addresses) throw new CotiPluginError(CotiErrorCode.UNSUPPORTED_NETWORK, `Unsupported network: chain ID ${currentChainId}`);

            const txPublicToken = publicTokens[txTokenIndex];
            const isWeth = txPublicToken.symbol === 'WETH';
            const isWbtc = txPublicToken.symbol === 'WBTC';
            const isUsdt = txPublicToken.symbol === 'USDT';
            const isUsdcE = txPublicToken.symbol === 'USDC.e';
            const isWada = txPublicToken.symbol === 'WADA';
            const isGCoti = txPublicToken.symbol === 'gCOTI';
            const isErc20 = isWeth || isWbtc || isUsdt || isUsdcE || isWada || isGCoti;

            // Select Bridge Address and decimals
            let bridgeAddress: string | undefined;
            let tokenAddress: string | undefined;
            let publicDecimals = 18;
            let privateDecimals = 6;

            if (isWeth) {
                bridgeAddress = addresses.PrivacyBridgeWETH;
                tokenAddress = addresses.WETH;
                publicDecimals = 18;
                privateDecimals = 18; // Corrected: p.WETH uses 18 decimals
            } else if (isWbtc) {
                bridgeAddress = addresses.PrivacyBridgeWBTC;
                tokenAddress = addresses.WBTC;
                publicDecimals = 8;
                privateDecimals = 8;
            } else if (isUsdt) {
                bridgeAddress = addresses.PrivacyBridgeUSDT;
                tokenAddress = addresses.USDT;
                publicDecimals = 6;
                privateDecimals = 6;
            } else if (isUsdcE) {
                bridgeAddress = addresses.PrivacyBridgeUSDCe;
                tokenAddress = addresses.USDC_E;
                publicDecimals = 6;
                privateDecimals = 6;
            } else if (isWada) {
                bridgeAddress = addresses.PrivacyBridgeWADA;
                tokenAddress = addresses.WADA;
                publicDecimals = 6;
                privateDecimals = 6;
            } else if (isGCoti) {
                bridgeAddress = addresses.PrivacyBridgegCOTI;
                tokenAddress = addresses.gCOTI;
                publicDecimals = 18;
                privateDecimals = 18; // Corrected: p.gCOTI uses 18 decimals
            } else {
                bridgeAddress = addresses.PrivacyBridgeCotiNative;
                publicDecimals = 18;
                privateDecimals = 18; // Corrected: p.COTI (Native) uses 18 decimals
            }

            if (!bridgeAddress) throw new CotiPluginError(CotiErrorCode.CONTRACT_NOT_FOUND, `Bridge address not found for ${txPublicToken.symbol}`);

            const bridgeAbi = isErc20 ? BRIDGE_ERC20_ABI : BRIDGE_ABI;

            const bridge = new ethers.Contract(bridgeAddress, bridgeAbi, signer);

            // Use correct decimals based on direction
            const decimals = txDirection === 'to-private' ? publicDecimals : privateDecimals;
            const amountWei = ethers.parseUnits(txAmount, decimals);

            let tx;

            if (txDirection === 'to-private') {
                // Deposit
                console.log(`Depositing ${txAmount} ${txPublicToken.symbol} to ${bridgeAddress}`);

                setToastState({
                    visible: true,
                    title: 'Confirm Transaction',
                    message: 'Please confirm the transaction in your wallet to deposit to your private balance.'
                });

                try {
                    if (isErc20 && tokenAddress) {
                        // ERC20 Deposit: requires allowance
                        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
                        const userBalance = await tokenContract.balanceOf(walletAddress);

                        const amountWeiPublic = ethers.parseUnits(txAmount, publicDecimals); // Allowance/Balance always unchecked against public amount

                        // Re-check allowance using Public Decimals
                        const userAllowance = await tokenContract.allowance(walletAddress, bridgeAddress);

                        if (userBalance < amountWeiPublic) {
                            console.log(`DEBUG: Insufficient Balance Check`);
                            console.log(`DEBUG: Token: ${txPublicToken.symbol}`);
                            console.log(`DEBUG: Decimals: ${publicDecimals}`);
                            console.log(`DEBUG: Raw Balance (Wei): ${userBalance.toString()}`);
                            console.log(`DEBUG: Formatted Balance: ${ethers.formatUnits(userBalance, publicDecimals)}`);
                            throw new CotiPluginError(CotiErrorCode.INSUFFICIENT_BALANCE, `Insufficient ${txPublicToken.symbol} balance. You have ${ethers.formatUnits(userBalance, publicDecimals)} ${txPublicToken.symbol}, trying to bridge ${txAmount}.`);
                        }
                        if (userAllowance < amountWeiPublic) {
                            throw new CotiPluginError(CotiErrorCode.INSUFFICIENT_ALLOWANCE, `Insufficient Allowance. Approved: ${ethers.formatUnits(userAllowance, publicDecimals)}, Required: ${txAmount}. Please Approve again.`);
                        }

                        console.log("🔄 Executing ERC20 Deposit...");

                        // Get fee from on-chain estimateDepositFee
                        let nativeFee = 0n;
                        let cotiOracleTimestamp = 0n;
                        let tokenOracleTimestamp = 0n;
                        const rpcUrl = Number((await provider.getNetwork()).chainId) === 7082400
                            ? 'https://testnet.coti.io/rpc' : 'https://mainnet.coti.io/rpc';
                        const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);

                        const fetchErc20OracleTimestamps = async () => {
                            const feeEstimate = await estimateBridgeFee(txPublicToken.symbol, txAmount, rpcProvider);
                            if (feeEstimate.depositFee !== 'Error') {
                                const feeWei = ethers.parseEther(feeEstimate.depositFee);
                                // Add 1% slippage buffer
                                nativeFee = (feeWei * 101n) / 100n;
                            }
                            cotiOracleTimestamp = BigInt(feeEstimate.cotiLastUpdated || '0');
                            tokenOracleTimestamp = BigInt(feeEstimate.tokenLastUpdated || '0');
                            console.log("   Computed COTI Fee (with 1% slippage):", ethers.formatEther(nativeFee));
                            console.log("   COTI oracle timestamp:", cotiOracleTimestamp.toString());
                            console.log("   Token oracle timestamp:", tokenOracleTimestamp.toString());
                        };

                        try {
                            await fetchErc20OracleTimestamps();
                        } catch (e) {
                            console.warn("⚠️ Could not compute dynamic fee, defaulting to 0:", e);
                        }

                        console.log("   Amount (Wei):", amountWeiPublic.toString());

                        onProgress?.('transfer-start');

                        // CRITICAL: Bypass the Coti provider — it strips the data field from
                        // non-encrypted transactions, causing msg.data to land as "" and revert.
                        const depositBridge = new ethers.Contract(bridgeAddress, BRIDGE_ERC20_ABI, signer);

                        const sendErc20Deposit = async () => {
                            const depositCalldata = depositBridge.interface.encodeFunctionData('deposit(uint256,uint256,uint256)', [amountWeiPublic, cotiOracleTimestamp, tokenOracleTimestamp]);

                            let depositGasLimit = 12000000n;
                            try {
                                const depositGasHex = await getEthereumProvider()!.request({
                                    method: 'eth_estimateGas',
                                    params: [{
                                        from: walletAddress,
                                        to: bridgeAddress,
                                        data: depositCalldata,
                                        value: '0x' + nativeFee.toString(16),
                                    }]
                                });
                                depositGasLimit = (BigInt(depositGasHex) * 130n) / 100n;
                                console.log(`🔍 ERC20 deposit gas: estimated=${BigInt(depositGasHex)}, buffered=${depositGasLimit}`);
                            } catch (estErr: any) {
                                console.warn("⚠️ ERC20 deposit gas estimation failed, falling back to 12M:", estErr?.message);
                                // Check if gas estimation failed due to OracleTimestampMismatch
                                if (estErr?.message && estErr.message.includes('OracleTimestampMismatch')) {
                                    throw estErr;
                                }
                            }

                            const rawDepositTxHash = await getEthereumProvider()!.request({
                                method: 'eth_sendTransaction',
                                params: [{
                                    from: walletAddress,
                                    to: bridgeAddress,
                                    data: depositCalldata,
                                    value: '0x' + nativeFee.toString(16),
                                    gas: '0x' + depositGasLimit.toString(16),
                                }]
                            });
                            return rawDepositTxHash;
                        };

                        let rawDepositTxHash: string;
                        try {
                            rawDepositTxHash = await sendErc20Deposit();
                        } catch (depositErr: any) {
                            // Handle OracleTimestampMismatch by re-fetching timestamps and retrying once
                            const errMsg = depositErr?.message || depositErr?.error?.message || '';
                            if (errMsg.includes('OracleTimestampMismatch')) {
                                console.warn("⚠️ OracleTimestampMismatch detected on ERC20 deposit, re-fetching timestamps and retrying...");
                                await fetchErc20OracleTimestamps();
                                rawDepositTxHash = await sendErc20Deposit();
                            } else {
                                throw depositErr;
                            }
                        }

                        console.log("ERC20 deposit tx sent:", rawDepositTxHash);
                        tx = {
                            hash: rawDepositTxHash,
                            wait: async () => await provider.waitForTransaction(rawDepositTxHash)
                        } as any;

                    } else {
                        // Native COTI Deposit
                        console.log("🔄 Executing Native COTI Deposit...");

                        // Get dual oracle timestamps and fee from fee estimation
                        let cotiOracleTimestamp = 0n;
                        let tokenOracleTimestamp = 0n;
                        let nativeCotiFee = 0n;
                        const rpcUrl = Number((await provider.getNetwork()).chainId) === 7082400
                            ? 'https://testnet.coti.io/rpc' : 'https://mainnet.coti.io/rpc';
                        const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);

                        const fetchNativeOracleTimestamps = async () => {
                            const feeEstimate = await estimateBridgeFee('COTI', txAmount, rpcProvider);
                            cotiOracleTimestamp = BigInt(feeEstimate.cotiLastUpdated || '0');
                            tokenOracleTimestamp = cotiOracleTimestamp;
                            if (feeEstimate.depositFee !== 'Error') {
                                const feeWei = ethers.parseEther(feeEstimate.depositFee);
                                // Add 1% slippage buffer
                                nativeCotiFee = (feeWei * 101n) / 100n;
                            }
                            console.log("   COTI oracle timestamp:", cotiOracleTimestamp.toString());
                            console.log("   Token oracle timestamp:", tokenOracleTimestamp.toString());
                            console.log("   Computed COTI Fee (with 1% slippage):", ethers.formatEther(nativeCotiFee));
                        };

                        try {
                            await fetchNativeOracleTimestamps();
                        } catch (e) {
                            console.warn("⚠️ Could not fetch oracle timestamp:", e);
                        }

                        // Total value = deposit amount + fee
                        const totalValue = amountWei + nativeCotiFee;

                        // Default fallback 12M — native COTI bridge.deposit() triggers MPC operations.
                        let safeGasLimit = 12000000n;

                        console.log("   Amount (Wei):", amountWei.toString());
                        console.log("   Total Value (amount + fee):", totalValue.toString());
                        console.log("   Fallback Gas Limit:", safeGasLimit.toString());

                        try {
                            console.log("🔍 Attempting calculateGasMargin for native COTI deposit...");
                            const estimatedGas = await calculateGasMargin(
                                bridge,
                                'deposit(uint256,uint256)',
                                [cotiOracleTimestamp, tokenOracleTimestamp],
                                12000000n,
                                { value: totalValue }
                            );
                            const buffered = (estimatedGas * 130n) / 100n;
                            safeGasLimit = buffered > 900000n ? buffered : 900000n;
                            console.log(`🔍 Native COTI deposit gas: estimated=${estimatedGas}, buffered=${buffered}, final=${safeGasLimit}`);
                        } catch (e) {
                            console.warn("⚠️ Native COTI deposit gas estimation failed, falling back to 12M:", e);
                        }

                        onProgress?.('transfer-start');
                        try {
                            tx = await bridge['deposit(uint256,uint256)'](cotiOracleTimestamp, tokenOracleTimestamp, { value: totalValue, gasLimit: safeGasLimit });
                        } catch (depositErr: any) {
                            // Handle OracleTimestampMismatch by re-fetching timestamps and retrying once
                            const errName = depositErr?.errorName || depositErr?.revert?.name || '';

                            if (errName === 'OracleTimestampMismatch' || (depositErr?.message && depositErr.message.includes('OracleTimestampMismatch'))) {
                                console.warn("⚠️ OracleTimestampMismatch detected, re-fetching timestamps and retrying...");
                                await fetchNativeOracleTimestamps();
                                const retryTotalValue = amountWei + nativeCotiFee;
                                tx = await bridge['deposit(uint256,uint256)'](cotiOracleTimestamp, tokenOracleTimestamp, { value: retryTotalValue, gasLimit: safeGasLimit });
                            } else {
                                throw depositErr;
                            }
                        }
                    }
                } catch (e) {
                    setIsBridgingLoading(false);
                    setToastState(prev => ({ ...prev, visible: false }));
                    throw e;
                }
            } else {
                // Withdraw (Portal Out) — Uses bridge.withdraw()
                console.log(`Withdrawing ${txAmount} p.${txPublicToken.symbol}`);

                try {
                    // Check Allowance first (similar to Deposit)
                    const parsedAmount = ethers.parseUnits(txAmount, privateDecimals);
                    
                    // We don't have an easy way to check encrypted allowance here, 
                    // but we rely on the component gating the transition to Withdraw.
                    // However, let's at least ensure we have the correct signer.

                    const walletAddress = await signer.getAddress();
                    
                    // 5. Call bridge.withdraw(amount)
                    setToastState({
                        visible: true,
                        title: 'Confirm Withdrawal',
                        message: 'Please confirm the withdrawal transaction in your wallet.'
                    });

                    const bridgeAbi = isErc20 ? BRIDGE_ERC20_ABI : BRIDGE_ABI;
                    const bridgeContract = new ethers.Contract(bridgeAddress, bridgeAbi, signer);

                    // Fetch the native COTI fee for the bridge withdrawal
                    // Compute the dynamic fee from on-chain estimateWithdrawFee
                    // and add 1% slippage buffer
                    let nativeFee = 0n;
                    let cotiOracleTimestamp = 0n;
                    let tokenOracleTimestamp = 0n;

                    const rpcUrl = Number((await provider.getNetwork()).chainId) === 7082400
                        ? 'https://testnet.coti.io/rpc' : 'https://mainnet.coti.io/rpc';
                    const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);

                    const fetchWithdrawOracleTimestamps = async () => {
                        if (isErc20) {
                            const feeEstimate = await estimateBridgeFee(txPublicToken.symbol, txAmount, rpcProvider);
                            if (feeEstimate.withdrawFee !== 'Error') {
                                const feeWei = ethers.parseEther(feeEstimate.withdrawFee);
                                nativeFee = (feeWei * 101n) / 100n;
                            }
                            cotiOracleTimestamp = BigInt(feeEstimate.cotiLastUpdated || '0');
                            tokenOracleTimestamp = BigInt(feeEstimate.tokenLastUpdated || '0');
                            console.log("   Computed COTI Fee for withdraw (with 1% slippage):", ethers.formatEther(nativeFee));
                            console.log("   COTI oracle timestamp:", cotiOracleTimestamp.toString());
                            console.log("   Token oracle timestamp:", tokenOracleTimestamp.toString());
                        } else {
                            // Native COTI withdrawal — get dual oracle timestamps
                            const feeEstimate = await estimateBridgeFee('COTI', txAmount, rpcProvider);
                            cotiOracleTimestamp = BigInt(feeEstimate.cotiLastUpdated || '0');
                            tokenOracleTimestamp = cotiOracleTimestamp;
                            console.log("   COTI oracle timestamp for native withdraw:", cotiOracleTimestamp.toString());
                            console.log("   Token oracle timestamp for native withdraw:", tokenOracleTimestamp.toString());
                        }
                    };

                    try {
                        await fetchWithdrawOracleTimestamps();
                    } catch (e) {
                        console.warn("⚠️ Could not compute dynamic fee for withdraw, defaulting to 0:", e);
                    }

                    console.log("🔄 Executing Withdraw via bridge.withdraw()...");
                    // Default fallback gas limit for MPC operations.
                    // COTI node's estimateGas can under-count, but we will try to calculate dynamically.
                    let safeGasLimit = 12000000n;

                    console.log("   Amount (Wei):", amountWei.toString());
                    console.log("   Fallback Gas Limit:", safeGasLimit.toString());

                    // CRITICAL: We also bypass the Coti provider here because it strips the data field
                    // from normal (non-encrypted) transactions. Without this, msg.data lands as "" and reverts.
                    const sendWithdraw = async () => {
                        const withdrawCalldata = bridgeContract.interface.encodeFunctionData('withdraw(uint256,uint256,uint256)', [amountWei, cotiOracleTimestamp, tokenOracleTimestamp]);

                        let gasLimit = safeGasLimit;
                        try {
                            console.log("🔍 Attempting eth_estimateGas for withdraw...");
                            const gasEstimateHex = await getEthereumProvider()!.request({
                                method: 'eth_estimateGas',
                                params: [{
                                    from: walletAddress,
                                    to: bridgeAddress,
                                    data: withdrawCalldata,
                                    value: '0x' + nativeFee.toString(16),
                                }]
                            });
                            // Add 30% buffer — MPC operations have significant gas variance between
                            // estimation and execution, 10% is not enough and causes silent reverts.
                            gasLimit = (BigInt(gasEstimateHex) * 130n) / 100n;
                            console.log(`🔍 Withdraw gas estimation successful: ${BigInt(gasEstimateHex).toString()} → with 30% buffer: ${gasLimit.toString()}`);
                        } catch (estimateErr: any) {
                            console.warn("⚠️ Withdraw gas estimation failed, falling back to 12M:", estimateErr);
                            if (estimateErr.message) console.warn("   Reason:", estimateErr.message);
                            // Check if gas estimation failed due to OracleTimestampMismatch
                            if (estimateErr?.message && estimateErr.message.includes('OracleTimestampMismatch')) {
                                throw estimateErr;
                            }
                        }

                        const rawTxHash = await getEthereumProvider()!.request({
                            method: 'eth_sendTransaction',
                            params: [{
                                from: walletAddress,
                                to: bridgeAddress,
                                data: withdrawCalldata,
                                value: '0x' + nativeFee.toString(16),
                                gas: '0x' + gasLimit.toString(16)
                            }]
                        });
                        return rawTxHash;
                    };

                    let rawWithdrawTxHash: string;
                    try {
                        rawWithdrawTxHash = await sendWithdraw();
                    } catch (withdrawErr: any) {
                        // Handle OracleTimestampMismatch by re-fetching timestamps and retrying once
                        const errMsg = withdrawErr?.message || withdrawErr?.error?.message || '';
                        if (errMsg.includes('OracleTimestampMismatch')) {
                            console.warn("⚠️ OracleTimestampMismatch detected on withdraw, re-fetching timestamps and retrying...");
                            await fetchWithdrawOracleTimestamps();
                            rawWithdrawTxHash = await sendWithdraw();
                        } else {
                            throw withdrawErr;
                        }
                    }

                    console.log("Transaction sent:", rawWithdrawTxHash);
                    onProgress?.('transfer-start');

                    // We mock a transaction response shape for the shared logic below
                    tx = {
                        hash: rawWithdrawTxHash,
                        wait: async () => await provider.waitForTransaction(rawWithdrawTxHash)
                    } as any;

                } catch (e) {
                    setIsBridgingLoading(false);
                    setToastState(prev => ({ ...prev, visible: false }));
                    throw e;
                }
            }

            // ... (Rest of function)

            // Gas Estimation Logic (Updated also)
            // ... (Wait, I need to update Gas Estimation separately below)


            console.log("Transaction sent:", tx.hash);

            // Show processing toast now that we have the tx
            setToastState({
                visible: true,
                title: 'Processing Transaction',
                message: 'Transaction sent to network. Waiting for confirmation...'
            });

            const receipt = await tx.wait();
            console.log("Transaction confirmed:", receipt);
            console.log(`⛽️ Gas used: ${receipt.gasUsed?.toString()} / limit: ${receipt.gasLimit?.toString() ?? 'n/a'}`);

            // Validate transaction succeeded on-chain
            if (receipt.status !== 1) {
                const gasUsed = receipt.gasUsed ? Number(receipt.gasUsed) : 0;
                const txHashStr = tx.hash || receipt.hash || '';
                console.warn(`⚠️ Transaction reverted on-chain. Gas used: ${gasUsed}, tx: ${txHashStr}`);

                // Try to extract revert reason by replaying the tx via eth_call
                let revertReason = '';
                try {
                    const provider = new ethers.BrowserProvider(window.ethereum);
                    // Replay the failed tx to get the revert data
                    await provider.call({
                        to: receipt.to,
                        from: receipt.from,
                        data: receipt.data || undefined,
                        value: receipt.value || undefined,
                        blockTag: receipt.blockNumber,
                    });
                } catch (replayErr: any) {
                    // The replay should fail with the revert reason
                    const errorName = replayErr.errorName || replayErr.revert?.name;
                    const revertData = replayErr.data || replayErr.error?.data;

                    // Check known error names
                    const knownErrors: Record<string, string> = {
                        'InsufficientCotiFee': 'Not enough COTI to pay the portal fee.',
                        'InsufficientEthBalance': 'Not enough COTI balance to pay gas fees.',
                        'DepositBelowMinimum': 'Deposit amount is below the minimum allowed.',
                        'DepositExceedsMaximum': 'Deposit amount exceeds the maximum allowed.',
                        'WithdrawBelowMinimum': 'Withdrawal amount is below the minimum allowed.',
                        'WithdrawExceedsMaximum': 'Withdrawal amount exceeds the maximum allowed.',
                        'DepositDisabled': 'Deposits are currently disabled for this bridge.',
                        'BridgePaused': 'Bridge is currently paused.',
                        'AmountZero': 'Amount cannot be zero.',
                        'InsufficientBridgeLiquidity': 'Insufficient bridge liquidity.',
                        'TokenTransferFailed': 'Token transfer failed. Check balance and approval.',
                    };

                    if (errorName && knownErrors[errorName]) {
                        revertReason = knownErrors[errorName];
                    } else if (replayErr.reason) {
                        revertReason = replayErr.reason;
                    } else if (replayErr.shortMessage) {
                        revertReason = replayErr.shortMessage;
                    } else if (revertData && typeof revertData === 'string' && revertData.length >= 10) {
                        revertReason = `Revert data: ${revertData.slice(0, 10)}`;
                    }
                }

                const baseMsg = 'Transaction failed on-chain.';
                const detail = revertReason ? ` Reason: ${revertReason}` : '';
                const txLink = txHashStr ? ` TX: ${txHashStr}` : '';
                throw new CotiPluginError(CotiErrorCode.TRANSACTION_REVERTED, `${baseMsg}${detail}${txLink}`, revertReason || undefined);
            }

            onProgress?.('transfer-complete', tx.hash);

            // Update balances (simple mock update for UI responsiveness, real fetch should happen too)
            if (txPublicToken && txAmount) {
                const amountNum = parseFloat(txAmount);

                if (txDirection === 'to-private') {
                    setPublicTokens(prev => prev.map(t =>
                        t.symbol === txPublicToken.symbol
                            ? { ...t, balance: formatTokenBalanceDisplay(t.symbol, parseFloat(t.balance) - amountNum) }
                            : t
                    ));
                    setPrivateTokens(prev => prev.map(t =>
                        t.symbol === 'p.' + txPublicToken.symbol
                            ? { ...t, balance: formatTokenBalanceDisplay(t.symbol, parseFloat(t.balance) + amountNum) }
                            : t
                    ));
                } else {
                    setPublicTokens(prev => prev.map(t =>
                        t.symbol === txPublicToken.symbol
                            ? { ...t, balance: formatTokenBalanceDisplay(t.symbol, parseFloat(t.balance) + amountNum) }
                            : t
                    ));
                    setPrivateTokens(prev => prev.map(t =>
                        t.symbol === 'p.' + txPublicToken.symbol
                            ? { ...t, balance: formatTokenBalanceDisplay(t.symbol, parseFloat(t.balance) - amountNum) }
                            : t
                    ));
                }
            }

            if (refreshPrivateBalances) {
                console.log("🔄 Triggering immediate balance refresh...");
                refreshPrivateBalances().catch(console.error);
            }

            setToastState({
                visible: true,
                title: 'Transaction Successful',
                message: txDirection === 'to-private'
                    ? `Successfully deposited ${txAmount} ${txPublicToken.symbol} to your private balance.`
                    : `Successfully withdrew ${txAmount} ${txPublicToken.symbol} to your public balance.`
            });

        } catch (error: any) {
            console.error("Transaction failed:", error);

            // In ethers v6, tx.wait() throws CALL_EXCEPTION with receipt attached when tx reverts.
            // Try to decode the custom revert error from the contract ABI.
            if (error.code === 'CALL_EXCEPTION') {
                const revertData = error.data || error.error?.data;
                const errorName = error.errorName || error.revert?.name;
                const gasUsed = error.receipt?.gasUsed ? Number(error.receipt.gasUsed) : 0;
                console.warn(`⚠️ CALL_EXCEPTION on-chain revert. Error: ${errorName || 'unknown'}, Gas used: ${gasUsed}`);

                // Map known contract custom errors to user-friendly messages
                const knownErrors: Record<string, string> = {
                    'InsufficientCotiFee': 'Not enough COTI to pay the portal fee. Please add COTI to your wallet.',
                    'InsufficientEthBalance': 'Not enough COTI balance to pay gas fees. Please add COTI to your wallet.',
                    'DepositBelowMinimum': 'Deposit amount is below the minimum allowed.',
                    'DepositExceedsMaximum': 'Deposit amount exceeds the maximum allowed.',
                    'WithdrawBelowMinimum': 'Withdrawal amount is below the minimum allowed.',
                    'WithdrawExceedsMaximum': 'Withdrawal amount exceeds the maximum allowed.',
                    'DepositDisabled': 'Deposits are currently disabled for this bridge.',
                    'AmountZero': 'Amount cannot be zero.',
                    'InsufficientBridgeLiquidity': 'Insufficient bridge liquidity. Please try a smaller amount.',
                    'TokenTransferFailed': 'Token transfer failed. Please check your token balance and approval.',
                    'InsufficientAccumulatedFees': 'Insufficient accumulated fees.',
                };

                if (errorName && knownErrors[errorName]) {
                    throw new CotiPluginError(CotiErrorCode.TRANSACTION_REVERTED, knownErrors[errorName], errorName);
                }

                // Try to match revert data against known error selectors if errorName wasn't decoded
                if (revertData && typeof revertData === 'string' && revertData.length >= 10) {
                    const selector = revertData.slice(0, 10);
                    const selectorMap: Record<string, string> = {
                        '0x83b5f08b': 'Not enough COTI to pay the portal fee. Please add COTI to your wallet.',
                        '0xb6d6e7d6': 'Not enough COTI balance to pay gas fees. Please add COTI to your wallet.',
                        '0xc24b1b61': 'Deposit amount is below the minimum allowed.',
                        '0xd630062d': 'Deposit amount exceeds the maximum allowed.',
                        '0x0fdbcf37': 'Withdrawal amount is below the minimum allowed.',
                        '0x9aae5367': 'Withdrawal amount exceeds the maximum allowed.',
                        '0xfb291504': 'Deposits are currently disabled for this bridge.',
                        '0xcbca5aa2': 'Amount cannot be zero.',
                        '0xaae25839': 'Insufficient bridge liquidity. Please try a smaller amount.',
                        '0x045c4b02': 'Token transfer failed. Please check your token balance and approval.',
                    };
                    if (selectorMap[selector]) {
                        throw new CotiPluginError(CotiErrorCode.TRANSACTION_REVERTED, selectorMap[selector], selector);
                    }
                }

                // Generic revert — show the raw reason if available
                const reason = error.reason || error.shortMessage || 'Transaction reverted on-chain.';
                throw new CotiPluginError(CotiErrorCode.TRANSACTION_REVERTED, reason);
            }

            let errorMessage = error.reason || error.message || "Unknown error occurred";

            if (errorMessage.includes("user rejected")) {
                errorMessage = "Transaction rejected by user.";
            }

            setToastState({
                visible: true,
                title: 'Transaction Failed',
                message: errorMessage
            });
            // Re-throw so the caller (handleSwap) knows it failed
            throw error;
        } finally {
            setIsBridgingLoading(false);
        }
    }, [publicTokens, walletAddress, setPublicTokens, setPrivateTokens, setToastState, getAESKeyFromSnap, handleOnboard]);

    const handleSwap = useCallback(async (
        overrideAmount?: string,
        overrideDirection?: 'to-private' | 'to-public',
        overrideTokenIndex?: number,
        onProgress?: (stage: SwapProgressStage, txHash?: string) => void
    ) => {
        // Resolve values: use overrides if provided, otherwise use current state
        const currentAmount = overrideAmount !== undefined ? overrideAmount : amount;
        const currentDirection = overrideDirection !== undefined ? overrideDirection : direction;
        const currentIndex = overrideTokenIndex !== undefined ? overrideTokenIndex : selectedTokenIndex;

        const currentAmountNum = parseFloat(currentAmount);

        // Basic validation
        if (!currentAmount || !!error || currentAmountNum <= 0) return;

        // Prevent duplicate submissions while a transaction is already in progress
        if (isBridgingLoading) {
            console.warn("⚠️ Transaction already in progress, ignoring duplicate submission.");
            return;
        }

        // Check for Snap connection (Required before bridging)
        // ERC20 to-private deposits do not require the Snap — skip the gate for those.
        const isErc20Token = ['WETH', 'WBTC', 'USDT', 'USDC.e', 'WADA', 'gCOTI'].includes(publicTokens[currentIndex]?.symbol);
        const snapRequired = currentDirection === 'to-public' || !isErc20Token;

        if (snapRequired && !hasSnap) {
            try {
                const aesKey = await getAESKeyFromSnap(walletAddress);
                if (aesKey) {
                    setHasSnap(true);
                } else {
                    console.log('⚠️ Snap connection failed or rejected in handleSwap');
                    throw new CotiPluginError(CotiErrorCode.SNAP_CONNECT_FAILED, 'Snap connection failed or rejected');
                }
            } catch (snapErr: any) {
                // Check if error is related to missing AES key or onboarding
                const isAesKeyError = (snapErr instanceof CotiPluginError &&
                    (snapErr.code === CotiErrorCode.AES_KEY_MISSING || snapErr.code === CotiErrorCode.AES_KEY_MISMATCH || snapErr.code === CotiErrorCode.ACCOUNT_NOT_ONBOARDED)) ||
                    (snapErr.message && (snapErr.message.includes('AES key not found') || snapErr.message.includes('onboarding')));

                if (isAesKeyError) {
                    console.log("⚠️ Missing AES Key detected. Triggering onboarding...");
                    setToastState({
                        visible: true,
                        title: 'Missing AES Key',
                        message: 'For your security, you need to generate an AES key. Triggering onboarding...'
                    });

                    try {
                        await handleOnboard();
                        // Retry fetching key
                        const retryKey = await getAESKeyFromSnap(walletAddress);
                        if (retryKey) {
                            setHasSnap(true);
                        } else {
                            throw new CotiPluginError(CotiErrorCode.ONBOARDING_INCOMPLETE, 'Onboarding incomplete or key retrieval failed after onboarding.');
                        }
                    } catch (onboardErr) {
                        throw onboardErr;
                    }
                } else {
                    throw snapErr;
                }
            }
        }

        // Update state to match the transaction for UI consistency 
        // (This ensures the UI reflects what's actually being bridged if initiated from a preset or reverse)
        if (overrideAmount !== undefined) setAmount(overrideAmount);
        if (overrideDirection !== undefined) setDirection(overrideDirection);
        if (overrideTokenIndex !== undefined) setSelectedTokenIndex(overrideTokenIndex);

        // Execute the transaction
        await executeTransaction(currentAmount, currentDirection, currentIndex, onProgress);
    }, [
        amount, direction, selectedTokenIndex, error, hasSnap, isBridgingLoading,
        setAmount, setDirection, setSelectedTokenIndex, setHasSnap,
        getAESKeyFromSnap, executeTransaction, handleOnboard
    ]);

    // Gas Estimation State
    const [estimatedGasFee, setEstimatedGasFee] = useState<string | null>(null);
    const [isGasEstimating, setIsGasEstimating] = useState(false);

    // Gas Estimation Logic
    const updateGasFee = useCallback(async () => {
        const tokenSymbol = publicTokens[selectedTokenIndex]?.symbol || '';
        if (!isConnected || !window.ethereum) {
            setEstimatedGasFee(null);
            return;
        }

        // Use a fixed reference amount for estimation — gas cost is independent of amount
        // for MPC operations, and using the user's typed amount causes re-estimation on
        // every keystroke which fails mid-type and falls back to the inflated 900k fallback.
        const estimationAmount = "1";

        setIsGasEstimating(true);

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const network = await provider.getNetwork();
            const currentChainId = Number(network.chainId);
            const addresses = CONTRACT_ADDRESSES[currentChainId];

            if (!addresses) {
                setIsGasEstimating(false);
                return;
            }

            const symbol = tokenSymbol.replace('p.', '');
            const isWeth = symbol === 'WETH';
            const isWbtc = symbol === 'WBTC';
            const isUsdt = symbol === 'USDT';
            const isUsdcE = symbol === 'USDC.e';
            const isWada = symbol === 'WADA';
            const isGCoti = symbol === 'gCOTI';
            const isErc20Token = isWeth || isWbtc || isUsdt || isUsdcE || isWada || isGCoti;

            let bridgeAddress: string | undefined;
            if (isWeth) bridgeAddress = addresses.PrivacyBridgeWETH;
            else if (isWbtc) bridgeAddress = addresses.PrivacyBridgeWBTC;
            else if (isUsdt) bridgeAddress = addresses.PrivacyBridgeUSDT;
            else if (isUsdcE) bridgeAddress = addresses.PrivacyBridgeUSDCe;
            else if (isWada) bridgeAddress = addresses.PrivacyBridgeWADA;
            else if (isGCoti) bridgeAddress = addresses.PrivacyBridgegCOTI;
            else bridgeAddress = addresses.PrivacyBridgeCotiNative;

            if (!bridgeAddress) {
                setIsGasEstimating(false);
                return;
            }

            let publicDecimals = 18;
            let privateDecimals = 18;
            if (isWbtc) { publicDecimals = 8; privateDecimals = 8; }
            else if (isUsdt || isUsdcE || isWada) { publicDecimals = 6; privateDecimals = 6; }

            const decimals = direction === 'to-private' ? publicDecimals : privateDecimals;
            const amountWei = ethers.parseUnits(estimationAmount, decimals);

            // Get current gas price
            let gasPrice = 1000000000n; // 1 Gwei default
            try {
                const gasPriceHex = await provider.send("eth_gasPrice", []);
                gasPrice = BigInt(gasPriceHex);
            } catch (err) {
                console.warn("⚠️ eth_gasPrice failed, using default (1 Gwei).");
            }

            // Compute dynamic fee for msg.value (ERC20 bridges) via on-chain estimation
            let nativeCotiFee = 0n;
            if (isErc20Token) {
                try {
                    const rpcUrl = Number((await provider.getNetwork()).chainId) === 7082400
                        ? 'https://testnet.coti.io/rpc' : 'https://mainnet.coti.io/rpc';
                    const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
                    const isDeposit = direction === 'to-private';
                    const feeEstimate = await estimateBridgeFee(symbol, estimationAmount, rpcProvider);
                    const feeStr = isDeposit ? feeEstimate.depositFee : feeEstimate.withdrawFee;
                    if (feeStr !== 'Error') {
                        const feeWei = ethers.parseEther(feeStr);
                        nativeCotiFee = (feeWei * 101n) / 100n;
                    }
                } catch (e) {
                    console.warn("⚠️ Could not compute dynamic fee for gas estimation");
                }
            }

            // Build calldata for eth_estimateGas using the same shape as the actual tx.
            // For ERC20 encrypted deposits: eth_estimateGas is unreliable —
            //   - plain deposit(uint256) underestimates (skips MPC path) → ~400k vs real ~790k–900k
            //   - encrypted deposit with zeroed ciphertext reverts on allowance/balance check
            //     unless the user already has allowance, which is why WADA works but others don't.
            // Solution: skip estimation for ERC20 deposits and use observed actuals directly.
            // For withdraw and native COTI deposit the plain overloads estimate accurately.
            let calldata: string;
            let msgValue = nativeCotiFee;

            if (direction === 'to-private' && isErc20Token) {
                // Skip eth_estimateGas — use observed on-chain actual directly
                const estimatedFeeWei = 790000n * gasPrice;
                setEstimatedGasFee(ethers.formatEther(estimatedFeeWei).replace(/\.?0+$/, '') || '0');
                console.log(`⛽️ ERC20 deposit: using observed gas constant 790000`);
                return;
            } else if (direction === 'to-private') {
                // Native COTI: deposit(cotiOracleTimestamp, tokenOracleTimestamp) is payable, value = amountWei
                const iface = new ethers.Interface(["function deposit(uint256 cotiOracleTimestamp, uint256 tokenOracleTimestamp) payable"]);
                calldata = iface.encodeFunctionData("deposit", [0, 0]); // timestamps 0 for estimation
                msgValue = amountWei;
            } else {
                const iface = new ethers.Interface(["function withdraw(uint256 amount, uint256 cotiOracleTimestamp, uint256 tokenOracleTimestamp) payable"]);
                calldata = iface.encodeFunctionData("withdraw", [amountWei, 0, 0]); // timestamps 0 for estimation
            }

            // Attempt eth_estimateGas with the real calldata — this gives the actual gas the
            // node measures, which is what the chain will charge (not the 12M safety limit).
            let gasLimit: bigint;
            try {
                const walletAddr = await (provider.getSigner()).then(s => s.getAddress());
                const gasEstimateHex = await getEthereumProvider()!.request({
                    method: 'eth_estimateGas',
                    params: [{
                        from: walletAddr,
                        to: bridgeAddress,
                        data: calldata,
                        value: '0x' + msgValue.toString(16),
                    }]
                });
                gasLimit = BigInt(gasEstimateHex);
                console.log(`⛽️ eth_estimateGas succeeded: ${gasLimit.toString()} gas units`);
            } catch (estimateErr: any) {
                // Fallbacks for native COTI deposit and withdrawals
                const isNativeCotiDeposit = !isErc20Token && direction === 'to-private';
                gasLimit = isNativeCotiDeposit ? 660000n : 500000n;
                console.warn(`⚠️ eth_estimateGas failed, using realistic fallback (${gasLimit}):`, estimateErr?.message);
            }

            const estimatedFeeWei = gasLimit * gasPrice;
            const estimatedFeeCoti = ethers.formatEther(estimatedFeeWei);

            console.log("⛽️ Gas Fee Estimation:", {
                gasPrice: gasPrice.toString(),
                gasLimit: gasLimit.toString(),
                feeCoti: estimatedFeeCoti,
            });

            setEstimatedGasFee(ethers.formatEther(estimatedFeeWei).replace(/\.?0+$/, '') || '0');

        } catch (error) {
            console.error("Error estimating gas:", error);
            setEstimatedGasFee(null);
        } finally {
            setIsGasEstimating(false);
        }
    }, [direction, isConnected, selectedTokenIndex, publicTokens]);

    // Debounce estimation on dependency change
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            updateGasFee();
        }, 500);

        return () => clearTimeout(timeoutId);

    }, [updateGasFee]);

    // Portal Fee State — computed fee in COTI for the current amount/token/direction
    const [portalFeeCoti, setPortalFeeCoti] = useState<string | null>(null);
    const [feeDebugInfo, setFeeDebugInfo] = useState<{ cotiLastUpdated: string; tokenLastUpdated: string; blockTimestamp: string } | null>(null);
    const feeRequestId = useRef(0);

    const fetchPortalFee = useCallback(async () => {
        const requestId = ++feeRequestId.current;

        if (!isConnected || !window.ethereum) {
            setPortalFeeCoti(null);
            return;
        }
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const network = await provider.getNetwork();
            const chainId = Number(network.chainId);

            const rpcUrl = chainId === 7082400 ? 'https://testnet.coti.io/rpc' : 'https://mainnet.coti.io/rpc';
            const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);

            const symbol = publicTokens[selectedTokenIndex]?.symbol?.replace('p.', '') || '';
            const currentAmount = amount && parseFloat(amount) > 0 ? amount : '0';

            // Skip on-chain call for zero amounts — contract reverts with AmountZero
            if (currentAmount === '0') {
                if (requestId === feeRequestId.current) {
                    setPortalFeeCoti(null);
                    setFeeDebugInfo(null);
                }
                return;
            }

            const feeEstimate = await estimateBridgeFee(symbol, currentAmount, rpcProvider);
            const fee = direction === 'to-private' ? feeEstimate.depositFee : feeEstimate.withdrawFee;

            if (fee === 'Error') {
                if (requestId === feeRequestId.current) {
                    setPortalFeeCoti(null);
                    setFeeDebugInfo(null);
                }
                return;
            }

            // Strip trailing zeros
            const display = fee.replace(/\.?0+$/, '') || '0';
            // Only update if this is still the latest request
            if (requestId === feeRequestId.current) {
                setPortalFeeCoti(display === '0' ? null : display);
                setFeeDebugInfo({
                    cotiLastUpdated: feeEstimate.cotiLastUpdated,
                    tokenLastUpdated: feeEstimate.tokenLastUpdated,
                    blockTimestamp: feeEstimate.blockTimestamp,
                });
            }
        } catch (e) {
            console.warn("Could not fetch portal fee", e);
            if (requestId === feeRequestId.current) {
                setPortalFeeCoti(null);
                setFeeDebugInfo(null);
            }
        }
    }, [isConnected, publicTokens, selectedTokenIndex, direction, amount]);

    useEffect(() => {
        // Debounce portal fee calculation to avoid race conditions
        // when the user types quickly (prevents showing min fee then correct fee)
        const timeoutId = setTimeout(() => {
            fetchPortalFee();
        }, 400);

        return () => clearTimeout(timeoutId);
    }, [fetchPortalFee]);

    return {
        executeTransaction,
        handleSwap,
        isBridgingLoading,
        allowance,
        isApproving,
        handleApprove,
        checkAllowance,
        isApprovalNeeded,
        estimatedGasFee,
        updateGasFee, // Expose
        isGasEstimating, // Expose
        portalFeeCoti,
        feeDebugInfo
    };
};
