// Every FairShare action, run in the browser against the group's Google Sheet with the user's own Google access.
// (This replaces the old Apps Script server. Google enforces who can open each sheet; the checks here keep the
// group's own rules, such as "only the owner can remove members".)
import { CURRENCIES, formatMoney } from '@shared/money';
import { describeSplit } from '@shared/split';
import type { AccessEntry, ApiAction, ApiActions, Expense, GroupDetail, GroupSummary, User } from '@shared/types';
import { ApiError, invalid, toApiError } from './errors';
import type { GoogleApi } from './google';
import { emptyTabs, GroupDoc, readActivity, type MemberRow } from './groupDoc';
import { IndexStore } from './personalIndex';
import { APP_MARKER, SCHEMA_VERSION, sheetTitle, TABS } from './schema';
import { clientIdOr, email, text, validateExpense, validatePayment } from './validate';

type Req<A extends ApiAction> = ApiActions[A]['req'];
type Res<A extends ApiAction> = ApiActions[A]['res'];
export type DataApi = { [A in ApiAction]: (req: Req<A>) => Promise<Res<A>> };

export interface Account {
  email: string;
  googleName: string;
  pictureUrl?: string;
}

export interface DataDeps {
  google: GoogleApi;
  /** The signed-in Google account. */
  account: () => Promise<Account>;
  /** Address of the app, for invite links, e.g. https://example.github.io/toolhub/tools/fairshare/ */
  appUrl: string;
  now?: () => string;
  newId?: () => string;
}

export const MAX_MEMBERS = 50;

