// Domain + API types. The "API" is the browser data layer (frontend/src/data), which reads and writes each
// group's Google Sheet directly with the user's own Google access. There is no FairShare server.

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
  /** Name shown in this group: owner's nickname, else profileName. */
  displayName: string;
  /** The member's own FairShare name (or Google name / email prefix). */
  profileName: string;
  /** Name the group owner set for this member in this group, if any. */
  nickname?: string;
  pictureUrl?: string;
  role: 'owner' | 'member';
  active: boolean;
  /** When the member first opened the group; empty while they are only invited. */
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
  /** The group's Google Sheets file ID. */
  id: string;
  name: string;
  description: string;
  currency: string;
  createdBy: string;
  createdAt: string;
  simplifyDebts: boolean;
  archived: boolean;
  /** Google account that owns the sheet (the group owner). */
  ownerEmail: string;
  /** Member who has been offered ownership and hasn't accepted yet, or ''. */
  pendingOwner: string;
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
  /** Set when the group couldn't be loaded just now (e.g. no connection); the other fields are placeholders. */
  error?: string;
}

export interface User {
  email: string;
  /** Effective name: chosen in FairShare, else from Google. */
  name: string;
  /** Name from the Google account (shown as the default when editing). */
  googleName?: string;
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

/** Someone with Google access to a group's sheet, and whether they are in the member list. */
export interface AccessEntry {
  email: string;
  role: string; // owner | writer | commenter | reader
  pendingOwner: boolean;
  member: 'active' | 'removed' | 'none';
}

/** Request payload + response data for every data action. */
export interface ApiActions {
  me: { req: Record<string, never>; res: { user: User } };
  listGroups: { req: Record<string, never>; res: GroupSummary[] };
  createGroup: {
    req: { name: string; description: string; currency: string; memberEmails: string[] };
    res: GroupDetail;
  };
  /** Open a group shared with me (after picking it in Google's file picker): adds me to its members if needed. */
  joinGroup: { req: { groupId: string }; res: GroupDetail };
  deleteGroup: { req: { groupId: string; confirmName: string }; res: null };
  /** Set your own FairShare name everywhere; '' resets to your Google name. */
  updateProfile: { req: { name: string }; res: { user: User } };
  /** Group owner renames a member inside this group only; '' removes the nickname. */
  setMemberNickname: { req: { groupId: string; email: string; nickname: string }; res: GroupDetail };
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
  /** Owner offers ownership of the group (its sheet) to another member. */
  offerOwnership: { req: { groupId: string; email: string }; res: GroupDetail };
  cancelOwnershipOffer: { req: { groupId: string }; res: GroupDetail };
  /** The member who was offered ownership accepts it. */
  acceptOwnership: { req: { groupId: string }; res: GroupDetail };
  /** Everyone with Google access to the group's sheet (owner only). */
  getAccess: { req: { groupId: string }; res: AccessEntry[] };
  /** Owner removes someone's Google access who isn't (or is no longer) a member. */
  removeAccess: { req: { groupId: string; email: string }; res: AccessEntry[] };
}

export type ApiAction = keyof ApiActions;

export type ApiErrorCode =
  /** Google sign-in expired; a tap is needed to continue. */
  | 'NEEDS_SIGNIN'
  /** This Google account can't open the group's sheet (not shared with it, removed, or not picked yet). */
  | 'NO_ACCESS'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID'
  | 'CONFLICT'
  | 'BUSY'
  | 'INTERNAL';
