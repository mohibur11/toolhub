// Domain + API types shared by frontend and backend.

export type SplitMethod = 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES';

/** One participant's raw split input. `value` meaning depends on method:
 *  EQUAL: ignored, EXACT: amount in minor units, PERCENT: percent (0-100), SHARES: weight. */
export interface SplitInput {
  email: string;
  value?: number;
}

export interface Share {
  email: string;
  shareMinor: number;
  input?: number;
}

export interface Payer {
  email: string;
  amountMinor: number;
}

export interface Member {
  email: string;
  displayName: string;
  pictureUrl?: string;
  role: 'owner' | 'member';
  active: boolean;
  joinedAt: string;
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  amountMinor: number;
  date: string; // YYYY-MM-DD
  splitMethod: SplitMethod;
  payers: Payer[];
  shares: Share[];
  notes: string;
  receiptFileId: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  deleted: boolean;
  /** Client-only: set while an optimistic write is in flight. */
  pending?: boolean;
}

export interface Payment {
  id: string;
  from: string;
  to: string;
  amountMinor: number;
  date: string;
  note: string;
  createdBy: string;
  createdAt: string;
  deleted: boolean;
  pending?: boolean;
}

export interface Transfer {
  from: string;
  to: string;
  amountMinor: number;
}

export interface ActivityEntry {
  ts: string;
  actor: string;
  action: string;
  entityType: 'group' | 'member' | 'expense' | 'payment';
  entityId: string;
  summary: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  description: string;
  currency: string;
  createdBy: string;
  createdAt: string;
  simplifyDebts: boolean;
  archived: boolean;
  sheetUrl: string;
  version: number;
}

export interface GroupDetail {
  group: GroupInfo;
  members: Member[];
  expenses: Expense[];
  payments: Payment[];
  balances: Record<string, number>;
  settlePlan: Transfer[];
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  currency: string;
  role: 'owner' | 'member';
  memberCount: number;
  memberPreview: { email: string; displayName: string; pictureUrl?: string }[];
  myNetMinor: number;
  archived: boolean;
  lastActivityAt: string;
}

export interface User {
  email: string;
  name: string;
  pictureUrl?: string;
}

export interface ExpenseInput {
  description: string;
  category: string;
  amountMinor: number;
  date: string;
  splitMethod: SplitMethod;
  payers: Payer[];
  splitInputs: SplitInput[];
  notes: string;
  receiptFileId: string;
}

export interface PaymentInput {
  from: string;
  to: string;
  amountMinor: number;
  date: string;
  note: string;
}

/** Request payload + response data for every API action. */
export interface ApiActions {
  login: { req: { idToken: string }; res: { sessionToken: string; user: User; ownerEmail: string } };
  me: { req: Record<string, never>; res: { user: User; ownerEmail: string } };
  listGroups: { req: Record<string, never>; res: GroupSummary[] };
  createGroup: {
    req: { name: string; description: string; currency: string; sheetUrl: string; memberEmails: string[] };
    res: GroupDetail;
  };
  updateGroup: {
    req: { groupId: string; name?: string; description?: string; simplifyDebts?: boolean };
    res: GroupDetail;
  };
  archiveGroup: { req: { groupId: string; archived: boolean }; res: GroupDetail };
  addMember: { req: { groupId: string; email: string }; res: GroupDetail };
  removeMember: { req: { groupId: string; email: string }; res: GroupDetail | null };
  getGroup: { req: { groupId: string }; res: GroupDetail };
  addExpense: { req: { groupId: string; expense: ExpenseInput; clientId?: string }; res: GroupDetail };
  updateExpense: { req: { groupId: string; expenseId: string; expense: ExpenseInput }; res: GroupDetail };
  deleteExpense: { req: { groupId: string; expenseId: string }; res: GroupDetail };
  restoreExpense: { req: { groupId: string; expenseId: string }; res: GroupDetail };
  addPayment: { req: { groupId: string; payment: PaymentInput; clientId?: string }; res: GroupDetail };
  deletePayment: { req: { groupId: string; paymentId: string }; res: GroupDetail };
  getActivity: { req: { groupId: string; limit?: number }; res: ActivityEntry[] };
  uploadReceipt: {
    req: { groupId: string; base64: string; mimeType: string; fileName: string };
    res: { fileId: string };
  };
  getReceipt: { req: { groupId: string; fileId: string }; res: { base64: string; mimeType: string } };
}

export type ApiAction = keyof ApiActions;

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID'
  | 'CONFLICT'
  | 'SHEET_ACCESS'
  | 'BUSY'
  | 'INTERNAL';

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ApiErrorCode; message: string } };
