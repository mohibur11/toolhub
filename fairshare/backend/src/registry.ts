// Central registry spreadsheet (owned by the app account): users, groups, and who is in which group.
import type { User } from '../../shared/types';
import { nowIso, prop } from './config';
import { ApiError } from './errors';
import { appendRecord, bool, deleteRecords, ensureSheet, getSheet, num, readRecords, Rec, str, updateRecord } from './sheets';

export const REGISTRY_TABS = {
  // name = from Google (refreshed at each login); customName = chosen in FairShare (wins when set)
  Users: ['email', 'name', 'pictureUrl', 'createdAt', 'lastSeenAt', 'customName'],
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
  // nickname = name the group owner gave this member, shown only inside that group
  Memberships: ['groupId', 'email', 'role', 'addedBy', 'addedAt', 'active', 'netMinor', 'nickname'],
};

/** Bump when REGISTRY_TABS gains columns; the registry is migrated automatically on the next request. */
const REGISTRY_SCHEMA = '2';

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
  nickname: string;
  _rec: Rec;
}

let registrySs: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null;
export function registry() {
  if (!registrySs) {
    registrySs = SpreadsheetApp.openById(prop('REGISTRY_SHEET_ID'));
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('REGISTRY_SCHEMA') !== REGISTRY_SCHEMA) {
      ensureRegistryTabs(registrySs);
      props.setProperty('REGISTRY_SCHEMA', REGISTRY_SCHEMA);
    }
  }
  return registrySs;
}

export function ensureRegistryTabs(ss: GoogleAppsScript.Spreadsheet.Spreadsheet) {
  Object.entries(REGISTRY_TABS).forEach(([name, headers]) => ensureSheet(ss, name, headers));
}

/**
 * Display names are baked into cached group details, so renaming a user invalidates them all
 * by bumping this counter (part of every cache key).
 */
export function namesVersion(): string {
  return PropertiesService.getScriptProperties().getProperty('NAMES_VERSION') ?? '0';
}

function bumpNamesVersion(): void {
  PropertiesService.getScriptProperties().setProperty('NAMES_VERSION', String(Number(namesVersion()) + 1));
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
  nickname: str(r.nickname),
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
  usersMemo = null;
}

export interface UserInfo {
  /** Effective name: the user's custom FairShare name, else their Google name. */
  name: string;
  googleName: string;
  customName: string;
  pictureUrl?: string;
}

let usersMemo: Record<string, UserInfo> | null = null;

export function usersByEmail(): Record<string, UserInfo> {
  if (usersMemo) return usersMemo;
  const out: Record<string, UserInfo> = {};
  readRecords(getSheet(registry(), 'Users')).forEach((r) => {
    const googleName = str(r.name);
    const customName = str(r.customName);
    out[str(r.email).toLowerCase()] = {
      name: customName || googleName,
      googleName,
      customName,
      pictureUrl: str(r.pictureUrl) || undefined,
    };
  });
  return (usersMemo = out);
}

/** Set (or clear with '') the name a user chose for themselves in FairShare. */
export function setCustomName(email: string, customName: string): void {
  const sheet = getSheet(registry(), 'Users');
  const rec = readRecords(sheet).find((r) => str(r.email).toLowerCase() === email);
  if (!rec) throw new ApiError('NOT_FOUND', 'User not found; please sign in again');
  updateRecord(sheet, rec, { customName });
  usersMemo = null;
  bumpNamesVersion();
}

/** The signed-in user with their FairShare name applied. */
export function withProfileName(user: User): User {
  const info = usersByEmail()[user.email];
  return info ? { ...user, name: info.name, googleName: info.googleName } : user;
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
