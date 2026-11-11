// Layout of a group's spreadsheet. Row 1 of every tab holds the headers, and records are read and written by
// header name, so columns can be reordered or added later without breaking older sheets.
import type { Cell } from './google';

export const SCHEMA_VERSION = 2;
export const APP_MARKER = 'FairShare';

export const TABS = {
  /** Key/value settings of the group. */
  Meta: ['key', 'value'],
  /**
   * name = the member's own FairShare name (written by their app); nickname = name the owner gave them here.
   * joinedAt is empty until the member opens the group for the first time.
   */
  Members: ['email', 'role', 'active', 'name', 'nickname', 'pictureUrl', 'addedBy', 'addedAt', 'joinedAt'],
  Expenses: [
    'expenseId',
    'date',
    'description',
    'category',
    'amount',
    'amountMinor',
    'paidBy',
    'splitMethod',
    'splitSummary',
    'payersJson',
    'sharesJson',
    'notes',
    'receiptFileId',
    'createdBy',
    'createdAt',
    'updatedBy',
    'updatedAt',
    'deleted',
  ],
  Payments: ['paymentId', 'date', 'from', 'to', 'amount', 'amountMinor', 'note', 'createdBy', 'createdAt', 'deleted'],
  Activity: ['ts', 'actor', 'action', 'entityType', 'entityId', 'summary', 'details'],
} as const;

export type TabName = keyof typeof TABS;

/** Tabs read to show a group. Activity can grow long, so it's read only when the activity list is opened. */
export const MAIN_TABS: TabName[] = ['Meta', 'Members', 'Expenses', 'Payments'];

export const sheetTitle = (groupName: string) => `FairShare – ${groupName}`;

// ---- records ----

export type Rec = Record<string, Cell> & { _row: number };

/** Rows -> records keyed by header. `_row` is the 0-based row index (header = 0). */
export function readRecords(rows: Cell[][] | undefined): Rec[] {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h));
  return rows.slice(1).map((row, i) => {
    const rec = { _row: i + 1 } as Rec;
    headers.forEach((h, c) => (rec[h] = unescapeCell(row[c] ?? '')));
    return rec;
  });
}

export function toRow(headers: readonly string[], rec: Record<string, unknown>): Cell[] {
  return headers.map((h) => escapeCell(rec[h]));
}

/**
 * Text starting with = + - @ would be evaluated as a formula if someone later edits the cell by hand, so it is
 * stored with a leading apostrophe and unescaped on read.
 */
function escapeCell(v: unknown): Cell {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

export function unescapeCell(v: Cell): Cell {
  return typeof v === 'string' && /^'[=+\-@]/.test(v) ? v.slice(1) : v;
}

export const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
export const num = (v: unknown): number => (v === '' || v === undefined || v === null ? 0 : Number(v));
export const bool = (v: unknown): boolean => v === true || v === 'TRUE' || v === 'true';
export function json<T>(v: unknown, fallback: T): T {
  try {
    return v ? (JSON.parse(String(v)) as T) : fallback;
  } catch {
    return fallback;
  }
}
