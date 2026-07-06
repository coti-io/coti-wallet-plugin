/**
 * Typed error classes for the COTI Wallet Plugin.
 *
 * Replaces string-based error matching (`error.message.includes('...')`) with
 * structured error codes that can be checked via `instanceof` or `.code`.
 */

/**
 * All known error codes emitted by the COTI Wallet Plugin.
 */
export enum CotiErrorCode {
  // ─── Wallet / Provider ─────────────────────────────────────────────────
  /** MetaMask (or any EIP-1193 provider) is not installed. */
  METAMASK_NOT_INSTALLED = 'METAMASK_NOT_INSTALLED',
  /** No EIP-1193 provider found on `window.ethereum`. */
  NO_PROVIDER = 'NO_PROVIDER',
  /** User rejected the wallet request (EIP-1193 code 4001). */
  USER_REJECTED = 'USER_REJECTED',

  // ─── Snap ──────────────────────────────────────────────────────────────
  /** COTI Snap is not installed or connection attempt failed. */
  SNAP_CONNECT_FAILED = 'SNAP_CONNECT_FAILED',
  /** User dismissed the Snap dialog (e.g., rejected key retrieval). */
  SNAP_DIALOG_REJECTED = 'SNAP_DIALOG_REJECTED',
  /** Snap is required but not available for the current wallet type. */
  SNAP_REQUIRED = 'SNAP_REQUIRED',
  /** Snap key existence check failed after retry. */
  SNAP_KEY_CHECK_FAILED = 'SNAP_KEY_CHECK_FAILED',

  // ─── AES Key / Onboarding ─────────────────────────────────────────────
  /** AES key does not match the on-chain account (decryption yields garbage). */
  AES_KEY_MISMATCH = 'AES_KEY_MISMATCH',
  /** AES key is missing or was not provided. */
  AES_KEY_MISSING = 'AES_KEY_MISSING',
  /** Account has never been onboarded to the COTI network. */
  ACCOUNT_NOT_ONBOARDED = 'ACCOUNT_NOT_ONBOARDED',
  /** Onboarding process did not complete or key retrieval failed. */
  ONBOARDING_INCOMPLETE = 'ONBOARDING_INCOMPLETE',

  // ─── Network ───────────────────────────────────────────────────────────
  /** Connected to an unsupported chain ID. */
  UNSUPPORTED_NETWORK = 'UNSUPPORTED_NETWORK',
  /** WalletConnect Cloud project ID was not configured. */
  WALLETCONNECT_PROJECT_ID_MISSING = 'WALLETCONNECT_PROJECT_ID_MISSING',

  // ─── Bridge / Transaction ──────────────────────────────────────────────
  /** Insufficient token balance for the requested operation. */
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  /** ERC20 allowance is too low for the requested bridge amount. */
  INSUFFICIENT_ALLOWANCE = 'INSUFFICIENT_ALLOWANCE',
  /** Bridge or token contract address not found for the current chain. */
  CONTRACT_NOT_FOUND = 'CONTRACT_NOT_FOUND',
  /** On-chain transaction reverted. */
  TRANSACTION_REVERTED = 'TRANSACTION_REVERTED',
  /** Oracle timestamp mismatch (stale price data). */
  ORACLE_TIMESTAMP_MISMATCH = 'ORACLE_TIMESTAMP_MISMATCH',

  // ─── API ───────────────────────────────────────────────────────────────
  /** External API (bridge tracker, cap meter) returned a non-success status. */
  API_ERROR = 'API_ERROR',

  // ─── Validation ────────────────────────────────────────────────────────
  /** Input validation failed (e.g., invalid AES key format, invalid token amount). */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

/**
 * Base error class for all COTI Wallet Plugin errors.
 *
 * Consumers can check errors via:
 * - `error instanceof CotiPluginError` (type guard)
 * - `error.code === CotiErrorCode.AES_KEY_MISMATCH` (code check)
 *
 * @example
 * ```typescript
 * try {
 *   await unlockPrivateBalances();
 * } catch (error) {
 *   if (error instanceof CotiPluginError) {
 *     switch (error.code) {
 *       case CotiErrorCode.AES_KEY_MISMATCH:
 *         // show re-onboarding UI
 *         break;
 *       case CotiErrorCode.SNAP_CONNECT_FAILED:
 *         // show snap install modal
 *         break;
 *       case CotiErrorCode.USER_REJECTED:
 *         // user cancelled, do nothing
 *         break;
 *     }
 *   }
 * }
 * ```
 */
export class CotiPluginError extends Error {
  /** Structured error code for programmatic matching. */
  public readonly code: CotiErrorCode;
  /** Optional additional context about the error. */
  public readonly detail?: string;

  constructor(code: CotiErrorCode, message?: string, detail?: string) {
    super(message ?? code);
    this.name = 'CotiPluginError';
    this.code = code;
    this.detail = detail;
    // Maintains proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, CotiPluginError.prototype);
  }
}

/**
 * Type guard to check if an unknown error is a CotiPluginError.
 */
export function isCotiPluginError(error: unknown): error is CotiPluginError {
  return error instanceof CotiPluginError;
}

/**
 * Type guard to check if an unknown error has a specific COTI error code.
 */
export function hasCotiErrorCode(error: unknown, code: CotiErrorCode): boolean {
  return isCotiPluginError(error) && error.code === code;
}
