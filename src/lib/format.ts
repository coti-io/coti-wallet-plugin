/**
 * Extended formatting utilities for Ethereum addresses and values.
 */

/**
 * Truncates an Ethereum address to show first and last N characters.
 * The total visible characters (excluding "...") equals `length`.
 *
 * @param address - A full Ethereum address (42 characters including "0x").
 * @param length - Number of visible characters to keep (split between start and end). Default: 10.
 * @returns The truncated address (e.g., "0xAbCd...ef12").
 *
 * @example
 * truncateAddress("0x1234567890abcdef1234567890abcdef12345678", 10)
 * // => "0x123...45678"
 */
export function truncateAddress(address: string, length: number = 10): string {
  if (!address || address.length <= length) {
    return address;
  }

  const start = Math.ceil(length / 2);
  const end = Math.floor(length / 2);

  return `${address.slice(0, start)}...${address.slice(-end)}`;
}
