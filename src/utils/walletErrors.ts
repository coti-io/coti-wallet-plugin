/**
 * Substring present in the Chrome runtime error that occurs when multiple
 * browser wallet extensions conflict during message passing.
 */
export const MULTIPLE_WALLETS_ERROR_SUBSTRING =
  "chrome.runtime.sendMessage() called from a webpage must specify an Extension ID";

/**
 * Determines if an error message indicates a multiple browser wallet
 * extensions conflict.
 */
export function isMultipleWalletsError(message: string | undefined | null): boolean {
  if (!message) return false;
  return message.includes(MULTIPLE_WALLETS_ERROR_SUBSTRING);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error ?? '');
}

/**
 * True when a wallet rejected an RPC call because the method is unsupported
 * (JSON-RPC -32601). Common on disconnect: wagmi's injected connector calls
 * `wallet_revokePermissions`, which Zerion and some others do not implement.
 */
export function isUnsupportedRpcMethodError(error: unknown): boolean {
  const text = errorText(error);
  if (/wallet_revokePermissions/i.test(text)) return true;
  if (/method does not exist|is not available|method not found/i.test(text)) return true;
  if (
    error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === -32601
  ) {
    return true;
  }
  return false;
}
