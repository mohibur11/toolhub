// In-memory stand-in for Google Drive + Sheets, used by the tests. It copies the behaviour found in the
// feasibility tests with real accounts:
// - drive.file: the app only sees files the user created with it or selected in the picker (else "not found");
// - sharing gives edit access; editors may share and unshare others (Google's default);
// - after a handover the sheet stays in the old owner's Drive, and they keep access through it ("inherited")
//   until the new owner moves it into their own Drive.
import { GoogleError, type Cell, type GoogleApi, type Tabs } from './google';

interface FakePermission {
  id: string;
  role: 'owner' | 'writer';
  pendingOwner: boolean;
}

export interface FakeFile {
  id: string;
  title: string;
  owner: string;
  /** Whose My Drive holds the file. */
  inDriveOf: string;
  trashed: boolean;
  writersCanShare: boolean;
  permissions: Map<string, FakePermission>;
  tabs: Map<string, Cell[][]>;
}

export class FakeGoogle {
  files = new Map<string, FakeFile>();
  /** `${email}|${fileId}`: files the app may use for that user (created or picked). */
  grants = new Set<string>();
  appData = new Map<string, Map<string, unknown>>();
  shares: { fileId: string; by: string; to: string; message: string }[] = [];
  /** Accounts whose Google sign-in has expired: every call answers 401. */
  expired = new Set<string>();
  /** File IDs whose next request fails with a server error. */
  flaky = new Set<string>();
  requests = 0;
  private seq = 0;

  private newId(kind: string): string {
    return `${kind}${String(++this.seq).padStart(4, '0')}${'x'.repeat(28)}`;
  }

  /** The Google picker: selecting a file that is shared with you lets the app open it for you. */
  pick(email: string, fileId: string): boolean {
    const f = this.files.get(fileId);
    if (!f || f.trashed || !f.permissions.has(email)) return false;
    this.grants.add(`${email}|${fileId}`);
    return true;
  }

  /** A user sharing the sheet straight from Google Sheets, outside the app. */
  shareOutsideApp(fileId: string, email: string): void {
    this.files.get(fileId)!.permissions.set(email, { id: `perm-${email}`, role: 'writer', pendingOwner: false });
  }

  sheet(fileId: string, tab: string): Cell[][] {
    return this.files.get(fileId)!.tabs.get(tab)!;
  }

