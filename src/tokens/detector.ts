/**
 * Token type detection via ERC165 interface probing and bytecode analysis.
 *
 * Ported from coti-snap/packages/snap/src/utils/token.ts (getTokenType, probeConfidentialVersion256)
 */

import { ethers } from 'ethers';

/** Classification of a token contract. */
export enum TokenClassification {
  ERC20 = 'erc20',
  ConfidentialERC20_64 = 'confidential-erc20-64',
  ConfidentialERC20_256 = 'confidential-erc20-256',
  ERC721 = 'erc721',
  ERC1155 = 'erc1155',
  Unknown = 'unknown',
}

/** Result of token type detection. */
export interface DetectionResult {
  classification: TokenClassification;
  confidential: boolean;
  confidentialVersion?: 64 | 256;
}

const ERC165_ABI = [
  'function supportsInterface(bytes4 interfaceId) external view returns (bool)',
];

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];

const ERC20_CONFIDENTIAL_ABI = [
  'function accountEncryptionAddress(address) view returns (address)',
  'function balanceOf(address) view returns (uint256)',
];

const ERC20_CONFIDENTIAL_256_ABI = [
  'function balanceOf(address) view returns (uint256, uint256)',
];

const PRIVATE_ERC20_64_INTERFACE_ID = '0x8409a9cf';
const PRIVATE_ERC20_256_INTERFACE_ID = '0xdfeb393e';
const ERC721_INTERFACE_ID = '0x80ac58cd';
const ERC1155_INTERFACE_ID = '0xd9b67a26';

/** Default timeout for provider calls (10 seconds). */
const DETECTION_TIMEOUT_MS = 10_000;

/**
 * Creates an AbortSignal that times out after the specified duration.
 */
