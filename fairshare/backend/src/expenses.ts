import { formatMoney } from '../../shared/money';
import { describeSplit } from '../../shared/split';
import type { ApiActions, Expense, User } from '../../shared/types';
import { newId, nowIso, withLock } from './config';
import { finishWrite, GroupCtx, groupCtx, nameResolver } from './detail';
import { ApiError } from './errors';
import { expenseToRecord, logActivity, paymentToRecord, readExpenses, readPayments } from './groupSheet';
import { appendRecord, getSheet, updateRecord } from './sheets';
import { clientIdOr, validateExpense, validatePayment } from './validate';

type Req<A extends keyof ApiActions> = ApiActions[A]['req'];

const activeSet = (ctx: GroupCtx) => new Set(ctx.memberships.filter((m) => m.active).map((m) => m.email));

function findExpense(ctx: GroupCtx, expenseId: string) {
  const e = readExpenses(ctx.ss).find((x) => x.id === expenseId);
  if (!e) throw new ApiError('NOT_FOUND', 'Expense not found');
  return e;
}

function saveExpenseRow(ctx: GroupCtx, e: Expense, rec?: Parameters<typeof updateRecord>[1]) {
  const nameOf = nameResolver(ctx.memberships);
  const record = expenseToRecord(e, ctx.group.currency, describeSplit(e.splitMethod, e.shares, nameOf), nameOf);
  const sheet = getSheet(ctx.ss, 'Expenses');
  if (rec) updateRecord(sheet, rec, record);
  else appendRecord(sheet, record);
}

const money = (ctx: GroupCtx, minor: number) => formatMoney(minor, ctx.group.currency);

export function addExpense(user: User, req: Req<'addExpense'>) {
  return withLock(() => {
    const ctx = groupCtx(req.groupId, user.email);
    const fields = validateExpense(req.expense, activeSet(ctx));
    const id = clientIdOr(req.clientId, newId);
    // Idempotent retry: same client id already saved -> just return current state.
    if (readExpenses(ctx.ss).some((x) => x.id === id)) return finishWrite(ctx);
    const now = nowIso();
    const e: Expense = { id, ...fields, createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now, deleted: false };
    saveExpenseRow(ctx, e);
    logActivity(ctx.ss, user.email, 'add', 'expense', id, `${user.name} added "${e.description}" (${money(ctx, e.amountMinor)})`);
    return finishWrite(ctx);
  });
}

export function updateExpense(user: User, req: Req<'updateExpense'>) {
  return withLock(() => {
    const ctx = groupCtx(req.groupId, user.email);
    const existing = findExpense(ctx, req.expenseId);
    if (existing.deleted) throw new ApiError('CONFLICT', 'Restore this expense before editing it');
    const fields = validateExpense(req.expense, activeSet(ctx));
    const { _rec, ...before } = existing;
    const after: Expense = { ...before, ...fields, updatedBy: user.email, updatedAt: nowIso() };
    saveExpenseRow(ctx, after, _rec);
    logActivity(
      ctx.ss,
      user.email,
      'update',
      'expense',
      after.id,
      `${user.name} updated "${after.description}" (${money(ctx, after.amountMinor)})`,
      { before: { ...before }, after },
    );
    return finishWrite(ctx);
  });
}

function setExpenseDeleted(user: User, groupId: string, expenseId: string, deleted: boolean) {
  return withLock(() => {
    const ctx = groupCtx(groupId, user.email);
    const e = findExpense(ctx, expenseId);
    if (e.deleted === deleted) return finishWrite(ctx);
    updateRecord(getSheet(ctx.ss, 'Expenses'), e._rec, { deleted, updatedBy: user.email, updatedAt: nowIso() });
    logActivity(
      ctx.ss,
      user.email,
      deleted ? 'delete' : 'restore',
      'expense',
      e.id,
      `${user.name} ${deleted ? 'deleted' : 'restored'} "${e.description}" (${money(ctx, e.amountMinor)})`,
    );
    return finishWrite(ctx);
  });
}

export const deleteExpense = (user: User, req: Req<'deleteExpense'>) => setExpenseDeleted(user, req.groupId, req.expenseId, true);
export const restoreExpense = (user: User, req: Req<'restoreExpense'>) => setExpenseDeleted(user, req.groupId, req.expenseId, false);

export function addPayment(user: User, req: Req<'addPayment'>) {
  return withLock(() => {
    const ctx = groupCtx(req.groupId, user.email);
    const p = validatePayment(req.payment, activeSet(ctx));
    const id = clientIdOr(req.clientId, newId);
    if (readPayments(ctx.ss).some((x) => x.id === id)) return finishWrite(ctx);
    appendRecord(
      getSheet(ctx.ss, 'Payments'),
      paymentToRecord({ id, ...p, createdBy: user.email, createdAt: nowIso(), deleted: false }, ctx.group.currency),
    );
    const nameOf = nameResolver(ctx.memberships);
    logActivity(ctx.ss, user.email, 'add', 'payment', id, `${nameOf(p.from)} paid ${nameOf(p.to)} ${money(ctx, p.amountMinor)}`);
    return finishWrite(ctx);
  });
}

export function deletePayment(user: User, req: Req<'deletePayment'>) {
  return withLock(() => {
    const ctx = groupCtx(req.groupId, user.email);
    const p = readPayments(ctx.ss).find((x) => x.id === req.paymentId);
    if (!p) throw new ApiError('NOT_FOUND', 'Payment not found');
    if (!p.deleted) {
      updateRecord(getSheet(ctx.ss, 'Payments'), p._rec, { deleted: true });
      const nameOf = nameResolver(ctx.memberships);
      logActivity(
        ctx.ss,
        user.email,
        'delete',
        'payment',
        p.id,
        `${user.name} deleted payment ${nameOf(p.from)} → ${nameOf(p.to)} ${money(ctx, p.amountMinor)}`,
      );
    }
    return finishWrite(ctx);
  });
}