/** Run `fn` over `items` with at most `limit` running at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function createDataApi(deps: DataDeps): DataApi {
  const { google } = deps;
  const index = new IndexStore(google);
  const nowIso = deps.now ?? (() => new Date().toISOString());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const inviteLink = (groupId: string) => `${deps.appUrl}#/g/${groupId}`;

  async function me(): Promise<User> {
    const [acct, ix] = await Promise.all([deps.account(), index.get()]);
    const mail = acct.email.toLowerCase();
    return { email: mail, name: ix.profileName || acct.googleName || mail.split('@')[0], googleName: acct.googleName, pictureUrl: acct.pictureUrl };
  }

  async function open(groupId: string) {
    if (!groupId) invalid('groupId is required');
    const [doc, user] = await Promise.all([GroupDoc.load(google, groupId, nowIso), me()]);
    return { doc, user, mine: doc.member(user.email) };
  }

  /** Open a group as one of its active members. */
  async function asMember(groupId: string): Promise<{ doc: GroupDoc; user: User; mine: MemberRow }> {
    const ctx = await open(groupId);
    if (!ctx.mine?.active) throw new ApiError('FORBIDDEN', 'You are not a member of this group');
    return ctx as { doc: GroupDoc; user: User; mine: MemberRow };
  }

  async function asOwner(groupId: string, doing: string) {
    const ctx = await asMember(groupId);
    if (!ctx.doc.isOwner(ctx.user.email)) throw new ApiError('FORBIDDEN', `Only the group owner can ${doing}`);
    return ctx;
  }

  async function finish(doc: GroupDoc): Promise<GroupDetail> {
    await doc.commit(google);
    return doc.detail();
  }

  async function shareWith(doc: GroupDoc, target: string, user: User): Promise<void> {
    const message = `${user.name} added you to "${doc.info.name}" on FairShare, a free app for splitting expenses. Open the group: ${inviteLink(doc.id)}`;
    try {
      await google.share(doc.id, target, message);
    } catch (e) {
      const err = toApiError(e);
      if (err instanceof ApiError && err.code === 'NEEDS_SIGNIN') throw err;
      throw new ApiError('INVALID', `Couldn't give ${target} access: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Remove someone's Google access to the sheet (no-op if they have none). */
  async function revokeAccess(doc: GroupDoc, target: string): Promise<void> {
    const perm = (await google.listPermissions(doc.id)).find((p) => p.email.toLowerCase() === target);
    if (perm && perm.role !== 'owner') await google.unshare(doc.id, perm.id);
  }

  /** Show a group, joining it first if this account has access but isn't a member yet. */
  async function view(groupId: string): Promise<GroupDetail> {
    const { doc, user, mine } = await open(groupId);
    const now = nowIso();
    if (!mine) {
      if (doc.activeEmails().size >= MAX_MEMBERS) invalid(`This group already has ${MAX_MEMBERS} members`);
      doc.append('Members', {
        email: user.email,
        role: 'member',
        active: true,
        name: user.name,
        nickname: '',
        pictureUrl: user.pictureUrl ?? '',
        addedBy: user.email,
        addedAt: now,
        joinedAt: now,
      });
      doc.log(user, 'join', 'member', user.email, `${user.name} joined the group`);
    } else if (!mine.active) {
      throw new ApiError('FORBIDDEN', 'You are no longer a member of this group. Ask a member to add you again.');
    } else if (!mine.joinedAt || mine.name !== user.name || mine.pictureUrl !== (user.pictureUrl ?? '')) {
      doc.updateRow('Members', mine._row, { joinedAt: mine.joinedAt || now, name: user.name, pictureUrl: user.pictureUrl ?? '' });
      if (!mine.joinedAt) doc.log(user, 'join', 'member', user.email, `${user.name} joined the group`);
    }
    doc.syncRoles();
    try {
      await doc.commit(google);
    } catch (e) {
      // Read-only access or a passing glitch shouldn't hide the group; the next write reports any real problem.
      const err = toApiError(e);
      if (err instanceof ApiError && err.code === 'NEEDS_SIGNIN') throw err;
    }
    await index.add(doc.id, doc.info.name, now);
    return doc.detail();
  }

  async function setExpenseDeleted(groupId: string, expenseId: string, deleted: boolean) {
    const { doc, user } = await asMember(groupId);
    const e = doc.expenses.find((x) => x.id === expenseId);
    if (!e) throw new ApiError('NOT_FOUND', 'Expense not found');
    if (e.deleted === deleted) return doc.detail();
    doc.updateRow('Expenses', e._row, { deleted, updatedBy: user.email, updatedAt: nowIso() });
    doc.log(
      user,
      deleted ? 'delete' : 'restore',
      'expense',
      e.id,
      `${user.name} ${deleted ? 'deleted' : 'restored'} "${e.description}" (${formatMoney(e.amountMinor, doc.info.currency)})`,
    );
    return finish(doc);
  }

  const handlers: DataApi = {
    async me() {
      return { user: await me() };
    },

    async listGroups() {
      const [user, ix] = await Promise.all([me(), index.get(true)]);
      const gone: string[] = [];
      const failed: { signin: ApiError | null } = { signin: null };
      const rows = await mapLimit(ix.groups, 4, async (entry): Promise<GroupSummary | null> => {
        try {
          const doc = await GroupDoc.load(google, entry.id, nowIso);
          if (!doc.member(user.email)?.active) {
            gone.push(entry.id);
            return null;
          }
          return doc.summary(user.email);
        } catch (e) {
          const err = toApiError(e);
          if (err instanceof ApiError && ['NO_ACCESS', 'NOT_FOUND', 'INVALID'].includes(err.code)) {
            gone.push(entry.id); // deleted, or I was removed
            return null;
          }
          if (err instanceof ApiError && err.code === 'NEEDS_SIGNIN') failed.signin = err;
          return {
            id: entry.id,
            name: entry.name,
            description: '',
            currency: 'BDT',
            role: 'member',
            memberCount: 0,
            memberPreview: [],
            myNetMinor: 0,
            archived: false,
            lastActivityAt: entry.addedAt,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      });
      if (failed.signin) throw failed.signin;
      if (gone.length) await index.remove(gone);
      return rows
        .filter((r): r is GroupSummary => r !== null)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    },

    async createGroup(req) {
      const user = await me();
      const name = text(req.name, 'Group name', 1, 60);
      const description = text(req.description ?? '', 'Description', 0, 300);
      if (!CURRENCIES.some((c) => c.code === req.currency)) invalid('Unsupported currency');
      const others = [...new Set((req.memberEmails ?? []).map(email))].filter((e) => e !== user.email);
      if (others.length + 1 > MAX_MEMBERS) invalid(`A group can have at most ${MAX_MEMBERS} members`);

      const id = await google.createSpreadsheet(sheetTitle(name), TABS);
      const doc = new GroupDoc(id, { id, name: sheetTitle(name), trashed: false, ownedByMe: true, ownerEmail: user.email }, emptyTabs(), nowIso);
      const now = nowIso();
      const meta: [string, string | number | boolean][] = [
        ['app', APP_MARKER],
        ['schemaVersion', SCHEMA_VERSION],
        ['name', name],
        ['description', description],
        ['currency', req.currency],
        ['createdBy', user.email],
        ['createdAt', now],
        ['simplifyDebts', true],
        ['archived', false],
        ['pendingOwner', ''],
        ['note', 'Managed by FairShare. Change data in the app so balances stay correct.'],
      ];
      meta.forEach(([k, v]) => doc.setMeta(k, v));
      [user.email, ...others].forEach((e, i) =>
        doc.append('Members', {
          email: e,
          role: i === 0 ? 'owner' : 'member',
          active: true,
          name: i === 0 ? user.name : '',
          nickname: '',
          pictureUrl: i === 0 ? user.pictureUrl ?? '' : '',
          addedBy: user.email,
          addedAt: now,
          joinedAt: i === 0 ? now : '',
        }),
      );
      doc.log(user, 'create', 'group', id, `${user.name} created the group "${name}"`);
      await doc.commit(google);
      await index.add(id, name, now);

      // Share once the data is in place, so nobody opens a half-made group.
      const failed: string[] = [];
      for (const target of others) {
        try {
          await shareWith(doc, target, user);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'NEEDS_SIGNIN') throw e;
          failed.push(target);
        }
      }
      if (failed.length) {
        failed.forEach((t) => doc.log(user, 'shareFailed', 'member', t, `Couldn't give ${t} access to the group`));
        await doc.commit(google);
      }
      return doc.detail();
    },

    getGroup: ({ groupId }) => view(groupId),
    joinGroup: ({ groupId }) => view(groupId),

    async updateGroup(req) {
      const { doc, user } = await asMember(req.groupId);
      const info = doc.info;
      const changes: Record<string, unknown> = {};
      if (req.name !== undefined) {
        const name = text(req.name, 'Group name', 1, 60);
        if (name !== info.name) {
          changes.name = name;
          doc.setMeta('name', name);
          doc.setTitle(sheetTitle(name));
        }
      }
      if (req.description !== undefined) {
        const description = text(req.description, 'Description', 0, 300);
        if (description !== info.description) {
          changes.description = description;
          doc.setMeta('description', description);
        }
      }
      if (req.simplifyDebts !== undefined && !!req.simplifyDebts !== info.simplifyDebts) {
        changes.simplifyDebts = !!req.simplifyDebts;
        doc.setMeta('simplifyDebts', !!req.simplifyDebts);
      }
      if (Object.keys(changes).length) doc.log(user, 'update', 'group', doc.id, `${user.name} updated group settings`, changes);
      return finish(doc);
    },

    async archiveGroup(req) {
      const { doc, user } = await asOwner(req.groupId, 'archive the group');
      if (doc.info.archived === !!req.archived) return doc.detail();
      doc.setMeta('archived', !!req.archived);
      doc.log(user, req.archived ? 'archive' : 'unarchive', 'group', doc.id, `${user.name} ${req.archived ? 'archived' : 'unarchived'} the group`);
      return finish(doc);
    },

    async deleteGroup(req) {
      const { doc } = await asOwner(req.groupId, 'delete the group');
      if (String(req.confirmName ?? '').trim() !== doc.info.name.trim()) invalid('Type the group name exactly to confirm deletion');
      await google.trash(doc.id);
      await index.remove([doc.id]);
      return null;
    },

    async addMember(req) {
      const target = email(req.email);
      const { doc, user } = await asMember(req.groupId);
      const existing = doc.member(target);
      if (existing?.active) throw new ApiError('CONFLICT', `${target} is already in this group`);
      if (doc.activeEmails().size >= MAX_MEMBERS) invalid(`A group can have at most ${MAX_MEMBERS} members`);
      await shareWith(doc, target, user);
      const now = nowIso();
      if (existing) doc.updateRow('Members', existing._row, { active: true, addedBy: user.email, addedAt: now });
      else
        doc.append('Members', {
          email: target,
          role: 'member',
          active: true,
          name: '',
          nickname: '',
          pictureUrl: '',
          addedBy: user.email,
          addedAt: now,
          joinedAt: '',
        });
      doc.log(user, 'add', 'member', target, `${user.name} added ${existing ? doc.nameOf(target) : target}`);
      return finish(doc);
    },

    /** The owner can remove anyone else; anyone can leave. Their balance must be settled first. */
    async removeMember(req) {
      const target = email(req.email);
      const { doc, user } = await asMember(req.groupId);
      const m = doc.member(target);
      if (!m?.active) throw new ApiError('NOT_FOUND', `${target} is not in this group`);
      const self = target === user.email;
      if (!self && !doc.isOwner(user.email)) throw new ApiError('FORBIDDEN', 'Only the group owner can remove members');
      if (doc.isOwner(target))
        throw new ApiError('FORBIDDEN', self ? 'Make another member the owner before you leave' : 'The group owner cannot be removed');
      if ((doc.detail().balances[target] ?? 0) !== 0)
        throw new ApiError('CONFLICT', 'This person still has an unsettled balance. Settle up first.');
      const name = doc.nameOf(target);
      doc.updateRow('Members', m._row, { active: false });
      doc.log(user, self ? 'leave' : 'remove', 'member', target, self ? `${user.name} left the group` : `${user.name} removed ${name}`);
      await doc.commit(google);
      // Then take away their Google access. If Google refuses, the member list still says they left, and the
      // owner can remove the leftover access in the group settings.
      await revokeAccess(doc, target).catch(() => undefined);
      if (!self) return doc.detail();
      await index.remove([doc.id]);
      return null;
    },

    /** Owner only: rename a member inside this group. An empty nickname restores their own name. */
    async setMemberNickname(req) {
      const target = email(req.email);
      const nickname = text(req.nickname ?? '', 'Name', 0, 40);
      const { doc, user } = await asOwner(req.groupId, "change members' names");
      const m = doc.member(target);
      if (!m) throw new ApiError('NOT_FOUND', `${target} is not in this group`);
      if (m.nickname === nickname) return doc.detail();
      const before = doc.nameOf(target);
      doc.updateRow('Members', m._row, { nickname });
      doc.log(user, 'rename', 'member', target, nickname ? `${user.name} renamed ${before} to "${nickname}"` : `${user.name} reset the name of ${before}`);
      return finish(doc);
    },

    /** Set my FairShare name everywhere ('' = my Google name). Each group's member list is updated too. */
    async updateProfile(req) {
      const name = text(req.name ?? '', 'Name', 0, 40);
      await index.update((ix) => {
        if (ix.profileName === name) return false;
        ix.profileName = name;
      });
      const user = await me();
      const ix = await index.get();
      await mapLimit(ix.groups, 3, async (g) => {
        try {
          const doc = await GroupDoc.load(google, g.id, nowIso);
          const mine = doc.member(user.email);
          if (mine?.active && mine.name !== user.name) {
            doc.updateRow('Members', mine._row, { name: user.name });
            await doc.commit(google);
          }
        } catch {
          // Best effort: the name is corrected the next time this group is opened.
        }
      });
      return { user };
    },

    async addExpense(req) {
      const { doc, user } = await asMember(req.groupId);
      const fields = validateExpense(req.expense, doc.activeEmails());
      const id = clientIdOr(req.clientId, newId);
      // A retry of a save that already went through: nothing to do.
      if (doc.expenses.some((x) => x.id === id)) return doc.detail();
      const now = nowIso();
      const e: Expense = { id, ...fields, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now, deleted: false };
      doc.saveExpense(e, describeSplit(e.splitMethod, e.shares, doc.nameOf));
      doc.log(user, 'add', 'expense', id, `${user.name} added "${e.description}" (${formatMoney(e.amountMinor, doc.info.currency)})`);
      return finish(doc);
    },

    async updateExpense(req) {
      const { doc, user } = await asMember(req.groupId);
      const existing = doc.expenses.find((x) => x.id === req.expenseId);
      if (!existing) throw new ApiError('NOT_FOUND', 'Expense not found');
      if (existing.deleted) throw new ApiError('CONFLICT', 'Restore this expense before editing it');
      const fields = validateExpense(req.expense, doc.activeEmails());
      const { _row, ...before } = existing;
      const after: Expense = { ...before, ...fields, updatedBy: user.email, updatedAt: nowIso() };
      doc.saveExpense(after, describeSplit(after.splitMethod, after.shares, doc.nameOf), _row);
      doc.log(
        user,
        'update',
        'expense',
        after.id,
        `${user.name} updated "${after.description}" (${formatMoney(after.amountMinor, doc.info.currency)})`,
        { before, after },
      );
      return finish(doc);
    },

    deleteExpense: (req) => setExpenseDeleted(req.groupId, req.expenseId, true),
    restoreExpense: (req) => setExpenseDeleted(req.groupId, req.expenseId, false),

    async addPayment(req) {
      const { doc, user } = await asMember(req.groupId);
      const p = validatePayment(req.payment, doc.activeEmails());
      const id = clientIdOr(req.clientId, newId);
      if (doc.payments.some((x) => x.id === id)) return doc.detail();
      doc.addPayment({ id, ...p, createdBy: user.email, createdAt: nowIso(), deleted: false });
      doc.log(user, 'add', 'payment', id, `${doc.nameOf(p.from)} paid ${doc.nameOf(p.to)} ${formatMoney(p.amountMinor, doc.info.currency)}`);
      return finish(doc);
    },

    async deletePayment(req) {
      const { doc, user } = await asMember(req.groupId);
      const p = doc.payments.find((x) => x.id === req.paymentId);
      if (!p) throw new ApiError('NOT_FOUND', 'Payment not found');
      if (p.deleted) return doc.detail();
      doc.updateRow('Payments', p._row, { deleted: true });
      doc.log(
        user,
        'delete',
        'payment',
        p.id,
        `${user.name} deleted payment ${doc.nameOf(p.from)} → ${doc.nameOf(p.to)} ${formatMoney(p.amountMinor, doc.info.currency)}`,
      );
      return finish(doc);
    },

    // Google already limits the activity tab to people who can open the sheet, so no member check is needed.
    getActivity: (req) => readActivity(google, req.groupId, Math.min(Number(req.limit) || 200, 1000)),

    async offerOwnership(req) {
      const target = email(req.email);
      const { doc, user } = await asOwner(req.groupId, 'hand the group over');
      if (target === user.email) invalid('You already own this group');
      if (!doc.member(target)?.active) invalid(`${target} is not a member of this group`);
      const perms = await google.listPermissions(doc.id);
      const perm = perms.find((p) => p.email.toLowerCase() === target);
      if (!perm) throw new ApiError('CONFLICT', `${doc.nameOf(target)} has no Google access to the group yet. Remove and add them again.`);
      const previous = perms.find((p) => p.pendingOwner && p.id !== perm.id);
      if (previous) await google.setPendingOwner(doc.id, previous.id, false);
      await google.setPendingOwner(doc.id, perm.id, true);
      doc.setMeta('pendingOwner', target);
      doc.log(user, 'offerOwnership', 'group', doc.id, `${user.name} asked ${doc.nameOf(target)} to become the owner`);
      return finish(doc);
    },

    async cancelOwnershipOffer(req) {
      const { doc, user } = await asOwner(req.groupId, 'cancel a handover');
      const pending = doc.info.pendingOwner;
      const perm = (await google.listPermissions(doc.id)).find((p) => p.pendingOwner || p.email.toLowerCase() === pending);
      if (perm?.pendingOwner) await google.setPendingOwner(doc.id, perm.id, false);
      if (!pending) return doc.detail();
      doc.setMeta('pendingOwner', '');
      doc.log(user, 'cancelOwnership', 'group', doc.id, `${user.name} cancelled the handover to ${doc.nameOf(pending)}`);
      return finish(doc);
    },

    async acceptOwnership(req) {
      const { doc, user } = await asMember(req.groupId);
      if (doc.isOwner(user.email)) return doc.detail();
      if (doc.info.pendingOwner !== user.email) throw new ApiError('CONFLICT', "You haven't been asked to become the owner of this group");
      const previous = doc.ownerEmail;
      await google.acceptOwnership(doc.id);
      // The sheet stays in the old owner's Drive after a handover, and they keep access through it until it moves.
      await google.moveToMyDrive(doc.id).catch(() => undefined);
      doc.file = { ...doc.file, ownedByMe: true, ownerEmail: user.email };
      doc.setMeta('pendingOwner', '');
      doc.syncRoles();
      doc.log(user, 'acceptOwnership', 'group', doc.id, `${user.name} is now the owner, taking over from ${doc.nameOf(previous)}`);
      return finish(doc);
    },

    async getAccess(req) {
      const { doc } = await asMember(req.groupId);
      return accessList(doc);
    },

    async removeAccess(req) {
      const target = email(req.email);
      const { doc } = await asOwner(req.groupId, "remove people's access");
      if (doc.isOwner(target)) invalid("The owner's access can't be removed");
      if (doc.member(target)?.active) throw new ApiError('CONFLICT', `${doc.nameOf(target)} is a member. Remove them from the group instead.`);
      await revokeAccess(doc, target);
      return accessList(doc);
    },
  };

  async function accessList(doc: GroupDoc): Promise<AccessEntry[]> {
    const perms = await google.listPermissions(doc.id);
    return perms
      .filter((p) => p.email)
      .map((p) => {
        const mail = p.email.toLowerCase();
        const m = doc.member(mail);
        return { email: mail, role: p.role, pendingOwner: p.pendingOwner, member: m ? (m.active ? 'active' : 'removed') : 'none' };
      });
  }

  // Every action reports Google problems as app errors with a readable message.
  const wrapped = {} as Record<string, (req: unknown) => Promise<unknown>>;
  for (const [name, fn] of Object.entries(handlers) as [string, (req: unknown) => Promise<unknown>][]) {
    wrapped[name] = async (req) => {
      try {
        return await fn(req ?? {});
      } catch (e) {
        throw toApiError(e);
      }
    };
  }
  return wrapped as DataApi;
}