function createTimeoutSignal(ms: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

/**
 * Wraps a promise with a timeout. Rejects with the abort reason if the timeout fires.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const { signal, cleanup } = createTimeoutSignal(ms);
  return Promise.race([
    promise.then((v) => { cleanup(); return v; }),
    new Promise<T>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Timeout')));
    }),
  ]);
}

/**
 * Checks if a value conforms to the CtUint256 shape (nested or flat).
 */
function isCtUint256Shape(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const v = value as Record<string, unknown> & Record<number, unknown>;
  const hasNested =
    v.high !== undefined &&
    v.low !== undefined &&
    typeof v.high === 'object' &&
    v.high !== null &&
    typeof v.low === 'object' &&
    v.low !== null &&
    (v.high as Record<string, unknown>).high !== undefined &&
    (v.high as Record<string, unknown>).low !== undefined &&
    (v.low as Record<string, unknown>).high !== undefined &&
    (v.low as Record<string, unknown>).low !== undefined;
  const hasFlat =
    v.ciphertextHigh !== undefined && v.ciphertextLow !== undefined;
  const hasPositional = v[0] !== undefined && v[1] !== undefined;
  return hasNested || hasFlat || hasPositional;
}

/**
 * Detects the token type for a given contract address.
 * Probes ERC165 interfaces in precedence order, falls back to bytecode analysis.
 * Times out after 10 seconds.
 *
 * @param address - The contract address to probe.
 * @param provider - An ethers Provider instance.
 * @returns A DetectionResult with classification and confidentiality info.
 */
export async function detectTokenType(
  address: string,
  provider: ethers.Provider,
): Promise<DetectionResult> {
  try {
    return await withTimeout(detectTokenTypeInternal(address, provider), DETECTION_TIMEOUT_MS);
  } catch {
    return { classification: TokenClassification.Unknown, confidential: false };
  }
}

async function detectTokenTypeInternal(
  address: string,
  provider: ethers.Provider,
): Promise<DetectionResult> {
  const erc165Contract = new ethers.Contract(address, ERC165_ABI, provider);

  // Check ERC721
  let isERC721 = false;
  try {
    isERC721 = await erc165Contract.supportsInterface(ERC721_INTERFACE_ID);
  } catch {
    isERC721 = false;
  }

  // Check ERC1155
  let isERC1155 = false;
  if (!isERC721) {
    try {
      isERC1155 = await erc165Contract.supportsInterface(ERC1155_INTERFACE_ID);
    } catch {
      isERC1155 = false;
    }
  }

  if (isERC721) {
    return { classification: TokenClassification.ERC721, confidential: false };
  }

  if (isERC1155) {
    return { classification: TokenClassification.ERC1155, confidential: false };
  }

  // Check confidential ERC20 via ERC165
  const confidentialVersion = await getPrivateErc20Version(address, provider, erc165Contract);

  if (confidentialVersion !== undefined) {
    const classification =
      confidentialVersion === 256
        ? TokenClassification.ConfidentialERC20_256
        : TokenClassification.ConfidentialERC20_64;
    return {
      classification,
      confidential: true,
      confidentialVersion,
    };
  }

  // Check standard ERC20
  const erc20Contract = new ethers.Contract(address, ERC20_ABI, provider);
  try {
    await erc20Contract.decimals();
    await erc20Contract.symbol();

    // Check if it's a confidential ERC20 via accountEncryptionAddress
    const confContract = new ethers.Contract(address, ERC20_CONFIDENTIAL_ABI, provider);
    try {
      await confContract.accountEncryptionAddress(address);
      // It has accountEncryptionAddress — it's confidential
      const probed = await probeConfidentialVersion256(address, provider);
      if (probed) {
        return {
          classification: TokenClassification.ConfidentialERC20_256,
          confidential: true,
          confidentialVersion: 256,
        };
      }
      return {
        classification: TokenClassification.ConfidentialERC20_64,
        confidential: true,
        confidentialVersion: 64,
      };
    } catch {
      // Not confidential — standard ERC20
      return { classification: TokenClassification.ERC20, confidential: false };
    }
  } catch {
    return { classification: TokenClassification.Unknown, confidential: false };
  }
}

/**
 * Determines the confidential ERC20 version via ERC165 or bytecode analysis.
 */
async function getPrivateErc20Version(
  address: string,
  provider: ethers.Provider,
  erc165Contract: ethers.Contract,
): Promise<64 | 256 | undefined> {
  try {
    const supports256 = await erc165Contract.supportsInterface(PRIVATE_ERC20_256_INTERFACE_ID);
    if (supports256) {
      return 256;
    }
    const supports64 = await erc165Contract.supportsInterface(PRIVATE_ERC20_64_INTERFACE_ID);
    if (supports64) {
      return 64;
    }
  } catch {
    // ERC165 not supported, fall through to bytecode analysis
  }

  // Bytecode fallback
  try {
    const code = await provider.getCode(address);
    if (code && code !== '0x') {
      const selector256 = ethers
        .id('transfer(address,((uint256,uint256),bytes))')
        .slice(2, 10);
      if (code.includes(selector256)) {
        return 256;
      }
      const selector64 = ethers
        .id('transfer(address,(uint256,bytes))')
        .slice(2, 10);
      if (code.includes(selector64)) {
        return 64;
      }
    }
  } catch {
    // Bytecode analysis failed
  }

  return undefined;
}

/**
 * Probes whether a token supports 256-bit confidential operations.
 * Calls `balanceOf` with the 256-bit ABI and checks if the result
 * conforms to the CtUint256 shape.
 *
 * @param address - The token contract address.
 * @param provider - An ethers Provider instance.
 * @param accountAddress - Optional account address for the balanceOf check.
 * @returns True if the token supports 256-bit confidential operations.
 */
export async function probeConfidentialVersion256(
  address: string,
  provider: ethers.Provider,
  accountAddress?: string,
): Promise<boolean> {
  try {
    return await withTimeout(
      probeConfidentialVersion256Internal(address, provider, accountAddress),
      DETECTION_TIMEOUT_MS,
    );
  } catch {
    return false;
  }
}

async function probeConfidentialVersion256Internal(
  address: string,
  provider: ethers.Provider,
  accountAddress?: string,
): Promise<boolean> {
  try {
    const contract = new ethers.Contract(address, ERC20_CONFIDENTIAL_256_ABI, provider);
    const targetAddress =
      accountAddress && ethers.isAddress(accountAddress)
        ? accountAddress
        : ethers.ZeroAddress;
    const balance = await contract.getFunction('balanceOf')(targetAddress);
    return isCtUint256Shape(balance);
  } catch {
    return false;
  }
}
