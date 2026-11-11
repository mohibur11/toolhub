// The real GoogleApi: Drive v3 and Sheets v4 REST calls made from the browser with the user's own token.
import type { Cell, FileInfo, GoogleApi, Permission, Tabs } from '../data/google';
import { GoogleError } from '../data/google';
import { accessToken, dropToken } from './auth';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Authorised request with retries for "busy" answers; Google errors become GoogleError. */
async function call<T>(method: string, url: string, body?: unknown, raw?: { data: string; type: string }): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken()}` };
    let payload: string | undefined;
    if (raw) {
      headers['Content-Type'] = raw.type;
      payload = raw.data;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: payload });
    } catch {
      throw new GoogleError(0, 'network', 'Network error. Check your connection and try again.');
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (res.ok) return data as T;
    const err = ((data as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } } | null)?.error ?? {});
    const reason = err.errors?.[0]?.reason || err.status || '';
    const retry = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit/i.test(reason));
    if (retry && attempt < 3) {
      await sleep(400 * 2 ** attempt + Math.random() * 300);
      continue;
    }
    if (res.status === 401) dropToken();
    throw new GoogleError(res.status, reason, err.message || res.statusText || `HTTP ${res.status}`);
  }
}

// Per-account caches, cleared when the signed-in account changes.
const tabIdCache = new Map<string, Map<string, number>>();
const appDataIds = new Map<string, string>();
let permissionId: Promise<string> | null = null;
let appDataQueue: Promise<unknown> = Promise.resolve();

export function resetGoogleCaches() {
  tabIdCache.clear();
  appDataIds.clear();
  permissionId = null;
}

async function tabIds(fileId: string): Promise<Map<string, number>> {
  let ids = tabIdCache.get(fileId);
  if (!ids) {
    const r = await call<{ sheets?: { properties: { sheetId: number; title: string } }[] }>(
      'GET',
      `${SHEETS}/${fileId}?fields=sheets.properties(sheetId,title)`,
    );
    ids = new Map((r.sheets ?? []).map((s) => [s.properties.title, s.properties.sheetId]));
    tabIdCache.set(fileId, ids);
  }
  return ids;
}

function cellData(v: Cell) {
  if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
  if (typeof v === 'boolean') return { userEnteredValue: { boolValue: v } };
  // stringValue is always stored as text, never run as a formula.
  return v === '' ? {} : { userEnteredValue: { stringValue: v } };
}

async function findAppData(name: string): Promise<string | null> {
  const known = appDataIds.get(name);
  if (known) return known;
  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and trashed = false`);
  const r = await call<{ files?: { id: string }[] }>('GET', `${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=10`);
  const id = r.files?.[0]?.id ?? null;
  if (id) appDataIds.set(name, id);
  return id;
}

function myPermissionId(): Promise<string> {
  permissionId ??= call<{ user: { permissionId: string } }>('GET', `${DRIVE}/about?fields=user(permissionId)`).then(
    (r) => r.user.permissionId,
    (e) => {
      permissionId = null;
      throw e;
    },
  );
  return permissionId;
}

