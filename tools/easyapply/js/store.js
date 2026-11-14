// Device copy of the EasyApply profile (IndexedDB, this site only).
// Google Drive holds the real copy; this one lets the bookmark fill a form instantly and offline.
// Keys: 'profile' (the profile), 'meta' ({ account, lastSyncedAt, pendingSync }), 'pendingImport'
// (data captured from a Teletalk form, waiting for the user to review it in the app).

const DB_NAME = 'easyapply';
const STORE = 'kv';
let dbPromise = null;
const memory = new Map(); // used if IndexedDB is unavailable (some private modes)

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch {
        return resolve(null);
      }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db) {
          const r = fn(null);
          return resolve(r && typeof r === 'object' && 'result' in r ? r.result : undefined);
        }
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const store = {
  get(key) {
    return run('readonly', (s) => (s ? s.get(key) : { result: memory.get(key) }));
  },
  set(key, value) {
    return run('readwrite', (s) => (s ? s.put(value, key) : (memory.set(key, value), null)));
  },
  del(key) {
    return run('readwrite', (s) => (s ? s.delete(key) : (memory.delete(key), null)));
  },
  clear() {
    return run('readwrite', (s) => (s ? s.clear() : (memory.clear(), null)));
  },
};
