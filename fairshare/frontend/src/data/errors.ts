import type { ApiErrorCode } from '@shared/types';
import { GoogleError } from './google';

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function invalid(message: string): never {
  throw new ApiError('INVALID', message);
}

const isRateLimit = (e: GoogleError) => e.status === 429 || /rate ?limit/i.test(e.reason);

/** Turn a Google API error into an app error with a message people can act on. */
export function toApiError(e: unknown): unknown {
  if (e instanceof ApiError || !(e instanceof GoogleError)) return e;
  if (e.status === 401) return new ApiError('NEEDS_SIGNIN', 'Your Google sign-in has expired. Tap to continue.');
  if (e.status === 0) return new ApiError('BUSY', 'Network error. Check your connection and try again.');
  if (isRateLimit(e)) return new ApiError('BUSY', 'Google is busy right now. Try again in a moment.');
  if (e.status === 403) return new ApiError('FORBIDDEN', `Google refused: ${e.message}`);
  if (e.status === 404) return new ApiError('NOT_FOUND', `Google couldn't find it: ${e.message}`);
  if (e.status === 400) return new ApiError('INVALID', `Google rejected the request: ${e.message}`);
  return new ApiError('INTERNAL', `Google error (${e.status}): ${e.message}`);
}

/** Errors while opening a group's sheet: "not found" and "forbidden" both mean this account can't open it. */
export function toGroupOpenError(e: unknown): unknown {
  if (e instanceof GoogleError && !isRateLimit(e) && (e.status === 404 || e.status === 403))
    return new ApiError(
      'NO_ACCESS',
      "This Google account can't open this group. Open it from the invite link, or ask a member to add your email.",
    );
  return toApiError(e);
}
