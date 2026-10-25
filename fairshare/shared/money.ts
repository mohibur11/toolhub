// Money is always stored as integer minor units (paisa, cents...) to avoid float drift.

export interface CurrencyInfo {
  code: string;
  symbol: string;
  decimals: number;
  name: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'BDT', symbol: '৳', decimals: 2, name: 'Bangladeshi Taka' },
  { code: 'USD', symbol: '$', decimals: 2, name: 'US Dollar' },
  { code: 'EUR', symbol: '€', decimals: 2, name: 'Euro' },
  { code: 'GBP', symbol: '£', decimals: 2, name: 'British Pound' },
  { code: 'INR', symbol: '₹', decimals: 2, name: 'Indian Rupee' },
  { code: 'PKR', symbol: 'Rs', decimals: 2, name: 'Pakistani Rupee' },
  { code: 'NPR', symbol: 'Rs', decimals: 2, name: 'Nepalese Rupee' },
  { code: 'LKR', symbol: 'Rs', decimals: 2, name: 'Sri Lankan Rupee' },
  { code: 'AED', symbol: 'AED', decimals: 2, name: 'UAE Dirham' },
  { code: 'SAR', symbol: 'SAR', decimals: 2, name: 'Saudi Riyal' },
  { code: 'MYR', symbol: 'RM', decimals: 2, name: 'Malaysian Ringgit' },
  { code: 'SGD', symbol: 'S$', decimals: 2, name: 'Singapore Dollar' },
  { code: 'THB', symbol: '฿', decimals: 2, name: 'Thai Baht' },
  { code: 'CAD', symbol: 'C$', decimals: 2, name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', decimals: 2, name: 'Australian Dollar' },
  { code: 'JPY', symbol: '¥', decimals: 0, name: 'Japanese Yen' },
];

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES.find((c) => c.code === code) ?? { code, symbol: code, decimals: 2, name: code };
}

/** Parse a user-typed amount ("1,250.5") into minor units. Returns NaN when invalid. */
export function toMinor(input: string | number, currency: string): number {
  const { decimals } = currencyInfo(currency);
  const str = String(input).replace(/[,\s]/g, '').trim();
  if (!/^-?\d*(\.\d*)?$/.test(str) || str === '' || str === '.' || str === '-') return NaN;
  const negative = str.startsWith('-');
  const [intPart, fracPart = ''] = str.replace('-', '').split('.');
  const frac = fracPart.padEnd(decimals + 1, '0');
  let minor = Number(intPart || '0') * 10 ** decimals + Number(frac.slice(0, decimals) || '0');
  // round half up on the first dropped digit
  if (Number(frac[decimals]) >= 5) minor += 1;
  return negative ? -minor : minor;
}

/** Minor units -> plain decimal string without symbol ("1250.50"). Useful for form inputs. */
export function minorToInput(minor: number, currency: string): string {
  const { decimals } = currencyInfo(currency);
  if (decimals === 0) return String(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const intPart = Math.floor(abs / 10 ** decimals);
  const frac = String(abs % 10 ** decimals).padStart(decimals, '0');
  return `${sign}${intPart}.${frac}`;
}

/** Minor units -> display string with symbol and thousand separators ("৳1,250.50"). */
export function formatMoney(minor: number, currency: string, opts: { abs?: boolean } = {}): string {
  const { symbol, decimals } = currencyInfo(currency);
  const value = opts.abs ? Math.abs(minor) : minor;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const intPart = Math.floor(abs / 10 ** decimals)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = decimals > 0 ? '.' + String(abs % 10 ** decimals).padStart(decimals, '0') : '';
  return `${sign}${symbol}${intPart}${frac}`;
}
