import { ApiError } from './errors';

export type PropName =
  | 'GOOGLE_CLIENT_ID'
  | 'REGISTRY_SHEET_ID'
  | 'RECEIPTS_FOLDER_ID'
  | 'OWNER_EMAIL'
  | 'SESSION_SECRET'
  | 'APP_URL'
  | 'SEND_EMAILS';

export function prop(name: PropName): string {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new ApiError('INTERNAL', `Server is missing script property ${name}. Run setup().`);
  return v;
}

export function optionalProp(name: PropName): string {
  return PropertiesService.getScriptProperties().getProperty(name) ?? '';
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return Utilities.getUuid();
}

/** Serialise all writes. Apps Script has one script-wide lock which is plenty for this scale. */
export function withLock<T>(fn: () => T): T {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new ApiError('BUSY', 'Server is busy, please try again in a moment');
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}
