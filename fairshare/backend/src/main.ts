// Web app entry point. Every request is a POST with a JSON body: { action, token?, payload }.
// (The frontend sends Content-Type text/plain to avoid a CORS preflight, which Apps Script can't answer.)
import type { ApiAction, ApiResponse, User } from '../../shared/types';
import { issueSession, verifyGoogleIdToken, verifySession } from './auth';
import { optionalProp } from './config';
import { ApiError } from './errors';
import { addExpense, addPayment, deleteExpense, deletePayment, restoreExpense, updateExpense } from './expenses';
import { readActivity } from './groupSheet';
import { addMember, archiveGroup, createGroup, getGroupDetail, listGroups, removeMember, updateGroup } from './groups';
import { getReceipt, uploadReceipt } from './receipts';
import { groupCtx } from './detail';
import { upsertUser } from './registry';

export { setup } from './setup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (user: User, payload: any) => unknown;

const handlers: Record<Exclude<ApiAction, 'login'>, Handler> = {
  me: (user) => ({ user, ownerEmail: optionalProp('OWNER_EMAIL') }),
  listGroups,
  createGroup,
  updateGroup,
  archiveGroup,
  addMember,
  removeMember,
  getGroup: getGroupDetail,
  addExpense,
  updateExpense,
  deleteExpense,
  restoreExpense,
  addPayment,
  deletePayment,
  getActivity: (user, p: { groupId: string; limit?: number }) =>
    readActivity(groupCtx(p.groupId, user.email).ss, Math.min(Number(p.limit) || 200, 1000)),
  uploadReceipt,
  getReceipt,
};

function login(payload: { idToken: string }) {
  const user = verifyGoogleIdToken(payload?.idToken);
  upsertUser(user);
  return { sessionToken: issueSession(user), user, ownerEmail: optionalProp('OWNER_EMAIL') };
}

function respond(body: ApiResponse<unknown>) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

export function doGet() {
  return respond({ ok: true, data: { service: 'FairShare API', status: 'ok' } });
}

export function doPost(e: GoogleAppsScript.Events.DoPost) {
  try {
    const body = JSON.parse(e?.postData?.contents || '{}') as { action?: string; token?: string; payload?: unknown };
    const action = body.action as ApiAction;
    if (action === 'login') return respond({ ok: true, data: login(body.payload as { idToken: string }) });
    const handler = handlers[action as Exclude<ApiAction, 'login'>];
    if (!handler) throw new ApiError('INVALID', `Unknown action "${String(body.action)}"`);
    const user = verifySession(body.token);
    return respond({ ok: true, data: handler(user, body.payload ?? {}) });
  } catch (err) {
    if (err instanceof ApiError) return respond({ ok: false, error: { code: err.code, message: err.message } });
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    const message = err instanceof Error ? err.message : String(err);
    return respond({ ok: false, error: { code: 'INTERNAL', message: `Something went wrong: ${message}` } });
  }
}
