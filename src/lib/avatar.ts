/**
 * Token avatar generation utilities.
 *
 * Ported from coti-snap/packages/snap/src/utils/image.ts (generateTokenAvatar)
 */

/**
 * Generates a deterministic SVG avatar from a token symbol.
 * Uses the first letter of the symbol on a gray circular background.
 *
 * @param symbol - The token symbol (e.g., "COTI", "USDC").
 * @returns An SVG string suitable for inline rendering or data URI embedding.
 */
export function generateTokenAvatar(symbol: string): string {
  const firstLetter = symbol.charAt(0).toUpperCase();
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
    '  <rect width="32" height="32" rx="16" fill="#CCCCCC"/>',
    `  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="16" font-weight="400" fill="#000000" text-anchor="middle" dominant-baseline="central">${firstLetter}</text>`,
    '</svg>',
  ].join('\n');
}
