// The UI calls `api(action, payload)` as before; actions now run in the browser against Google directly
// (src/data/actions.ts) instead of going to a server.
import type { ApiAction, ApiActions, ApiErrorCode } from '@shared/types';
import { APP_URL } from '../config';
import { createDataApi, type DataApi } from '../data/actions';
import { ApiError } from '../data/errors';
import { googleApi, resetGoogleCaches } from '../google/api';
import { fetchAccount } from '../google/auth';

export class ApiCallError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

let data: DataApi | null = null;
const dataApi = () => (data ??= createDataApi({ google: googleApi, account: fetchAccount, appUrl: APP_URL }));

/** Forget everything cached for the current Google account (sign-out, switching accounts). */
export function resetApi() {
  data = null;
  resetGoogleCaches();
}

let needsSignInHandler: (() => void) | null = null;
export function onNeedsSignIn(fn: () => void) {
  needsSignInHandler = fn;
}

export async function api<A extends ApiAction>(action: A, payload: ApiActions[A]['req']): Promise<ApiActions[A]['res']> {
  const run = dataApi()[action] as (req: ApiActions[A]['req']) => Promise<ApiActions[A]['res']>;
  try {
    return await run(payload);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.code === 'NEEDS_SIGNIN') needsSignInHandler?.();
      throw new ApiCallError(e.code, e.message);
    }
    throw new ApiCallError('INTERNAL', e instanceof Error ? e.message : String(e));
  }
}
