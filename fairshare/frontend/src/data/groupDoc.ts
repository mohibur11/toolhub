// One group's spreadsheet in memory: parsed views of its tabs, plus the changes to send back to Google.
// Changes are applied locally as they are made, so the returned GroupDetail is current without re-reading.
import { formatMoney, minorToInput } from '@shared/money';
import { deriveGroupState } from '@shared/settle';
import type {
  ActivityEntry,
  Expense,
  GroupDetail,
  GroupInfo,
  GroupSummary,
  Member,
  Payer,
  Payment,
  Share,
  SplitMethod,
  User,
} from '@shared/types';
import { ApiError, toGroupOpenError } from './errors';
import type { Cell, FileInfo, GoogleApi, Tabs, WriteOp } from './google';
import { APP_MARKER, bool, json, MAIN_TABS, num, readRecords, str, TABS, toRow, unescapeCell, type TabName } from './schema';

export interface MemberRow {
  email: string;
  role: 'owner' | 'member';
  active: boolean;
  name: string;
  nickname: string;
  pictureUrl: string;
  addedBy: string;
  addedAt: string;
  joinedAt: string;
  _row: number;
}
export type ExpenseRow = Expense & { _row: number };
export type PaymentRow = Payment & { _row: number };

const prefix = (email: string) => email.split('@')[0];

