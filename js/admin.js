import { getFirebase, isConfigured } from "./firebase-init.js";
import { DEFAULT_TARIFF, DEFAULT_EFFECTIVE, DEFAULT_VAT, RATE_LABELS, applyOverrides } from "./dpdc-tariff.js";
import { TOOLS } from "./tools.js?v=4";
import { SETTINGS_COLLECTION, TOOLS_DOC, rememberHidden } from "./tool-visibility.js?v=4";

const main = document.getElementById("admin-main");
const checking = document.getElementById("auth-checking");
const editorEl = document.getElementById("tariff-editor");
const effInput = document.getElementById("tf-effective");
const vatInput = document.getElementById("tf-vat");
const errEl = document.getElementById("tariff-error");
const saveBtn = document.getElementById("save-tariff-btn");
const resetBtn = document.getElementById("reset-tariff-btn");
const toolsListEl = document.getElementById("tools-list");
const toolsErrEl = document.getElementById("tools-error");
const saveToolsBtn = document.getElementById("save-tools-btn");
const toolsSummaryEl = document.getElementById("tools-summary");

let fb = null;

function showError(msg) { errEl.textContent = msg; errEl.hidden = !msg; }
function flashStatus(msg, id = "tariff-status") {
  const el = document.getElementById(id);
  el.textContent = msg;
  setTimeout(() => { el.textContent = ""; }, 2500);
}

/* ── Tools on the homepage (show / hide) ──────────────────────────────────
   Firestore settings/tools holds { hidden: [tool ids] }. Tools themselves are
   defined in js/tools.js; anything not listed as hidden is shown. */
const RULES_HELP =
  "Firestore doesn't allow this yet. Add the “settings” rule from firestore.rules " +
  "in the Firebase console (README → “Show or hide tools”), then reload.";

let savedHidden = new Set();   // as stored in Firestore
const hidden = new Set();      // as currently switched in the form

function showToolsError(msg) { toolsErrEl.textContent = msg; toolsErrEl.hidden = !msg; }

const toolsDirty = () =>
  TOOLS.some((t) => hidden.has(t.id) !== savedHidden.has(t.id));

function updateToolsSummary() {
  const shown = TOOLS.filter((t) => !hidden.has(t.id)).length;
  toolsSummaryEl.textContent = `${shown} of ${TOOLS.length} shown on the homepage`;
  const dirty = toolsDirty();
  saveToolsBtn.disabled = !dirty;
  saveToolsBtn.textContent = dirty ? "Save changes" : "Saved";
}

function buildToolsList() {
  toolsListEl.innerHTML = "";
  for (const t of TOOLS) {
    const row = document.createElement("div");
    row.className = "admin-tool-row";

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = t.icon || "🧰";

    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("strong");
    name.textContent = t.name;
    const url = document.createElement("span");
    url.className = "mono";
    url.textContent = t.url;
    info.append(name, url);

    const sw = document.createElement("label");
    sw.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !hidden.has(t.id);
    input.setAttribute("aria-label", `Show ${t.name} on the homepage`);
    const track = document.createElement("span");
    track.className = "track";
    const state = document.createElement("span");
    state.className = "state";
    const sync = () => {
      row.classList.toggle("hidden-tool", !input.checked);
      state.textContent = input.checked ? "Shown" : "Hidden";
    };
    input.addEventListener("change", () => {
      if (input.checked) hidden.delete(t.id);
      else hidden.add(t.id);
      sync();
      updateToolsSummary();
    });
    sync();
    sw.append(input, track, state);

    row.append(icon, info, sw);
    toolsListEl.appendChild(row);
  }
  updateToolsSummary();
}

async function loadTools() {
  const { db, dbMod } = fb;
  const { doc, getDoc } = dbMod;
  savedHidden = new Set();
  try {
    const snap = await getDoc(doc(db, SETTINGS_COLLECTION, TOOLS_DOC));
    const list = snap.exists() ? snap.data().hidden : null;
    if (Array.isArray(list)) savedHidden = new Set(list.filter((x) => typeof x === "string"));
  } catch (err) {
    showToolsError(err?.code === "permission-denied"
      ? RULES_HELP
      : "Couldn't load the tool settings. Check your connection, then reload.");
  }
  hidden.clear();
  savedHidden.forEach((id) => hidden.add(id));
  buildToolsList();
}

async function saveTools() {
  showToolsError("");
  const { db, dbMod } = fb;
  const { doc, setDoc, serverTimestamp } = dbMod;
  // Only ids of tools that still exist, in the order of js/tools.js.
  const list = TOOLS.map((t) => t.id).filter((id) => hidden.has(id));
  saveToolsBtn.disabled = true;
  saveToolsBtn.textContent = "Saving…";
  try {
    await setDoc(doc(db, SETTINGS_COLLECTION, TOOLS_DOC), {
      hidden: list,
      updatedAt: serverTimestamp(),
      updatedBy: fb.auth.currentUser?.email || "",
    });
    savedHidden = new Set(list);
    rememberHidden(list); // this device's homepage reflects it right away
    flashStatus("Saved ✓", "tools-status");
  } catch (err) {
    console.error(err);
    showToolsError(err?.code === "permission-denied"
      ? RULES_HELP
      : "Couldn't save. Check your connection and try again.");
  } finally {
    updateToolsSummary();
  }
}

