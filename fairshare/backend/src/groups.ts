import { CURRENCIES } from '../../shared/money';
import type { ApiActions, GroupSummary, User } from '../../shared/types';
import { newId, nowIso, withLock } from './config';
import { buildDetail, cachedDetail, finishWrite, GroupCtx, groupCtx, syncMembersTab } from './detail';
import { ApiError, invalid } from './errors';
import { createGroupSpreadsheet, logActivity } from './groupSheet';
import { notifyAdded } from './mail';
import { trashGroupReceipts } from './receipts';
import {
  allGroups,
  allMemberships,
  deleteGroupRows,
  getGroup,
  groupMemberships,
  insertGroup,
  insertMembership,
  updateGroupRow,
  updateMembership,
  usersByEmail,
} from './registry';
import { email, text } from './validate';

type Req<A extends keyof ApiActions> = ApiActions[A]['req'];

const MAX_MEMBERS = 50;

export function listGroups(user: User): GroupSummary[] {
  const memberships = allMemberships();
  const mine = memberships.filter((m) => m.email === user.email && m.active);
  const groups = new Map(allGroups().map((g) => [g.groupId, g]));
  const users = usersByEmail();
  return mine
    .map((m) => {
      const g = groups.get(m.groupId);
      if (!g) return null;
      const members = memberships.filter((x) => x.groupId === g.groupId && x.active);
      return {
        id: g.groupId,
        name: g.name,
        description: g.description,
        currency: g.currency,
        role: m.role,
        memberCount: members.length,
        memberPreview: members.slice(0, 5).map((x) => ({
          email: x.email,
          displayName: users[x.email]?.name || x.email.split('@')[0],
          pictureUrl: users[x.email]?.pictureUrl,
        })),
        myNetMinor: m.netMinor,
        archived: g.archived,
        lastActivityAt: g.lastActivityAt || g.createdAt,
      } as GroupSummary;
    })
    .filter((x): x is GroupSummary => x !== null)
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

export function createGroup(user: User, req: Req<'createGroup'>) {
  const name = text(req.name, 'Group name', 1, 60);
  const description = text(req.description ?? '', 'Description', 0, 300);
  if (!CURRENCIES.some((c) => c.code === req.currency)) invalid('Unsupported currency');
  const others = [...new Set((req.memberEmails ?? []).map(email))].filter((e) => e !== user.email);
  if (others.length + 1 > MAX_MEMBERS) invalid(`A group can have at most ${MAX_MEMBERS} members`);

  return withLock(() => {
    const groupId = newId();
    const ss = createGroupSpreadsheet(groupId, name);

    const now = nowIso();
    insertGroup({
      groupId,
      name,
      description,
      currency: req.currency,
      sheetId: ss.getId(),
      createdBy: user.email,
      createdAt: now,
      simplifyDebts: true,
      archived: false,
      version: 0,
      lastActivityAt: now,
    });
    [user.email, ...others].forEach((e, i) =>
      insertMembership({
        groupId,
        email: e,
        role: i === 0 ? 'owner' : 'member',
        addedBy: user.email,
        addedAt: now,
        active: true,
        netMinor: 0,
      }),
    );

    const ctx: GroupCtx = { actor: user.email, group: getGroup(groupId), memberships: groupMemberships(groupId), me: null!, ss };
    ctx.me = ctx.memberships[0];
    syncMembersTab(ctx);
    logActivity(ss, user.email, 'create', 'group', groupId, `${user.name} created the group "${name}"`);
    others.forEach((e) => notifyAdded(e, user, name));
    return finishWrite(ctx);
  });
}

export function getGroupDetail(user: User, req: Req<'getGroup'>) {
  const ctx = groupCtxLite(req.groupId, user.email);
  return cachedDetail(ctx);
}

/** Membership check without opening the group sheet (cache hit path). */
function groupCtxLite(groupId: string, actor: string) {
  const group = getGroup(groupId);
  const memberships = groupMemberships(groupId);
  const me = memberships.find((m) => m.email === actor && m.active);
  if (!me) throw new ApiError('FORBIDDEN', 'You are not a member of this group');
  return { actor, group, memberships, me };
}

export function updateGroup(user: User, req: Req<'updateGroup'>) {
  return withLock(() => {
    const ctx = groupCtx(req.groupId, user.email);
    const changes: Record<string, unknown> = {};
    if (req.name !== undefined) changes.name = text(req.name, 'Group name', 1, 60);
    if (req.description !== undefined) changes.description = text(req.description, 'Description', 0, 300);
    if (req.simplifyDebts !== undefined) changes.simplifyDebts = !!req.simplifyDebts;
    updateGroupRow(ctx.group, changes);
    logActivity(ctx.ss, user.email, 'update', 'group', ctx.group.groupId, `${user.name} updated group settings`, changes);
    return finishWrite(ctx);
  });
}

export function archiveGroup(user: User, req: Req<'archiveGroup'>) {
  return withLock(() => {
    const ctx = groupCtx(req.groupId, user.email);
    if (ctx.me.role !== 'owner') throw new ApiError('FORBIDDEN', 'Only the group owner can archive the group');
    updateGroupRow(ctx.group, { archived: !!req.archived });
    logActivity(
      ctx.ss,
      user.email,
      req.archived ? 'archive' : 'unarchive',
      'group',
      ctx.group.groupId,
      `${user.name} ${req.archived ? 'archived' : 'unarchived'} the group`,
    );
    return finishWrite(ctx);
  });
}

export function addMember(user: User, req: Req<'addMember'>) {
  const newEmail = email(req.email);
  return withLock(() => {
    const ctx = groupCtx(req.groupId, user.email);
    const existing = ctx.memberships.find((m) => m.email === newEmail);
    if (existing?.active) throw new ApiError('CONFLICT', `${newEmail} is already in this group`);
    if (ctx.memberships.filter((m) => m.active).length >= MAX_MEMBERS)
      invalid(`A group can have at most ${MAX_MEMBERS} members`);
    if (existing) {
      updateMembership(existing, { active: true });
    } else {
      const m = {
        groupId: ctx.group.groupId,
        email: newEmail,
        role: 'member' as const,
        addedBy: user.email,
        addedAt: nowIso(),
        active: true,
        netMinor: 0,
      };
      insertMembership(m);
      ctx.memberships = groupMemberships(ctx.group.groupId);
    }
    syncMembersTab(ctx);
    logActivity(ctx.ss, user.email, 'add', 'member', newEmail, `${user.name} added ${newEmail}`);
    notifyAdded(newEmail, user, ctx.group.name);
    return finishWrite(ctx);
  });
}

/** Owner can remove anyone (except themselves); anyone can leave. Balance must be settled first. */
export function removeMember(user: User, req: Req<'removeMember'>) {
  const target = email(req.email);
  return withLock(() => {
    const ctx = groupCtx(req.groupId, user.email);
    const m = ctx.memberships.find((x) => x.email === target && x.active);
    if (!m) throw new ApiError('NOT_FOUND', `${target} is not in this group`);
    const self = target === user.email;
    if (!self && ctx.me.role !== 'owner') throw new ApiError('FORBIDDEN', 'Only the group owner can remove members');
    if (m.role === 'owner') throw new ApiError('FORBIDDEN', 'The group owner cannot be removed');
    const { balances } = buildDetail(ctx.group, ctx.memberships, ctx.ss);
    if ((balances[target] ?? 0) !== 0)
      throw new ApiError('CONFLICT', 'This person still has an unsettled balance. Settle up first.');
    updateMembership(m, { active: false });
    syncMembersTab(ctx);
    logActivity(
      ctx.ss,
      user.email,
      self ? 'leave' : 'remove',
      'member',
      target,
      self ? `${user.name} left the group` : `${user.name} removed ${target}`,
    );
    const after = finishWrite(ctx);
    return self ? null : after;
  });
}

/**
 * Permanently remove a group: its spreadsheet and receipts go to the owner's Drive trash
 * (purged by Google after 30 days) and the group disappears from the registry.
 * Owner only; the caller must type the group name to confirm.
 */
export function deleteGroup(user: User, req: Req<'deleteGroup'>) {
  return withLock(() => {
    const ctx = groupCtxLite(req.groupId, user.email);
    if (ctx.me.role !== 'owner') throw new ApiError('FORBIDDEN', 'Only the group owner can delete the group');
    if (String(req.confirmName ?? '').trim() !== ctx.group.name.trim())
      invalid('Type the group name exactly to confirm deletion');
    // Registry first: if trashing files fails afterwards, the worst case is an orphaned file, not a broken group.
    deleteGroupRows(ctx.group.groupId);
    try {
      DriveApp.getFileById(ctx.group.sheetId).setTrashed(true);
      trashGroupReceipts(ctx.group.groupId);
    } catch (e) {
      console.warn(`Could not trash files for deleted group ${ctx.group.groupId}`, e instanceof Error ? e.message : String(e));
    }
    return null;
  });
}
