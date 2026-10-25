import { deriveGroupState } from '../../shared/settle';
import type { GroupDetail, Member } from '../../shared/types';
import { openGroupSheet, readExpenses, readPayments } from './groupSheet';
import { GroupRow, MembershipRow, requireMember, saveDerived, usersByEmail } from './registry';
import { getSheet } from './sheets';

type Spreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;

export interface GroupCtx {
  actor: string;
  group: GroupRow;
  memberships: MembershipRow[];
  me: MembershipRow;
  ss: Spreadsheet;
}

/** Membership check + open the group's spreadsheet. */
export function groupCtx(groupId: string, actor: string): GroupCtx {
  const { group, memberships, me } = requireMember(groupId, actor);
  return { actor, group, memberships, me, ss: openGroupSheet(group.sheetId) };
}

export function nameResolver() {
  const users = usersByEmail();
  return (email: string) => users[email]?.name || email.split('@')[0];
}

export function toMembers(memberships: MembershipRow[]): Member[] {
  const users = usersByEmail();
  return memberships.map((m) => ({
    email: m.email,
    displayName: users[m.email]?.name || m.email.split('@')[0],
    pictureUrl: users[m.email]?.pictureUrl,
    role: m.role,
    active: m.active,
    joinedAt: m.addedAt,
  }));
}

export function buildDetail(group: GroupRow, memberships: MembershipRow[], ss: Spreadsheet): GroupDetail {
  const expenses = readExpenses(ss).map(({ _rec, ...e }) => e);
  const payments = readPayments(ss).map(({ _rec, ...p }) => p);
  const active = memberships.filter((m) => m.active).map((m) => m.email);
  const { balances, settlePlan } = deriveGroupState(expenses, payments, active, group.simplifyDebts);
  return {
    group: {
      id: group.groupId,
      name: group.name,
      description: group.description,
      currency: group.currency,
      createdBy: group.createdBy,
      createdAt: group.createdAt,
      simplifyDebts: group.simplifyDebts,
      archived: group.archived,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${group.sheetId}/edit`,
      version: group.version,
    },
    members: toMembers(memberships),
    expenses,
    payments,
    balances,
    settlePlan,
  };
}

const cacheKey = (groupId: string, version: number) => `gd:${groupId}:${version}`;

function cachePut(d: GroupDetail) {
  try {
    const s = JSON.stringify(d);
    if (s.length < 95000) CacheService.getScriptCache().put(cacheKey(d.group.id, d.group.version), s, 21600);
  } catch {
    // cache is best-effort
  }
}

export function cachedDetail(ctx: Omit<GroupCtx, 'ss'> & { ss?: Spreadsheet }): GroupDetail {
  const hit = CacheService.getScriptCache().get(cacheKey(ctx.group.groupId, ctx.group.version));
  if (hit) return JSON.parse(hit) as GroupDetail;
  const d = buildDetail(ctx.group, ctx.memberships, ctx.ss ?? openGroupSheet(ctx.group.sheetId));
  cachePut(d);
  return d;
}

/** Call at the end of every write: recompute, persist balances to the registry, refresh cache. */
export function finishWrite(ctx: GroupCtx): GroupDetail {
  const d = buildDetail(ctx.group, ctx.memberships, ctx.ss);
  saveDerived(ctx.group, ctx.memberships, d.balances);
  d.group.version = ctx.group.version;
  cachePut(d);
  return d;
}

/** Mirror the member list into the group sheet so the sheet is readable on its own. */
export function syncMembersTab(ctx: GroupCtx): void {
  const sheet = getSheet(ctx.ss, 'Members');
  const rows = toMembers(ctx.memberships).map((m) => [m.email, m.displayName, m.role, m.joinedAt, m.active]);
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}
