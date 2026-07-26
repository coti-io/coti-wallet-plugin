export const TOKEN_BALANCE_DISPLAY_DECIMALS: Record<string, number> = {
  COTI: 4,
  "p.COTI": 4,
  WETH: 6,
  "p.WETH": 6,
  USDC: 4,
  "p.USDC": 4,
  USDT: 4,
  "p.USDT": 4,
  WBTC: 6,
  "p.WBTC": 6,
  WADA: 6,
  "p.WADA": 6,
};

export function expandExponentialNumber(numStr: string): string {
  const eString = numStr.toLowerCase().trim();
  if (!eString.includes("e")) return numStr;

  const negative = eString.startsWith("-");
  const unsigned = negative || eString.startsWith("+") ? eString.slice(1) : eString;
  const [base, exp] = unsigned.split("e");
  if (base == null || exp == null || base === "") return numStr;

  const expNum = parseInt(exp, 10);
  if (!Number.isFinite(expNum)) return numStr;

  let [intPart, decPart = ""] = base.split(".");
  if (intPart.startsWith("+")) intPart = intPart.slice(1);

  let expanded: string;
  if (expNum === 0) {
    expanded = decPart ? `${intPart}.${decPart}` : intPart;
  } else if (expNum > 0) {
    decPart = decPart.padEnd(expNum, "0");
    expanded = `${intPart}${decPart.slice(0, expNum)}.${decPart.slice(expNum)}`;
  } else {
    const absExp = Math.abs(expNum);
    intPart = intPart.padStart(absExp + 1, "0");
    expanded = `${intPart.slice(0, -absExp)}.${intPart.slice(-absExp)}${decPart}`;
  }

  if (expanded.endsWith(".")) expanded = expanded.slice(0, -1);
  return negative ? `-${expanded}` : expanded;
}

/** Expand JS scientific notation (e.g. 1e-18 → 0.000…001). */
export function formatPlainDecimal(value: string | number): string {
  return expandExponentialNumber(String(value));
}

/**
 * Dust floors from on-chain 1-wei style limits. Below this, treat as unset for UI.
 * (~a few wei on 18-decimal tokens; still far below any meaningful USDC atomic unit).
 */
export const DUST_AMOUNT_THRESHOLD = 1e-15;

export function isDustAmount(value: string | number | null | undefined): boolean {
  if (value == null || value === "") return false;
  const n = typeof value === "number" ? value : parseFloat(formatPlainDecimal(value));
  return Number.isFinite(n) && n > 0 && n < DUST_AMOUNT_THRESHOLD;
}

/**
 * Human label for portal/bridge min/max amount limits.
 * - N/A / Error preserved
 * - 0 kept (admin "no cap" convention for max)
 * - dust mins shown as "—" instead of 1e-18 / 0.000…001
 * - absurdly large / non-finite max sentinels → "0" (uncapped)
 * - otherwise plain decimal (never scientific notation)
 */
export function formatAmountLimitDisplay(value?: string | null): string {
  if (value == null || value === "") return "N/A";
  if (value === "N/A" || value === "Error") return value;
  const plain = formatPlainDecimal(value);
  const n = parseFloat(plain);
  // Non-finite or impossibly large (uint128.max-style) ⇒ uncapped.
  if (!Number.isFinite(n) || n >= 1e15) return "0";
  if (n === 0) return "0";
  if (n > 0 && n < DUST_AMOUNT_THRESHOLD) return "—";
  if (!plain.includes(".")) return plain;
  return plain.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
}

export function truncateDecimalValue(value: string | number, decimals: number): string {
  let numStr = String(value);
  if (numStr === '' || numStr === 'NaN') return '0';

  numStr = expandExponentialNumber(numStr);

  const [integerPart, decimalPart] = numStr.split('.');
  if (!decimalPart || decimals === 0) {
    return integerPart;
  }

  let truncatedDecimal = decimalPart.slice(0, decimals);

  // Remove trailing zeros
  truncatedDecimal = truncatedDecimal.replace(/0+$/, '');

  return truncatedDecimal ? `${integerPart}.${truncatedDecimal}` : integerPart;
}

export function formatTokenBalanceDisplay(symbol: string, balance: string | number): string {
  const decimals = TOKEN_BALANCE_DISPLAY_DECIMALS[symbol] ?? 4;
  return truncateDecimalValue(balance, decimals);
}

export function addThousandsSeparators(value: string | number): string {
  const [rawIntegerPart, decimalPart] = String(value).split('.');
  let integerPart = rawIntegerPart;
  integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimalPart !== undefined ? `${integerPart}.${decimalPart}` : integerPart;
}

export function formatBalanceWithNotation(value: string | number): string {
  const plain = formatPlainDecimal(value);
  const numValue = parseFloat(plain);

  if (numValue === 0 || Math.abs(numValue) < 1) {
    return addThousandsSeparators(plain);
  }

  const hasDecimals = plain.includes('.') && numValue % 1 !== 0;

  if (hasDecimals) {
    return addThousandsSeparators(plain);
  }

  const absValue = Math.abs(numValue);
  const sign = numValue < 0 ? '-' : '';

  if (absValue >= 1_000_000_000_000) {
    const exactValue = absValue / 1_000_000_000_000;
    const truncated = Math.floor(exactValue * 100) / 100;
    const formatted = truncated.toString().replace(/\.0+$/, '');
    return `${sign}${formatted}T`;
  } else if (absValue >= 1_000_000_000) {
    const exactValue = absValue / 1_000_000_000;
    const truncated = Math.floor(exactValue * 100) / 100;
    const formatted = truncated.toString().replace(/\.0+$/, '');
    return `${sign}${formatted}B`;
  } else if (absValue >= 1_000_000) {
    const exactValue = absValue / 1_000_000;
    const truncated = Math.floor(exactValue * 100) / 100;
    const formatted = truncated.toString().replace(/\.0+$/, '');
    return `${sign}${formatted}M`;
  }

  return addThousandsSeparators(plain);
}
