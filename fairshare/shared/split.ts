import type { Payer, Share, SplitInput, SplitMethod } from './types';

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitError';
  }
}

export const MAX_AMOUNT_MINOR = 100_000_000_000; // 1 billion major units

/**
 * Distribute `total` across integer `weights` so the parts sum exactly to `total`.
 * Uses the largest-remainder method with pure integer math; ties go to the earlier index.
 */
export function largestRemainder(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) throw new SplitError('Weights must add up to more than zero');
  const parts = weights.map((w) => Math.floor((total * w) / sumW));
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, rem: (total * w) % sumW }))
    .filter((x) => weights[x.i] > 0)
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length) {
    parts[order[k].i] += 1;
    left -= 1;
  }
  return parts;
}

function assertAmount(amountMinor: number) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new SplitError('Amount must be greater than zero');
  if (amountMinor > MAX_AMOUNT_MINOR) throw new SplitError('Amount is too large');
}

function assertUnique(emails: string[]) {
  if (new Set(emails).size !== emails.length) throw new SplitError('A person appears twice in the split');
}

/** Turn raw split inputs into exact per-person shares (in minor units) that sum to `amountMinor`. */
export function computeShares(amountMinor: number, method: SplitMethod, inputs: SplitInput[]): Share[] {
  assertAmount(amountMinor);
  if (inputs.length === 0) throw new SplitError('Select at least one person to split with');
  assertUnique(inputs.map((i) => i.email));

  switch (method) {
    case 'EQUAL': {
      // Stable order so the extra paisa always lands deterministically.
      const emails = inputs.map((i) => i.email).sort();
      const parts = largestRemainder(amountMinor, emails.map(() => 1));
      return emails.map((email, i) => ({ email, shareMinor: parts[i] }));
    }
    case 'EXACT': {
      const values = inputs.map((i) => i.value ?? 0);
      if (values.some((v) => !Number.isInteger(v) || v < 0)) throw new SplitError('Each amount must be zero or more');
      const sum = values.reduce((a, b) => a + b, 0);
      if (sum !== amountMinor) throw new SplitError('Individual amounts must add up to the total');
      return inputs
        .map((i, k) => ({ email: i.email, shareMinor: values[k], input: values[k] }))
        .filter((s) => s.shareMinor > 0);
    }
    case 'PERCENT': {
      const values = inputs.map((i) => i.value ?? 0);
      if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new SplitError('Percentages must be zero or more');
      const weights = values.map((v) => Math.round(v * 100)); // 2-decimal precision
      if (weights.reduce((a, b) => a + b, 0) !== 10000) throw new SplitError('Percentages must add up to 100%');
      const parts = largestRemainder(amountMinor, weights);
      return inputs
        .map((i, k) => ({ email: i.email, shareMinor: parts[k], input: values[k] }))
        .filter((s) => s.shareMinor > 0);
    }
    case 'SHARES': {
      const values = inputs.map((i) => i.value ?? 0);
      if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new SplitError('Shares must be zero or more');
      const weights = values.map((v) => Math.round(v * 1000));
      if (weights.reduce((a, b) => a + b, 0) <= 0) throw new SplitError('Total shares must be more than zero');
      const parts = largestRemainder(amountMinor, weights);
      return inputs
        .map((i, k) => ({ email: i.email, shareMinor: parts[k], input: values[k] }))
        .filter((s) => s.shareMinor > 0);
    }
    default:
      throw new SplitError(`Unknown split method: ${method as string}`);
  }
}

/** Validate who paid. Payer amounts must be positive and sum to the expense total. */
export function validatePayers(amountMinor: number, payers: Payer[]): Payer[] {
  assertAmount(amountMinor);
  const cleaned = payers.filter((p) => p.amountMinor !== 0);
  if (cleaned.length === 0) throw new SplitError('Choose who paid');
  assertUnique(cleaned.map((p) => p.email));
  if (cleaned.some((p) => !Number.isInteger(p.amountMinor) || p.amountMinor < 0))
    throw new SplitError('Paid amounts must be positive');
  const sum = cleaned.reduce((a, p) => a + p.amountMinor, 0);
  if (sum !== amountMinor) throw new SplitError('Paid amounts must add up to the total');
  return cleaned;
}

/** Short human-readable description of a split, e.g. "Equal: a, b, c". Used in the sheet. */
export function describeSplit(method: SplitMethod, shares: Share[], nameOf: (email: string) => string): string {
  const label = { EQUAL: 'Equal', EXACT: 'Exact', PERCENT: 'Percent', SHARES: 'Shares' }[method];
  const parts = shares.map((s) => {
    const name = nameOf(s.email);
    if (method === 'PERCENT') return `${name} ${s.input}%`;
    if (method === 'SHARES') return `${name} ×${s.input}`;
    return name;
  });
  return `${label}: ${parts.join(', ')}`;
}
