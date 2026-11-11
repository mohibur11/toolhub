// The slice of Google Drive + Sheets that FairShare needs. In the browser this calls Google's REST APIs with the
// signed-in user's own token (src/google/api.ts); tests use an in-memory fake (fakeGoogle.ts). FairShare has no
// server: every read and write below happens between the user's browser and their own Google account.

export type Cell = string | number | boolean;
/** Tab name -> rows (row 0 holds the headers). */
export type Tabs = Record<string, Cell[][]>;

export type WriteOp =
  /** Add rows after the last row of the tab. */
  | { kind: 'append'; tab: string; rows: Cell[][] }
  /** Overwrite one row (0-based index, so the header row is 0). */
  | { kind: 'update'; tab: string; rowIndex: number; row: Cell[] }
  /** Rename the spreadsheet file. */
  | { kind: 'title'; title: string };

export interface FileInfo {
  id: string;
  name: string;
  trashed: boolean;
  ownedByMe: boolean;
  ownerEmail: string;
}

export interface Permission {
  id: string;
  email: string;
  role: string; // owner | writer | commenter | reader
  pendingOwner: boolean;
}

export interface GoogleApi {
  /** New spreadsheet at the top of My Drive with one tab per entry (header row written, frozen). Returns its ID. */
  createSpreadsheet(title: string, tabs: Record<string, readonly string[]>): Promise<string>;
  /** Whole tabs, in one request. */
  readTabs(fileId: string, tabs: readonly string[]): Promise<Tabs>;
  /** All changes in one request, applied together. */
  write(fileId: string, ops: WriteOp[]): Promise<void>;
  getFile(fileId: string): Promise<FileInfo>;
  trash(fileId: string): Promise<void>;
  /** Put the file in my My Drive (used by a new owner, so the old owner stops inheriting access). */
  moveToMyDrive(fileId: string): Promise<void>;
  listPermissions(fileId: string): Promise<Permission[]>;
  /** Give `email` edit access. Google may email them `message`. */
  share(fileId: string, email: string, message: string): Promise<void>;
  unshare(fileId: string, permissionId: string): Promise<void>;
  setPendingOwner(fileId: string, permissionId: string, pending: boolean): Promise<void>;
  /** Accept an ownership offer made to me. */
  acceptOwnership(fileId: string): Promise<void>;
  /** My Drive permission ID (identifies my entry in a file's permission list). */
  myPermissionId(): Promise<string>;
  /** Hidden per-user JSON file in Drive's app data folder; null if it doesn't exist yet. */
  readAppData<T>(name: string): Promise<T | null>;
  writeAppData(name: string, data: unknown): Promise<void>;
}

/** An error answer from a Google API. `reason` is Google's error reason (e.g. notFound, cannotDeletePermission). */
export class GoogleError extends Error {
  constructor(
    public status: number,
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleError';
  }
}
