// Per-group spreadsheet (provided by the group creator). Holds the group's expenses, payments and log.
import { formatMoney, minorToInput } from '../../shared/money';
import type { ActivityEntry, Expense, Payer, Payment, Share, SplitMethod } from '../../shared/types';
import { nowIso, optionalProp } from './config';
import { ApiError } from './errors';
import { appendRecord, appendRecords, bool, ensureSheet, getSheet, json, num, readRecords, Rec, str } from './sheets';

type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

export const SCHEMA_VERSION = 1;

export const GROUP_TABS = {
  Meta: ['key', 'value'],
  Members: ['email', 'displayName', 'role', 'joinedAt', 'active'],
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
};

/** Accepts a full Google Sheets URL or a bare spreadsheet id. */
export function parseSheetId(input: string): string {
  const s = String(input || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  throw new ApiError('INVALID', 'That does not look like a Google Sheets link');
}

export function openGroupSheet(sheetId: string): Spreadsheet {
  try {
    return SpreadsheetApp.openById(sheetId);
  } catch {
    const owner = optionalProp('OWNER_EMAIL');
    throw new ApiError(
      'SHEET_ACCESS',
      `FairShare can't open this sheet. Share it with ${owner || 'the FairShare account'} as Editor and try again.`,
    );
  }
}

/** Create all tabs + headers. Refuses a sheet that already belongs to a different group. */
export function initGroupSheet(ss: Spreadsheet, groupId: string, groupName: string): void {
  const meta = ss.getSheetByName('Meta');
  if (meta) {
    const existing = readRecords(meta).find((r) => r.key === 'groupId');
    if (existing && existing.value && existing.value !== groupId)
      throw new ApiError('CONFLICT', 'This sheet is already used by another FairShare group. Please use a new blank sheet.');
  }
  Object.entries(GROUP_TABS).forEach(([name, headers]) => ensureSheet(ss, name, headers));
  const metaSheet = getSheet(ss, 'Meta');
  if (readRecords(metaSheet).length === 0) {
    appendRecords(metaSheet, [
      { key: 'groupId', value: groupId },
      { key: 'schemaVersion', value: SCHEMA_VERSION },
      { key: 'createdAt', value: nowIso() },
      { key: 'note', value: 'Managed by FairShare. Edit data through the app to keep balances correct.' },
    ]);
  }
  // Drop the empty default tab and give untitled sheets a friendly name.
  ss.getSheets().forEach((sh) => {
    if (!(sh.getName() in GROUP_TABS) && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
  if (/^Untitled spreadsheet$/i.test(ss.getName())) ss.rename(`FairShare – ${groupName}`);
}

// ---- parsing ----

export interface ExpenseRow extends Expense {
  _rec: Rec;
}
export interface PaymentRow extends Payment {
  _rec: Rec;
}

const toExpense = (r: Rec): ExpenseRow => ({
  id: str(r.expenseId),
  description: str(r.description),
  category: str(r.category) || 'general',
  amountMinor: num(r.amountMinor),
  date: str(r.date),
  splitMethod: (str(r.splitMethod) || 'EQUAL') as SplitMethod,
  payers: json<Payer[]>(r.payersJson, []),
  shares: json<Share[]>(r.sharesJson, []),
  notes: str(r.notes),
  receiptFileId: str(r.receiptFileId),
  createdBy: str(r.createdBy),
  createdAt: str(r.createdAt),
  updatedBy: str(r.updatedBy),
  updatedAt: str(r.updatedAt),
  deleted: bool(r.deleted),
  _rec: r,
});

const toPayment = (r: Rec): PaymentRow => ({
  id: str(r.paymentId),
  from: str(r.from).toLowerCase(),
  to: str(r.to).toLowerCase(),
  amountMinor: num(r.amountMinor),
  date: str(r.date),
  note: str(r.note),
  createdBy: str(r.createdBy),
  createdAt: str(r.createdAt),
  deleted: bool(r.deleted),
  _rec: r,
});

export function readExpenses(ss: Spreadsheet): ExpenseRow[] {
  return readRecords(getSheet(ss, 'Expenses'))
    .filter((r) => r.expenseId)
    .map(toExpense);
}

export function readPayments(ss: Spreadsheet): PaymentRow[] {
  return readRecords(getSheet(ss, 'Payments'))
    .filter((r) => r.paymentId)
    .map(toPayment);
}

export function readActivity(ss: Spreadsheet, limit: number): ActivityEntry[] {
  const rows = readRecords(getSheet(ss, 'Activity'));
  return rows
    .slice(-limit)
    .reverse()
    .map((r) => ({
      ts: str(r.ts),
      actor: str(r.actor),
      action: str(r.action),
      entityType: str(r.entityType) as ActivityEntry['entityType'],
      entityId: str(r.entityId),
      summary: str(r.summary),
    }));
}

// ---- serialising (adds human-readable columns so the sheet itself is pleasant to look at) ----

export function expenseToRecord(e: Expense, currency: string, splitSummary: string, nameOf: (email: string) => string) {
  return {
    expenseId: e.id,
    date: e.date,
    description: e.description,
    category: e.category,
    amount: minorToInput(e.amountMinor, currency),
    amountMinor: e.amountMinor,
    paidBy: e.payers.map((p) => `${nameOf(p.email)} ${formatMoney(p.amountMinor, currency)}`).join(', '),
    splitMethod: e.splitMethod,
    splitSummary,
    payersJson: JSON.stringify(e.payers),
    sharesJson: JSON.stringify(e.shares),
    notes: e.notes,
    receiptFileId: e.receiptFileId,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
    updatedBy: e.updatedBy,
    updatedAt: e.updatedAt,
    deleted: e.deleted,
  };
}

export function paymentToRecord(p: Payment, currency: string) {
  return {
    paymentId: p.id,
    date: p.date,
    from: p.from,
    to: p.to,
    amount: minorToInput(p.amountMinor, currency),
    amountMinor: p.amountMinor,
    note: p.note,
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    deleted: p.deleted,
  };
}

export function logActivity(
  ss: Spreadsheet,
  actor: string,
  action: string,
  entityType: ActivityEntry['entityType'],
  entityId: string,
  summary: string,
  details?: unknown,
): void {
  appendRecord(getSheet(ss, 'Activity'), {
    ts: nowIso(),
    actor,
    action,
    entityType,
    entityId,
    summary,
    details: details === undefined ? '' : JSON.stringify(details),
  });
}
