// ── Which tools the admin has hidden from the homepage ──────────────────────
// Stored in Firestore at settings/tools as { hidden: ["tool-id", ...] }.
// The homepage reads it with one plain HTTPS request (no Firebase SDK), and
// remembers the last answer on this device so the shelf appears instantly.
import { firebaseConfig, isConfigured } from "./firebase-config.js";

export const SETTINGS_COLLECTION = "settings";
export const TOOLS_DOC = "tools";
const CACHE_KEY = "toolhub.hiddenTools";

/** Hidden tool ids from this device's last visit, or null if unknown. */
export function cachedHidden() {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY));
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/** Remember the hidden list on this device (the admin panel calls this after saving). */
export function rememberHidden(hidden) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(hidden));
  } catch {
    // storage unavailable (private mode): the next visit just fetches again
  }
}

/**
 * Hidden tool ids, fresh from Firestore. [] when nothing has been saved yet.
 * Throws if Firestore can't be reached or refuses (e.g. rules not updated).
 */
export async function fetchHidden({ timeoutMs = 4000 } = {}) {
  if (!isConfigured) return [];
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}` +
    `/databases/(default)/documents/${SETTINGS_COLLECTION}/${TOOLS_DOC}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (res.status === 404) {
      rememberHidden([]);
      return [];
    }
    if (!res.ok) throw new Error(`Tool settings unavailable (HTTP ${res.status})`);
    const doc = await res.json();
    const values = doc?.fields?.hidden?.arrayValue?.values ?? [];
    const hidden = values.map((v) => v?.stringValue).filter((s) => typeof s === "string" && s);
    rememberHidden(hidden);
    return hidden;
  } finally {
    clearTimeout(timer);
  }
}