const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ── Build the editor from a (merged) tariff object ───────────────────────
   Each number input carries dataset attributes describing where its value
   belongs: level key, class code, kind (demand|flat|tou|res) and either a
   tou key or a residential slab index. */
function rateCell(labelText, value, ds) {
  const cell = document.createElement("div");
  cell.className = "rate-cell";
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "0.01";
  input.value = value;
  Object.assign(input.dataset, ds);
  cell.append(label, input);
  return cell;
}

function buildEditor(tariff) {
  editorEl.innerHTML = "";
  for (const lvl of Object.keys(tariff)) {
    const level = tariff[lvl];

    const wrap = document.createElement("div");
    wrap.className = "tariff-level";
    const h = document.createElement("h3");
    h.textContent = level.label;
    wrap.appendChild(h);

    for (const c of level.classes) {
      const block = document.createElement("div");
      block.className = "tariff-class";

      const head = document.createElement("div");
      head.className = "tc-head";
      head.textContent = `${c.code} — ${c.label}`;
      block.appendChild(head);

      const rates = document.createElement("div");
      rates.className = "tc-rates";

      if (c.residential) {
        c.residential.forEach((s, i) => {
          rates.appendChild(rateCell(s.name, s.rate, { lvl, code: c.code, kind: "res", idx: String(i) }));
        });
      } else if (c.tou) {
        for (const k of Object.keys(c.tou)) {
          rates.appendChild(rateCell(RATE_LABELS[k], c.tou[k], { lvl, code: c.code, kind: "tou", key: k }));
        }
      } else {
        rates.appendChild(rateCell("Energy (flat)", c.flat, { lvl, code: c.code, kind: "flat" }));
      }

      rates.appendChild(rateCell("Demand (Tk/kW)", c.demand, { lvl, code: c.code, kind: "demand" }));

      block.appendChild(rates);
      wrap.appendChild(block);
    }
    editorEl.appendChild(wrap);
  }
}

/* ── Read the editor back into a rates-overrides object ───────────────────── */
function readEditor() {
  const rates = {};
  for (const inp of editorEl.querySelectorAll("input[data-lvl]")) {
    const v = parseFloat(inp.value);
    if (isNaN(v)) continue;
    const { lvl, code, kind, key, idx } = inp.dataset;
    (rates[lvl] ??= {});
    (rates[lvl][code] ??= {});
    const r = rates[lvl][code];
    if (kind === "demand") r.demand = v;
    else if (kind === "flat") r.flat = v;
    else if (kind === "tou") { (r.tou ??= {})[key] = v; }
    else if (kind === "res") { (r.residential ??= [])[+idx] = v; }
  }
  return rates;
}

/* ── Load / save ──────────────────────────────────────────────────────────── */
async function loadTariff() {
  const { db, dbMod } = fb;
  const { doc, getDoc } = dbMod;
  let rates = null, effective = DEFAULT_EFFECTIVE, vat = DEFAULT_VAT;
  try {
    const snap = await getDoc(doc(db, "tariffs", "dpdc"));
    if (snap.exists()) {
      const d = snap.data();
      rates = d.rates || null;
      if (typeof d.effective === "string" && d.effective.trim()) effective = d.effective.trim();
      if (typeof d.vat === "number") vat = d.vat;
    }
  } catch { /* first run: doc doesn't exist yet — use code defaults */ }
  effInput.value = effective;
  vatInput.value = vat;
  buildEditor(applyOverrides(rates));
}

async function saveTariff() {
  showError("");
  const effective = effInput.value.trim();
  const vat = parseFloat(vatInput.value);
  if (!effective) return showError("Set an effective date/label.");
  if (isNaN(vat) || vat < 0) return showError("VAT must be a number (percent).");

  const { db, dbMod } = fb;
  const { doc, setDoc } = dbMod;
  saveBtn.disabled = true;
  try {
    await setDoc(doc(db, "tariffs", "dpdc"), { effective, vat, rates: readEditor() });
    flashStatus("Saved ✓");
  } catch (err) {
    console.error(err);
    showError("Couldn't save. Check your Firestore rules and connection.");
  } finally {
    saveBtn.disabled = false;
  }
}

function resetToDefaults() {
  if (!confirm("Reset every field back to the values hard-coded in the site? This only refills the form — nothing is saved until you press Save.")) return;
  effInput.value = DEFAULT_EFFECTIVE;
  vatInput.value = DEFAULT_VAT;
  buildEditor(structuredClone(DEFAULT_TARIFF));
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */
async function boot() {
  if (!isConfigured) {
    checking.textContent = "Firebase isn't configured yet. See README.md, then reload.";
    return;
  }
  fb = await getFirebase();
  const { onAuthStateChanged, signOut } = fb.authMod;

  onAuthStateChanged(fb.auth, async (user) => {
    if (!user) { window.location.replace("login.html"); return; }
    document.getElementById("admin-email").textContent = user.email || "";
    checking.hidden = true;
    main.hidden = false;
    await Promise.all([loadTools(), loadTariff()]);
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(fb.auth);
    window.location.replace("index.html");
  });
  saveBtn.addEventListener("click", saveTariff);
  resetBtn.addEventListener("click", resetToDefaults);
  saveToolsBtn.addEventListener("click", saveTools);
  // Don't lose switched-but-unsaved tool changes by accident.
  window.addEventListener("beforeunload", (e) => {
    if (toolsDirty()) { e.preventDefault(); e.returnValue = ""; }
  });
}

boot();
