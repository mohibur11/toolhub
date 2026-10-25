// Minimal in-memory fakes of the Apps Script services the backend uses,
// so dist/Code.js can be exercised end-to-end in Node.
import { createHmac, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

class FakeRange {
  constructor(sheet, r, c, nr, nc) {
    Object.assign(this, { sheet, r, c, nr, nc });
    if (r < 1 || c < 1 || r + nr - 1 > sheet.maxRows) throw new Error(`Range out of bounds r=${r} nr=${nr} max=${sheet.maxRows}`);
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.cell(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values.some((row) => row.length !== this.nc)) throw new Error('setValues dimension mismatch');
    values.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) {
    this.sheet.set(this.r, this.c, v);
    return this;
  }
  clearContent() {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.set(this.r + i, this.c + j, '');
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.maxRows = 1000;
  }
  cell(r, c) {
    return this.rows[r - 1]?.[c - 1] ?? '';
  }
  set(r, c, v) {
    // Mimic Sheets: a leading apostrophe forces text and is not part of the value.
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
    else if (typeof v === 'string' && v.startsWith('=')) throw new Error(`Formula written to sheet: ${v}`);
    while (this.rows.length < r) this.rows.push([]);
    this.rows[r - 1][c - 1] = v;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].some((v) => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() {
    return this.rows.reduce((m, row) => {
      for (let j = row.length - 1; j >= 0; j--) if (row[j] !== '' && row[j] !== undefined) return Math.max(m, j + 1);
      return m;
    }, 0);
  }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.sheets = [new FakeSheet('Sheet1')];
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}/edit`; }
  rename(n) { this.name = n; }
  getSheets() { return [...this.sheets]; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) ?? null; }
  insertSheet(n) { const s = new FakeSheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

export function createFakeGas({ clientId = 'test-client-id', owner = 'owner@gmail.com' } = {}) {
  const spreadsheets = new Map();
  const accessible = new Set(); // ids the owner account can open
  const props = new Map([['GOOGLE_CLIENT_ID', clientId]]);
  const cache = new Map();
  const files = new Map();
  const mails = [];

  const newSpreadsheet = (name, { shared = true } = {}) => {
    const id = 'sheet' + randomUUID().replace(/-/g, '');
    const ss = new FakeSpreadsheet(id, name);
    spreadsheets.set(id, ss);
    if (shared) accessible.add(id);
    return ss;
  };

  const toBytes = (s) => [...Buffer.from(s, 'utf8')].map((b) => (b > 127 ? b - 256 : b));
  const fromBytes = (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b)));
  const makeBlob = (bytes, type, name) => ({
    getBytes: () => bytes,
    getContentType: () => type,
    getName: () => name,
    getDataAsString: () => fromBytes(bytes).toString('utf8'),
  });

  const folder = (id) => ({
    getId: () => id,
    getUrl: () => `https://drive.google.com/drive/folders/${id}`,
    getFoldersByName: (n) => {
      const f = [...files.values()].find((x) => x.isFolder && x.name === n && x.parent === id);
      return { hasNext: () => !!f, next: () => folder(f.id) };
    },
    createFolder: (n) => {
      const fid = 'fold' + randomUUID();
      files.set(fid, { id: fid, name: n, isFolder: true, parent: id });
      return folder(fid);
    },
    createFile: (blob) => {
      const fid = 'file' + randomUUID().replace(/-/g, '');
      files.set(fid, { id: fid, name: blob.getName(), blob, parent: id });
      return { getId: () => fid, setDescription() {} };
    },
  });

  const globals = {
    console,
    SpreadsheetApp: {
      create: (name) => newSpreadsheet(name),
      openById: (id) => {
        if (!accessible.has(id)) throw new Error('No access');
        return spreadsheets.get(id);
      },
      flush() {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props.get(k) ?? null,
        setProperty: (k, v) => props.set(k, v),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }),
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      getUuid: () => randomUUID(),
      computeHmacSha256Signature: (value, key) => [...createHmac('sha256', key).update(value).digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : fromBytes(v)).toString('base64url') + '=',
      base64DecodeWebSafe: (s) => [...Buffer.from(s, 'base64url')].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => fromBytes(bytes).toString('base64'),
      base64Decode: (s) => [...Buffer.from(s, 'base64')].map((b) => (b > 127 ? b - 256 : b)),
      newBlob: (bytes, type = 'application/octet-stream', name = '') => makeBlob(bytes, type, name),
    },
    UrlFetchApp: {
      // Fake tokeninfo: idToken is "valid:<email>:<name>" or anything else (invalid).
      fetch: (url) => {
        const token = decodeURIComponent(url.split('id_token=')[1]);
        const [kind, email, name] = token.split(':');
        const ok = kind === 'valid';
        return {
          getResponseCode: () => (ok ? 200 : 400),
          getContentText: () =>
            JSON.stringify({
              iss: 'https://accounts.google.com',
              aud: clientId,
              email,
              name,
              email_verified: 'true',
              exp: String(Math.floor(Date.now() / 1000) + 3600),
            }),
        };
      },
    },
    DriveApp: {
      createFolder: (n) => {
        const fid = 'fold' + randomUUID();
        files.set(fid, { id: fid, name: n, isFolder: true, parent: null });
        return folder(fid);
      },
      getFolderById: (id) => folder(id),
      getFileById: (id) => {
        const f = files.get(id);
        if (!f || f.isFolder) throw new Error('not found');
        return { getName: () => f.name, getBlob: () => f.blob };
      },
    },
    MailApp: { sendEmail: (m) => mails.push(m) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType: () => ({ content: s }) }),
    },
  };

  const context = vm.createContext(globals);
  const code = readFileSync(new URL('../dist/Code.js', import.meta.url), 'utf8');
  vm.runInContext(code, context);

  return {
    context,
    spreadsheets,
    accessible,
    props,
    mails,
    newSpreadsheet,
    setup: () => vm.runInContext('setup()', context),
    call(action, payload = {}, token) {
      const res = vm.runInContext('doPost', context)({ postData: { contents: JSON.stringify({ action, token, payload }) } });
      return JSON.parse(res.content);
    },
  };
}