  client(accountEmail: string): GoogleApi {
    const me = accountEmail.toLowerCase();
    const world = this;

    const call = (fileId?: string) => {
      world.requests++;
      if (world.expired.has(me)) throw new GoogleError(401, 'authError', 'Request had invalid authentication credentials.');
      if (fileId && world.flaky.delete(fileId)) throw new GoogleError(503, 'backendError', 'Backend Error');
    };
    const open = (fileId: string): FakeFile => {
      call(fileId);
      const f = world.files.get(fileId);
      if (!f || !world.grants.has(`${me}|${fileId}`) || (f.trashed && f.owner !== me))
        throw new GoogleError(404, 'notFound', 'Requested entity was not found.');
      if (!f.permissions.has(me)) throw new GoogleError(403, 'PERMISSION_DENIED', 'The caller does not have permission');
      return f;
    };
    const ownerOnly = (f: FakeFile) => {
      if (f.owner !== me) throw new GoogleError(403, 'insufficientFilePermissions', 'The user does not have sufficient permissions for this file.');
    };
    const tab = (f: FakeFile, name: string) => {
      const rows = f.tabs.get(name);
      if (!rows) throw new GoogleError(400, 'badRequest', `Unable to parse range: ${name}`);
      return rows;
    };

    return {
      async createSpreadsheet(title, tabs) {
        call();
        const id = world.newId('sheet');
        world.files.set(id, {
          id,
          title,
          owner: me,
          inDriveOf: me,
          trashed: false,
          writersCanShare: true,
          permissions: new Map([[me, { id: `perm-${me}`, role: 'owner', pendingOwner: false }]]),
          tabs: new Map(Object.entries(tabs).map(([name, headers]) => [name, [[...headers]]])),
        });
        world.grants.add(`${me}|${id}`);
        return id;
      },
      async readTabs(fileId, names) {
        const f = open(fileId);
        const out: Tabs = {};
        for (const name of names) out[name] = tab(f, name).map((r) => [...r]);
        return out;
      },
      async write(fileId, ops) {
        const f = open(fileId);
        for (const op of ops) if (op.kind !== 'title') tab(f, op.tab); // all or nothing, like batchUpdate
        for (const op of ops) {
          if (op.kind === 'title') f.title = op.title;
          else if (op.kind === 'append') tab(f, op.tab).push(...op.rows.map((r) => [...r]));
          else {
            const rows = tab(f, op.tab);
            while (rows.length <= op.rowIndex) rows.push([]);
            rows[op.rowIndex] = [...op.row];
          }
        }
      },
      async getFile(fileId) {
        const f = open(fileId);
        return { id: f.id, name: f.title, trashed: f.trashed, ownedByMe: f.owner === me, ownerEmail: f.owner };
      },
      async trash(fileId) {
        const f = open(fileId);
        ownerOnly(f);
        f.trashed = true;
      },
      async moveToMyDrive(fileId) {
        const f = open(fileId);
        ownerOnly(f);
        f.inDriveOf = me;
      },
      async listPermissions(fileId) {
        const f = open(fileId);
        return [...f.permissions.entries()].map(([email, p]) => ({ id: p.id, email, role: p.role, pendingOwner: p.pendingOwner }));
      },
      async share(fileId, email, message) {
        const f = open(fileId);
        if (f.owner !== me && !f.writersCanShare) ownerOnly(f);
        const to = email.toLowerCase();
        if (!f.permissions.has(to)) f.permissions.set(to, { id: `perm-${to}`, role: 'writer', pendingOwner: false });
        world.shares.push({ fileId, by: me, to, message });
      },
      async unshare(fileId, permissionId) {
        const f = open(fileId);
        const found = [...f.permissions.entries()].find(([, p]) => p.id === permissionId);
        if (!found) throw new GoogleError(404, 'notFound', 'Permission not found');
        const [email, p] = found;
        if (p.role === 'owner') throw new GoogleError(403, 'cannotRemoveOwner', 'The owner of a file cannot be removed.');
        if (email !== me && f.owner !== me && !f.writersCanShare) ownerOnly(f);
        if (f.inDriveOf === email)
          throw new GoogleError(403, 'cannotDeletePermission', 'The authenticated user cannot delete the permission.');
        f.permissions.delete(email);
      },
      async setPendingOwner(fileId, permissionId, pending) {
        const f = open(fileId);
        ownerOnly(f);
        const p = [...f.permissions.values()].find((x) => x.id === permissionId);
        if (!p || p.role !== 'writer') throw new GoogleError(400, 'invalidOwnershipTransfer', 'Only editors can be offered ownership.');
        p.pendingOwner = pending;
      },
      async acceptOwnership(fileId) {
        const f = open(fileId);
        const mine = f.permissions.get(me)!;
        if (!mine.pendingOwner) throw new GoogleError(403, 'pendingOwnerWriterRequired', 'Ownership has not been offered to you.');
        f.permissions.get(f.owner)!.role = 'writer';
        Object.assign(mine, { role: 'owner', pendingOwner: false });
        f.owner = me; // ...but the file stays in the old owner's Drive
      },
      async myPermissionId() {
        call();
        return `perm-${me}`;
      },
      async readAppData<T>(name: string) {
        call();
        const v = world.appData.get(me)?.get(name);
        return v === undefined ? null : (structuredClone(v) as T);
      },
      async writeAppData(name, data) {
        call();
        if (!world.appData.has(me)) world.appData.set(me, new Map());
        world.appData.get(me)!.set(name, structuredClone(data));
      },
    };
  }
}