export const googleApi: GoogleApi = {
  async createSpreadsheet(title, tabs) {
    const res = await call<{ spreadsheetId: string; sheets: { properties: { sheetId: number; title: string } }[] }>(
      'POST',
      `${SHEETS}?fields=spreadsheetId,sheets.properties(sheetId,title)`,
      {
        properties: { title },
        sheets: Object.entries(tabs).map(([name, headers], i) => ({
          properties: { sheetId: i + 1, title: name, gridProperties: { frozenRowCount: 1 } },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: headers.map((h) => ({
                    userEnteredValue: { stringValue: h },
                    userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.96, blue: 0.92 } },
                  })),
                },
              ],
            },
          ],
        })),
      },
    );
    tabIdCache.set(res.spreadsheetId, new Map(res.sheets.map((s) => [s.properties.title, s.properties.sheetId])));
    return res.spreadsheetId;
  },

  async readTabs(fileId, tabs) {
    const ranges = tabs.map((t) => `ranges=${encodeURIComponent(t)}`).join('&');
    const r = await call<{ valueRanges?: { values?: Cell[][] }[] }>(
      'GET',
      `${SHEETS}/${fileId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
    );
    const out: Tabs = {};
    tabs.forEach((t, i) => (out[t] = r.valueRanges?.[i]?.values ?? []));
    return out;
  },

  async write(fileId, ops) {
    const ids = await tabIds(fileId);
    const requests = ops.map((op) => {
      if (op.kind === 'title') return { updateSpreadsheetProperties: { properties: { title: op.title }, fields: 'title' } };
      const sheetId = ids.get(op.tab);
      if (sheetId === undefined) throw new GoogleError(400, 'missingTab', `The group's sheet has no "${op.tab}" tab`);
      if (op.kind === 'append')
        return { appendCells: { sheetId, rows: op.rows.map((row) => ({ values: row.map(cellData) })), fields: 'userEnteredValue' } };
      return {
        updateCells: {
          start: { sheetId, rowIndex: op.rowIndex, columnIndex: 0 },
          rows: [{ values: op.row.map(cellData) }],
          fields: 'userEnteredValue',
        },
      };
    });
    await call('POST', `${SHEETS}/${fileId}:batchUpdate`, { requests });
  },

  async getFile(fileId): Promise<FileInfo> {
    const f = await call<{ id: string; name: string; trashed?: boolean; ownedByMe?: boolean; owners?: { emailAddress?: string }[] }>(
      'GET',
      `${DRIVE}/files/${fileId}?fields=id,name,trashed,ownedByMe,owners(emailAddress)`,
    );
    return {
      id: f.id,
      name: f.name,
      trashed: !!f.trashed,
      ownedByMe: !!f.ownedByMe,
      ownerEmail: (f.owners?.[0]?.emailAddress ?? '').toLowerCase(),
    };
  },

  async trash(fileId) {
    await call('PATCH', `${DRIVE}/files/${fileId}?fields=id`, { trashed: true });
  },

  async moveToMyDrive(fileId) {
    // The new owner usually can't see the old owner's folder, so there may be no parent to name here.
    const f = await call<{ parents?: string[] }>('GET', `${DRIVE}/files/${fileId}?fields=parents`);
    const q = new URLSearchParams({ addParents: 'root', fields: 'id' });
    if (f.parents?.length) q.set('removeParents', f.parents.join(','));
    await call('PATCH', `${DRIVE}/files/${fileId}?${q}`, {});
  },

  async listPermissions(fileId): Promise<Permission[]> {
    const r = await call<{ permissions?: { id: string; emailAddress?: string; role: string; pendingOwner?: boolean }[] }>(
      'GET',
      `${DRIVE}/files/${fileId}/permissions?fields=permissions(id,emailAddress,role,pendingOwner)`,
    );
    return (r.permissions ?? []).map((p) => ({
      id: p.id,
      email: (p.emailAddress ?? '').toLowerCase(),
      role: p.role,
      pendingOwner: !!p.pendingOwner,
    }));
  },

  async share(fileId, email, message) {
    const q = new URLSearchParams({ sendNotificationEmail: 'true', emailMessage: message, fields: 'id' });
    await call('POST', `${DRIVE}/files/${fileId}/permissions?${q}`, { type: 'user', role: 'writer', emailAddress: email });
  },

  async unshare(fileId, id) {
    await call('DELETE', `${DRIVE}/files/${fileId}/permissions/${id}`);
  },

  async setPendingOwner(fileId, id, pending) {
    await call('PATCH', `${DRIVE}/files/${fileId}/permissions/${id}?fields=id`, { role: 'writer', pendingOwner: pending });
  },

  async acceptOwnership(fileId) {
    const id = await myPermissionId();
    await call('PATCH', `${DRIVE}/files/${fileId}/permissions/${id}?transferOwnership=true&fields=id`, { role: 'owner' });
  },

  myPermissionId,

  async readAppData<T>(name: string): Promise<T | null> {
    const id = await findAppData(name);
    return id ? call<T>('GET', `${DRIVE}/files/${id}?alt=media`) : null;
  },

  writeAppData(name, data) {
    // One at a time, so two quick saves can't create two copies of the file.
    const run = appDataQueue.then(async () => {
      let id = await findAppData(name);
      if (!id) {
        id = (await call<{ id: string }>('POST', `${DRIVE}/files?fields=id`, { name, parents: ['appDataFolder'], mimeType: 'application/json' })).id;
        appDataIds.set(name, id);
      }
      await call('PATCH', `${UPLOAD}/files/${id}?uploadType=media&fields=id`, undefined, { data: JSON.stringify(data), type: 'application/json' });
    });
    appDataQueue = run.catch(() => undefined);
    return run;
  },
};