/** Keep the first row per key (duplicates can only come from hand edits or two devices joining at once). */
function firstBy<T>(rows: T[], key: (r: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = key(r);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export class GroupDoc {
  ops: WriteOp[] = [];

  constructor(
    readonly id: string,
    public file: FileInfo,
    readonly raw: Tabs,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  static async load(google: GoogleApi, id: string, now?: () => string): Promise<GroupDoc> {
    let file: FileInfo;
    let raw: Tabs;
    try {
      [file, raw] = await Promise.all([google.getFile(id), google.readTabs(id, MAIN_TABS)]);
    } catch (e) {
      throw toGroupOpenError(e);
    }
    if (file.trashed) throw new ApiError('NOT_FOUND', 'This group was deleted by its owner.');
    const doc = new GroupDoc(id, file, raw, now);
    if (doc.meta.app !== APP_MARKER) throw new ApiError('INVALID', "This sheet isn't a FairShare group.");
    return doc;
  }

  // ---- reading ----

  get meta(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of readRecords(this.raw.Meta)) if (str(r.key)) out[str(r.key)] = str(r.value);
    return out;
  }

  get members(): MemberRow[] {
    return firstBy(
      readRecords(this.raw.Members).map((r) => ({
        email: str(r.email).trim().toLowerCase(),
        role: (str(r.role) === 'owner' ? 'owner' : 'member') as MemberRow['role'],
        active: bool(r.active),
        name: str(r.name),
        nickname: str(r.nickname),
        pictureUrl: str(r.pictureUrl),
        addedBy: str(r.addedBy),
        addedAt: str(r.addedAt),
        joinedAt: str(r.joinedAt),
        _row: r._row,
      })),
      (m) => m.email,
    );
  }

  member(email: string): MemberRow | undefined {
    return this.members.find((m) => m.email === email);
  }

  activeEmails(): Set<string> {
    return new Set(this.members.filter((m) => m.active).map((m) => m.email));
  }

  get expenses(): ExpenseRow[] {
    return firstBy(
      readRecords(this.raw.Expenses).map((r) => ({
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
        _row: r._row,
      })),
      (e) => e.id,
    );
  }

  get payments(): PaymentRow[] {
    return firstBy(
      readRecords(this.raw.Payments).map((r) => ({
        id: str(r.paymentId),
        from: str(r.from).toLowerCase(),
        to: str(r.to).toLowerCase(),
        amountMinor: num(r.amountMinor),
        date: str(r.date),
        note: str(r.note),
        createdBy: str(r.createdBy),
        createdAt: str(r.createdAt),
        deleted: bool(r.deleted),
        _row: r._row,
      })),
      (p) => p.id,
    );
  }

  /** The Google account that owns the sheet is the group owner. */
  get ownerEmail(): string {
    return this.file.ownerEmail.toLowerCase() || this.members.find((m) => m.role === 'owner')?.email || '';
  }

  isOwner(email: string): boolean {
    return email === this.ownerEmail;
  }

  get info(): GroupInfo {
    const m = this.meta;
    return {
      id: this.id,
      name: m.name || this.file.name,
      description: m.description ?? '',
      currency: m.currency || 'BDT',
      createdBy: m.createdBy ?? '',
      createdAt: m.createdAt ?? '',
      simplifyDebts: m.simplifyDebts === undefined || m.simplifyDebts === '' ? true : bool(m.simplifyDebts),
      archived: bool(m.archived),
      ownerEmail: this.ownerEmail,
      pendingOwner: (m.pendingOwner ?? '').toLowerCase(),
    };
  }

  /** Name shown in this group: the owner's nickname for the member, their own FairShare name, then their email prefix. */
  nameOf = (email: string): string => {
    const m = this.member(email);
    return m?.nickname || m?.name || prefix(email);
  };

  memberList(): Member[] {
    const owner = this.ownerEmail;
    return this.members.map((m) => ({
      email: m.email,
      displayName: m.nickname || m.name || prefix(m.email),
      profileName: m.name || prefix(m.email),
      nickname: m.nickname || undefined,
      pictureUrl: m.pictureUrl || undefined,
      role: m.email === owner ? 'owner' : 'member',
      active: m.active,
      joinedAt: m.joinedAt,
    }));
  }

  detail(): GroupDetail {
    const expenses = this.expenses.map(({ _row, ...e }) => e);
    const payments = this.payments.map(({ _row, ...p }) => p);
    const members = this.memberList();
    const group = this.info;
    const active = members.filter((m) => m.active).map((m) => m.email);
    const { balances, settlePlan } = deriveGroupState(expenses, payments, active, group.simplifyDebts);
    return { group, members, expenses, payments, balances, settlePlan };
  }

  summary(myEmail: string): GroupSummary {
    const d = this.detail();
    const active = d.members.filter((m) => m.active);
    const times = [
      d.group.createdAt,
      ...d.expenses.map((e) => e.updatedAt),
      ...d.payments.map((p) => p.createdAt),
      ...d.members.map((m) => m.joinedAt),
    ].filter(Boolean);
    return {
      id: this.id,
      name: d.group.name,
      description: d.group.description,
      currency: d.group.currency,
      role: d.group.ownerEmail === myEmail ? 'owner' : 'member',
      memberCount: active.length,
      memberPreview: active.slice(0, 5).map((m) => ({ email: m.email, displayName: m.displayName, pictureUrl: m.pictureUrl })),
      myNetMinor: d.balances[myEmail] ?? 0,
      archived: d.group.archived,
      lastActivityAt: times.sort().pop() ?? '',
    };
  }

  // ---- writing ----

  /** Current headers of a tab, adding any the schema has gained since the sheet was made. */
  private headers(tab: TabName): string[] {
    // Activity isn't read with the group (it can be long); the app always creates it with the schema headers.
    if (tab === 'Activity') return [...TABS.Activity];
    const rows = (this.raw[tab] ??= []);
    const current = (rows[0] ?? []).map((h) => String(h));
    const missing = TABS[tab].filter((h) => !current.includes(h));
    if (!missing.length) return current;
    const next = [...current, ...missing];
    rows[0] = next;
    this.ops.push({ kind: 'update', tab, rowIndex: 0, row: next });
    return next;
  }

  append(tab: TabName, rec: Record<string, unknown>): void {
    const row = toRow(this.headers(tab), rec);
    if (tab !== 'Activity') this.raw[tab].push(row);
    const last = this.ops[this.ops.length - 1];
    if (last?.kind === 'append' && last.tab === tab) last.rows.push(row);
    else this.ops.push({ kind: 'append', tab, rows: [row] });
  }

  /** Change some fields of an existing row (by its 0-based row index). */
  updateRow(tab: TabName, rowIndex: number, changes: Record<string, unknown>): void {
    const headers = this.headers(tab);
    const current: Cell[] = this.raw[tab][rowIndex] ?? [];
    const rec: Record<string, unknown> = {};
    headers.forEach((h, c) => (rec[h] = unescapeCell(current[c] ?? '')));
    const row = toRow(headers, { ...rec, ...changes });
    this.raw[tab][rowIndex] = row;
    this.ops.push({ kind: 'update', tab, rowIndex, row });
  }

  setMeta(key: string, value: Cell): void {
    const r = readRecords(this.raw.Meta).find((x) => str(x.key) === key);
    if (!r) this.append('Meta', { key, value });
    else if (str(r.value) !== str(value)) this.updateRow('Meta', r._row, { value });
  }

  setTitle(title: string): void {
    this.file = { ...this.file, name: title };
    this.ops.push({ kind: 'title', title });
  }

  log(actor: User, action: string, entityType: ActivityEntry['entityType'], entityId: string, summary: string, details?: unknown): void {
    this.append('Activity', {
      ts: this.now(),
      actor: actor.email,
      action,
      entityType,
      entityId,
      summary,
      details: details === undefined ? '' : JSON.stringify(details),
    });
  }

  /** Keep the informational role column in line with the sheet's real owner. */
  syncRoles(): void {
    const owner = this.file.ownerEmail.toLowerCase();
    if (!owner) return;
    for (const m of this.members) {
      const role = m.email === owner ? 'owner' : 'member';
      if (m.role !== role) this.updateRow('Members', m._row, { role });
    }
  }

  saveExpense(e: Expense, splitSummary: string, existingRow?: number): void {
    const currency = this.info.currency;
    const rec = {
      expenseId: e.id,
      date: e.date,
      description: e.description,
      category: e.category,
      amount: minorToInput(e.amountMinor, currency),
      amountMinor: e.amountMinor,
      paidBy: e.payers.map((p) => `${this.nameOf(p.email)} ${formatMoney(p.amountMinor, currency)}`).join(', '),
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
    if (existingRow === undefined) this.append('Expenses', rec);
    else this.updateRow('Expenses', existingRow, rec);
  }

  addPayment(p: Payment): void {
    this.append('Payments', {
      paymentId: p.id,
      date: p.date,
      from: p.from,
      to: p.to,
      amount: minorToInput(p.amountMinor, this.info.currency),
      amountMinor: p.amountMinor,
      note: p.note,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      deleted: p.deleted,
    });
  }

  async commit(google: GoogleApi): Promise<void> {
    if (!this.ops.length) return;
    const ops = this.ops;
    this.ops = [];
    await google.write(this.id, ops);
  }
}

/** The newest `limit` activity entries, newest first. */
export async function readActivity(google: GoogleApi, groupId: string, limit: number): Promise<ActivityEntry[]> {
  let tabs: Tabs;
  try {
    tabs = await google.readTabs(groupId, ['Activity']);
  } catch (e) {
    throw toGroupOpenError(e);
  }
  return readRecords(tabs.Activity)
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

/** Tabs of a brand-new group sheet (header rows only), matching what createSpreadsheet makes. */
export function emptyTabs(): Tabs {
  return Object.fromEntries(Object.entries(TABS).map(([tab, headers]) => [tab, [[...headers]]]));
}
