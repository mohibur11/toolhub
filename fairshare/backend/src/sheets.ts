// Small "table" layer over a sheet: row 1 holds headers, records are read/written by header name,
// so columns can be reordered or appended later without breaking anything.

type Sheet = GoogleAppsScript.Spreadsheet.Sheet;
type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;
export type Rec = Record<string, unknown> & { _row: number };

/** Create the tab if needed and make sure every header exists (missing ones are appended). */
export function ensureSheet(ss: Spreadsheet, name: string, headers: string[]): Sheet {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? (sheet.getRange(1, 1, 1, lastCol).getValues()[0] as string[]) : [];
  const missing = headers.filter((h) => !existing.includes(h));
  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  const width = existing.length + missing.length;
  // Plain-text format stops Sheets from turning "2026-01-05" into a Date object.
  sheet.getRange(1, 1, sheet.getMaxRows(), width).setNumberFormat('@');
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#e6f4ea');
  sheet.setFrozenRows(1);
  return sheet;
}

export function getSheet(ss: Spreadsheet, name: string): Sheet {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Sheet tab "${name}" is missing`);
  return sheet;
}

function headersOf(sheet: Sheet): string[] {
  const lastCol = sheet.getLastColumn();
  return lastCol > 0 ? (sheet.getRange(1, 1, 1, lastCol).getValues()[0] as string[]) : [];
}

export function readRecords(sheet: Sheet): Rec[] {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0] as string[];
  return values.slice(1).map((row, i) => {
    const rec: Rec = { _row: i + 2 };
    headers.forEach((h, c) => (rec[h] = unescapeCell(row[c])));
    return rec;
  });
}

export function appendRecord(sheet: Sheet, rec: Record<string, unknown>): void {
  const headers = headersOf(sheet);
  const row = headers.map((h) => escapeCell(rec[h]));
  const r = reserveRows(sheet, 1);
  sheet.getRange(r, 1, 1, headers.length).setNumberFormat('@').setValues([row]);
}

export function appendRecords(sheet: Sheet, recs: Record<string, unknown>[]): void {
  if (!recs.length) return;
  const headers = headersOf(sheet);
  const rows = recs.map((rec) => headers.map((h) => escapeCell(rec[h])));
  const r = reserveRows(sheet, rows.length);
  sheet.getRange(r, 1, rows.length, headers.length).setNumberFormat('@').setValues(rows);
}

/** Returns the first free row, growing the sheet if it is full. */
function reserveRows(sheet: Sheet, count: number): number {
  const r = sheet.getLastRow() + 1;
  const max = sheet.getMaxRows();
  if (r + count - 1 > max) sheet.insertRowsAfter(max, Math.max(count, 500));
  return r;
}

/** Overwrite the given fields of an existing record (by its _row). */
export function updateRecord(sheet: Sheet, rec: Rec, changes: Record<string, unknown>): void {
  const headers = headersOf(sheet);
  Object.assign(rec, changes);
  const row = headers.map((h) => escapeCell(rec[h]));
  sheet.getRange(rec._row, 1, 1, headers.length).setValues([row]);
}

/** Prevent formula injection: text starting with = + - @ would otherwise be evaluated by Sheets. */
function escapeCell(v: unknown): string | number | boolean {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function unescapeCell(v: unknown): unknown {
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

/** Delete records' rows (bottom-up so earlier row numbers stay valid). */
export function deleteRecords(sheet: Sheet, recs: Rec[]): void {
  [...recs].sort((a, b) => b._row - a._row).forEach((r) => sheet.deleteRow(r._row));
}
