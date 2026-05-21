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
