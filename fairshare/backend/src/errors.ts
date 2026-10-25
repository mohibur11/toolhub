import type { ApiErrorCode } from '../../shared/types';

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
