// Client-side previews of server writes, so the UI updates instantly while Apps Script works (~1-2 s).
import { computeShares } from '@shared/split';
import type { ApiActions, Expense, ExpenseInput, GroupDetail, Payment } from '@shared/types';

type P<A extends keyof ApiActions> = Omit<ApiActions[A]['req'], 'groupId'>;

const nowIso = () => new Date().toISOString();

function toExpense(input: ExpenseInput, base: Partial<Expense>): Expense {
  return {
    id: '',
    createdBy: '',
    createdAt: nowIso(),
    updatedBy: '',
    updatedAt: nowIso(),
    deleted: false,
    ...base,
    description: input.description,
    category: input.category,
    amountMinor: input.amountMinor,
    date: input.date,
    splitMethod: input.splitMethod,
    payers: input.payers,
    shares: computeShares(input.amountMinor, input.splitMethod, input.splitInputs),
    notes: input.notes,
    receiptFileId: input.receiptFileId,
    pending: true,
  };
}

const setExpense = (d: GroupDetail, id: string, patch: Partial<Expense>): GroupDetail => ({
  ...d,
  expenses: d.expenses.map((e) => (e.id === id ? { ...e, ...patch, pending: true } : e)),
});

export const optimistic: Partial<Record<keyof ApiActions, (d: GroupDetail, p: never) => GroupDetail>> = {
  addExpense: (d, p: P<'addExpense'>) =>
    p.clientId ? { ...d, expenses: [...d.expenses, toExpense(p.expense, { id: p.clientId })] } : d,
  updateExpense: (d, p: P<'updateExpense'>) => {
    const old = d.expenses.find((e) => e.id === p.expenseId);
    return old ? setExpense(d, p.expenseId, toExpense(p.expense, old)) : d;
  },
  deleteExpense: (d, p: P<'deleteExpense'>) => setExpense(d, p.expenseId, { deleted: true }),
  restoreExpense: (d, p: P<'restoreExpense'>) => setExpense(d, p.expenseId, { deleted: false }),
  addPayment: (d, p: P<'addPayment'>) => {
    if (!p.clientId) return d;
    const payment: Payment = {
      id: p.clientId,
      ...p.payment,
      createdBy: '',
      createdAt: nowIso(),
      deleted: false,
      pending: true,
    };
    return { ...d, payments: [...d.payments, payment] };
  },
  deletePayment: (d, p: P<'deletePayment'>) => ({
    ...d,
    payments: d.payments.map((x) => (x.id === p.paymentId ? { ...x, deleted: true, pending: true } : x)),
  }),
  updateGroup: (d, p: P<'updateGroup'>) => ({
    ...d,
    group: {
      ...d.group,
      ...(p.name !== undefined && { name: p.name }),
      ...(p.description !== undefined && { description: p.description }),
      ...(p.simplifyDebts !== undefined && { simplifyDebts: p.simplifyDebts }),
    },
  }),
};
