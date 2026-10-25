// Central registry spreadsheet (owned by the app account): users, groups, and who is in which group.
import type { User } from '../../shared/types';
import { nowIso, prop } from './config';
import { ApiError } from './errors';
import { appendRecord, bool, deleteRecords, ensureSheet, getSheet, num, readRecords, Rec, str, updateRecord } from './sheets';

export const REGISTRY_TABS = {
  Users: ['email', 'name', 'pictureUrl', 'createdAt', 'lastSeenAt'],
  Groups: [
    'groupId',
    'name',
    'description',
    'currency',
    'sheetId',
    'createdBy',
    'createdAt',
    'simplifyDebts',
    'archived',
    'version',
    'lastActivityAt',
  ],
  Memberships: ['groupId', 'email', 'role', 'addedBy', 'addedAt', 'active', 'netMinor'],
};

export interface GroupRow {
  groupId: string;
  name: string;
  description: string;
  currency: string;
  sheetId: string;
  createdBy: string;
  createdAt: string;
  simplifyDebts: boolean;
  archived: boolean;
  version: number;
  lastActivityAt: string;
  _rec: Rec;
}

export interface MembershipRow {
  groupId: string;
  email: string;
  role: 'owner' | 'member';
  addedBy: string;
  addedAt: string;
  active: boolean;
  netMinor: number;
  _rec: Rec;
}

let registrySs: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null;
export function registry() {
  if (!registrySs) registrySs = SpreadsheetApp.openById(prop('REGISTRY_SHEET_ID'));
  return registrySs;
}

export function ensureRegistryTabs(ss: GoogleAppsScript.Spreadsheet.Spreadsheet) {
  Object.entries(REGISTRY_TABS).forEach(([name, headers]) => ensureSheet(ss, name, headers));
}

const toGroup = (r: Rec): GroupRow => ({
  groupId: str(r.groupId),
  name: str(r.name),
  description: str(r.description),
  currency: str(r.currency),
  sheetId: str(r.sheetId),
  createdBy: str(r.createdBy),
  createdAt: str(r.createdAt),
  simplifyDebts: bool(r.simplifyDebts),
  archived: bool(r.archived),
  version: num(r.version),
  lastActivityAt: str(r.lastActivityAt),
  _rec: r,
});

const toMembership = (r: Rec): MembershipRow => ({
  groupId: str(r.groupId),
  email: str(r.email).toLowerCase(),
  role: str(r.role) === 'owner' ? 'owner' : 'member',
  addedBy: str(r.addedBy),
  addedAt: str(r.addedAt),
  active: bool(r.active),
  netMinor: num(r.netMinor),
  _rec: r,
});

// ---- users ----

export function upsertUser(user: User): void {
  const sheet = getSheet(registry(), 'Users');
  const existing = readRecords(sheet).find((r) => str(r.email).toLowerCase() === user.email);
  const now = nowIso();
  if (existing) {
    updateRecord(sheet, existing, { name: user.name, pictureUrl: user.pictureUrl ?? '', lastSeenAt: now });
  } else {
    appendRecord(sheet, { email: user.email, name: user.name, pictureUrl: user.pictureUrl ?? '', createdAt: now, lastSeenAt: now });
  }
}

let usersMemo: Record<string, { name: string; pictureUrl?: string }> | null = null;

export function usersByEmail(): Record<string, { name: string; pictureUrl?: string }> {
  if (usersMemo) return usersMemo;
  const out: Record<string, { name: string; pictureUrl?: string }> = {};
  readRecords(getSheet(registry(), 'Users')).forEach((r) => {
    out[str(r.email).toLowerCase()] = { name: str(r.name), pictureUrl: str(r.pictureUrl) || undefined };
  });
  return (usersMemo = out);
}

// ---- groups ----

export function allGroups(): GroupRow[] {
  return readRecords(getSheet(registry(), 'Groups')).map(toGroup);
}

export function getGroup(groupId: string): GroupRow {
  const g = allGroups().find((x) => x.groupId === groupId);
  if (!g) throw new ApiError('NOT_FOUND', 'Group not found');
  return g;
}

export function insertGroup(g: Omit<GroupRow, '_rec'>): void {
  appendRecord(getSheet(registry(), 'Groups'), g);
}

export function updateGroupRow(g: GroupRow, changes: Partial<Omit<GroupRow, '_rec'>>): void {
  updateRecord(getSheet(registry(), 'Groups'), g._rec, changes);
  Object.assign(g, changes);
}

// ---- memberships ----

export function allMemberships(): MembershipRow[] {
  return readRecords(getSheet(registry(), 'Memberships')).map(toMembership);
}

export function groupMemberships(groupId: string): MembershipRow[] {
  return allMemberships().filter((m) => m.groupId === groupId);
}

export function insertMembership(m: Omit<MembershipRow, '_rec'>): void {
  appendRecord(getSheet(registry(), 'Memberships'), m);
}

export function updateMembership(m: MembershipRow, changes: Partial<Omit<MembershipRow, '_rec'>>): void {
  updateRecord(getSheet(registry(), 'Memberships'), m._rec, changes);
  Object.assign(m, changes);
}

/** Throws unless `email` is an active member. Returns the group and the caller's membership. */
export function requireMember(groupId: string, email: string) {
  if (!groupId) throw new ApiError('INVALID', 'groupId is required');
  const group = getGroup(groupId);
  const memberships = groupMemberships(groupId);
  const me = memberships.find((m) => m.email === email && m.active);
  if (!me) throw new ApiError('FORBIDDEN', 'You are not a member of this group');
  return { group, memberships, me };
}

/**
 * After every group write: bump the cache version, and store each member's net balance
 * so the dashboard can list groups without opening every group spreadsheet.
 */
export function saveDerived(group: GroupRow, memberships: MembershipRow[], balances: Record<string, number>): void {
  updateGroupRow(group, { version: group.version + 1, lastActivityAt: nowIso() });
  const sheet = getSheet(registry(), 'Memberships');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] as string[];
  const col = headers.indexOf('netMinor') + 1;
  memberships.forEach((m) => {
    const net = balances[m.email] ?? 0;
    if (net !== m.netMinor) {
      sheet.getRange(m._rec._row, col).setValue(net);
      m.netMinor = net;
    }
  });
}

/** Remove a group and all its memberships from the registry. */
export function deleteGroupRows(groupId: string): void {
  const groups = getSheet(registry(), 'Groups');
  deleteRecords(groups, readRecords(groups).filter((r) => str(r.groupId) === groupId));
  const memberships = getSheet(registry(), 'Memberships');
  deleteRecords(memberships, readRecords(memberships).filter((r) => str(r.groupId) === groupId));
}
