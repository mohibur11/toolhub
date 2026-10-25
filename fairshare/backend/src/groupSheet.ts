// Per-group spreadsheet (created by the app in the owner's "FairShare Groups" folder).
// Holds the group's expenses, payments and activity log.
import { formatMoney, minorToInput } from '../../shared/money';
import type { ActivityEntry, Expense, Payer, Payment, Share, SplitMethod } from '../../shared/types';
import { nowIso, prop } from './config';
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

/** Each group gets its own app-owned spreadsheet, so a group's reads stay small however many groups exist. */
export function createGroupSpreadsheet(groupId: string, groupName: string): Spreadsheet {
  const ss = SpreadsheetApp.create(`FairShare – ${groupName} (${groupId.slice(0, 8)})`);
  DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(prop('GROUPS_FOLDER_ID')));
  initGroupSheet(ss, groupId);
  return ss;
}

export function openGroupSheet(sheetId: string): Spreadsheet {
  try {
    return SpreadsheetApp.openById(sheetId);
  } catch {
    throw new ApiError('INTERNAL', "This group's data could not be opened. Please contact the FairShare owner.");
  }
}

/** Create all tabs + headers. */
function initGroupSheet(ss: Spreadsheet, groupId: string): void {
  Object.entries(GROUP_TABS).forEach(([name, headers]) => ensureSheet(ss, name, headers));
  const metaSheet = getSheet(ss, 'Meta');
  if (readRecords(metaSheet).length === 0) {
    appendRecords(metaSheet, [
      { key: 'groupId', value: groupId },
      { key: 'schemaVersion', value: SCHEMA_VERSION },
      { key: 'createdAt', value: nowIso() },
      { key: 'note', value: 'Managed by FairShare. Edit data through the app so balances stay correct.' },
    ]);
  }
  // Drop the empty default tab.
  ss.getSheets().forEach((sh) => {
    if (!(sh.getName() in GROUP_TABS) && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
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
