import { getFirebase, isConfigured } from "./firebase-init.js";

const main = document.getElementById("admin-main");
const checking = document.getElementById("auth-checking");
const listEl = document.getElementById("admin-tool-list");
const formErr = document.getElementById("tool-form-error");
const saveBtn = document.getElementById("save-tool-btn");
const cancelBtn = document.getElementById("cancel-edit-btn");

let fb = null;
let tools = []; // [{id, ...data}]
let editingId = null;

function showFormError(msg) { formErr.textContent = msg; formErr.hidden = !msg; }

function flashStatus(msg) {
  const el = document.getElementById("config-status");
  el.textContent = msg;
  setTimeout(() => { el.textContent = ""; }, 2500);
}

/* ── Rendering ─────────────────────────────────────────── */
function renderList() {
  listEl.innerHTML = "";
  document.getElementById("admin-tool-count").textContent = `(${tools.length})`;
  if (!tools.length) {
    listEl.innerHTML = `<p class="muted">No tools yet. Add your first one above.</p>`;
    return;
  }
  tools.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "admin-tool-row" + (t.visible === false ? " hidden-tool" : "");

    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = t.icon || "🧰";

    const info = document.createElement("div");
    info.className = "info";
    const strong = document.createElement("strong");
    strong.textContent = t.name;
    const span = document.createElement("span");
    span.textContent = `${t.description || ""} → ${t.url || ""}`;
    info.append(strong, span);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(
      iconBtn("↑", "Move up", () => move(i, -1), i === 0),
      iconBtn("↓", "Move down", () => move(i, +1), i === tools.length - 1),
      iconBtn(t.visible === false ? "Show" : "Hide", "Toggle visibility", () => toggleVisible(t)),
      iconBtn("Edit", "Edit tool", () => startEdit(t)),
      iconBtn("Delete", "Delete tool", () => removeTool(t), false, true),
    );

    row.append(icon, info, actions);
    listEl.appendChild(row);
  });
}

function iconBtn(label, title, onClick, disabled = false, danger = false) {
  const b = document.createElement("button");
  b.className = "icon-btn" + (danger ? " danger" : "");
  b.textContent = label;
  b.title = title;
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

/* ── Data ops ─────────────────────────────────────────── */
async function loadTools() {
  const { db, dbMod } = fb;
  const { collection, getDocs, query, orderBy } = dbMod;
  const snap = await getDocs(query(collection(db, "tools"), orderBy("order", "asc")));
  tools = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderList();
}

async function saveTool() {
  showFormError("");
  const icon = document.getElementById("tool-icon").value.trim();
  const name = document.getElementById("tool-name").value.trim();
  const description = document.getElementById("tool-desc").value.trim();
  const url = document.getElementById("tool-url").value.trim();
  if (!name) return showFormError("Give the tool a name.");
  if (!url) return showFormError("Give the tool a link.");

  const { db, dbMod } = fb;
  const { collection, addDoc, doc, updateDoc } = dbMod;

  saveBtn.disabled = true;
  try {
    if (editingId) {
      await updateDoc(doc(db, "tools", editingId), { icon, name, description, url });
    } else {
      const order = tools.length ? Math.max(...tools.map(t => t.order ?? 0)) + 1 : 1;
      await addDoc(collection(db, "tools"), { icon, name, description, url, order, visible: true });
    }
    resetForm();
    await loadTools();
  } catch (err) {
    console.error(err);
    showFormError("Couldn't save. Check your Firestore rules and connection.");
  } finally {
    saveBtn.disabled = false;
  }
}

function startEdit(t) {
  editingId = t.id;
  document.getElementById("form-heading").textContent = `Editing: ${t.name}`;
  document.getElementById("tool-icon").value = t.icon || "";
  document.getElementById("tool-name").value = t.name || "";
  document.getElementById("tool-desc").value = t.description || "";
  document.getElementById("tool-url").value = t.url || "";
  saveBtn.textContent = "Save changes";
  cancelBtn.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetForm() {
  editingId = null;
  document.getElementById("form-heading").textContent = "Add a tool";
  ["tool-icon", "tool-name", "tool-desc", "tool-url"].forEach(id => document.getElementById(id).value = "");
  saveBtn.textContent = "Add tool";
  cancelBtn.hidden = true;
  showFormError("");
}

async function removeTool(t) {
  if (!confirm(`Delete "${t.name}"? This can't be undone.`)) return;
  const { db, dbMod } = fb;
  const { doc, deleteDoc } = dbMod;
  await deleteDoc(doc(db, "tools", t.id));
  if (editingId === t.id) resetForm();
  await loadTools();
}

async function toggleVisible(t) {
  const { db, dbMod } = fb;
  const { doc, updateDoc } = dbMod;
  await updateDoc(doc(db, "tools", t.id), { visible: t.visible === false });
  await loadTools();
}

async function move(index, delta) {
  const other = index + delta;
  if (other < 0 || other >= tools.length) return;
  const { db, dbMod } = fb;
  const { doc, updateDoc } = dbMod;
  const a = tools[index], b = tools[other];
  const aOrder = a.order ?? index + 1, bOrder = b.order ?? other + 1;
  await Promise.all([
    updateDoc(doc(db, "tools", a.id), { order: bOrder }),
    updateDoc(doc(db, "tools", b.id), { order: aOrder }),
  ]);
  await loadTools();
}

/* ── Site config ──────────────────────────────────────── */
async function loadConfig() {
  const { db, dbMod } = fb;
  const { doc, getDoc } = dbMod;
  try {
    const snap = await getDoc(doc(db, "site", "config"));
    if (snap.exists()) {
      const c = snap.data();
      document.getElementById("cfg-title").value = c.title || "";
      document.getElementById("cfg-subtitle").value = c.subtitle || "";
    }
  } catch { /* first run: doc doesn't exist yet */ }
}

async function saveConfig() {
  const { db, dbMod } = fb;
  const { doc, setDoc } = dbMod;
  await setDoc(doc(db, "site", "config"), {
    title: document.getElementById("cfg-title").value.trim(),
    subtitle: document.getElementById("cfg-subtitle").value.trim(),
  }, { merge: true });
  flashStatus("Saved ✓");
}

/* ── Boot ─────────────────────────────────────────────── */
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
    await Promise.all([loadTools(), loadConfig()]);
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(fb.auth);
    window.location.replace("index.html");
  });
  saveBtn.addEventListener("click", saveTool);
  cancelBtn.addEventListener("click", resetForm);
  document.getElementById("save-config-btn").addEventListener("click", saveConfig);
}

boot();
