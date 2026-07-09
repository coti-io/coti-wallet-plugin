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
  const eString = numStr.toLowerCase();
  if (!eString.includes('e')) return numStr;

  const [base, exp] = eString.split('e');
  const expNum = parseInt(exp, 10);

  let [intPart, decPart = ''] = base.split('.');
  if (expNum === 0) return `${intPart}.${decPart}`;

  if (expNum > 0) {
    decPart = decPart.padEnd(expNum, '0');
    return `${intPart}${decPart.slice(0, expNum)}.${decPart.slice(expNum)}`;
  } else {
    const absExp = Math.abs(expNum);
    intPart = intPart.padStart(absExp + 1, '0');
    return `${intPart.slice(0, -absExp)}.${intPart.slice(-absExp)}${decPart}`;
  }
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
  const numValue = parseFloat(String(value));

  if (numValue === 0 || Math.abs(numValue) < 1) {
    return addThousandsSeparators(value);
  }

  const hasDecimals = String(value).includes('.') && parseFloat(String(value)) % 1 !== 0;

  if (hasDecimals) {
    return addThousandsSeparators(value);
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

  return addThousandsSeparators(value);
}
