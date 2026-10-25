import { CATEGORIES } from '../../shared/categories';
import { computeShares, SplitError, validatePayers } from '../../shared/split';
import type { Expense, ExpenseInput, PaymentInput, SplitMethod } from '../../shared/types';
import { invalid } from './errors';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const METHODS: SplitMethod[] = ['EQUAL', 'EXACT', 'PERCENT', 'SHARES'];

export function email(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(s) || s.length > 254) invalid(`"${s}" is not a valid email address`);
  return s;
}

export function text(v: unknown, field: string, min: number, max: number): string {
  const s = String(v ?? '').trim();
  if (s.length < min) invalid(min === 1 ? `${field} is required` : `${field} is too short`);
  if (s.length > max) invalid(`${field} must be at most ${max} characters`);
  return s;
}

export function date(v: unknown): string {
  const s = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) invalid('Date must be YYYY-MM-DD');
  return s;
}

function memberCheck(emails: string[], active: Set<string>) {
  const outsider = emails.find((e) => !active.has(e));
  if (outsider) invalid(`${outsider} is not a member of this group`);
}

/** Validate an expense from the client and recompute shares server-side (never trust client totals). */
export function validateExpense(
  input: ExpenseInput,
  activeMembers: Set<string>,
): Pick<Expense, 'description' | 'category' | 'amountMinor' | 'date' | 'splitMethod' | 'payers' | 'shares' | 'notes' | 'receiptFileId'> {
  if (!input || typeof input !== 'object') invalid('Expense is missing');
  const description = text(input.description, 'Description', 1, 120);
  const category = CATEGORIES.some((c) => c.id === input.category) ? input.category : 'general';
  const amountMinor = Number(input.amountMinor);
  const d = date(input.date);
  if (!METHODS.includes(input.splitMethod)) invalid('Unknown split method');
  const notes = text(input.notes ?? '', 'Notes', 0, 1000);
  const receiptFileId = String(input.receiptFileId ?? '');
  if (receiptFileId && !/^[\w-]{10,}$/.test(receiptFileId)) invalid('Invalid receipt');
  try {
    const payers = validatePayers(
      amountMinor,
      (input.payers ?? []).map((p) => ({ email: String(p.email).toLowerCase(), amountMinor: Number(p.amountMinor) })),
    );
    const shares = computeShares(
      amountMinor,
      input.splitMethod,
      (input.splitInputs ?? []).map((s) => ({
        email: String(s.email).toLowerCase(),
        value: s.value === undefined || s.value === null ? undefined : Number(s.value),
      })),
    );
    memberCheck(payers.map((p) => p.email), activeMembers);
    memberCheck(shares.map((s) => s.email), activeMembers);
    return { description, category, amountMinor, date: d, splitMethod: input.splitMethod, payers, shares, notes, receiptFileId };
  } catch (e) {
    if (e instanceof SplitError) invalid(e.message);
    throw e;
  }
}

export function validatePayment(input: PaymentInput, activeMembers: Set<string>): PaymentInput {
  if (!input || typeof input !== 'object') invalid('Payment is missing');
  const from = email(input.from);
  const to = email(input.to);
  if (from === to) invalid('Payer and receiver must be different people');
  memberCheck([from, to], activeMembers);
  const amountMinor = Number(input.amountMinor);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) invalid('Amount must be greater than zero');
  return { from, to, amountMinor, date: date(input.date), note: text(input.note ?? '', 'Note', 0, 200) };
}

/** Client-generated ids let the frontend show optimistic rows and make retries idempotent. */
export function clientIdOr(id: unknown, fallback: () => string): string {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(id) ? id : fallback();
}
