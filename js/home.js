import { getFirebase, isConfigured } from "./firebase-init.js";

const grid = document.getElementById("tool-grid");
const emptyState = document.getElementById("empty-state");
const countEl = document.getElementById("tool-count");

const DEMO_TOOLS = [
  { icon: "🧮", name: "Unit converter", description: "Convert length, weight, and temperature.", url: "#" },
  { icon: "🎨", name: "Color picker", description: "Grab hex and RGB values from a palette.", url: "#" },
  { icon: "📝", name: "Notes", description: "Quick scratchpad that lives in your browser.", url: "#" },
];

function render(tools) {
  grid.innerHTML = "";
  if (!tools.length) {
    emptyState.hidden = false;
    countEl.textContent = "0";
    return;
  }
  emptyState.hidden = true;
  countEl.textContent = String(tools.length).padStart(2, "0");
  for (const t of tools) {
    const a = document.createElement("a");
    a.className = "tool-card";
    a.href = t.url || "#";
    if (/^https?:\/\//i.test(t.url || "")) { a.target = "_blank"; a.rel = "noopener"; }

    const icon = document.createElement("div");
    icon.className = "icon";
    icon.textContent = t.icon || "🧰";

    const h3 = document.createElement("h3");
    h3.textContent = t.name || "Untitled tool";

    const p = document.createElement("p");
    p.textContent = t.description || "";

    a.append(icon, h3, p);
    grid.appendChild(a);
  }
}

async function main() {
  if (!isConfigured) {
    document.getElementById("setup-banner").hidden = false;
    render(DEMO_TOOLS);
    return;
  }

  try {
    const { db, dbMod } = await getFirebase();
    const { doc, getDoc, collection, getDocs, query, orderBy } = dbMod;

    // Site title / tagline
    try {
      const cfg = await getDoc(doc(db, "site", "config"));
      if (cfg.exists()) {
        const c = cfg.data();
        if (c.title) {
          document.getElementById("site-title").textContent = c.title;
          document.title = c.title;
        }
        if (c.subtitle) document.getElementById("site-subtitle").textContent = c.subtitle;
      }
    } catch { /* config doc is optional */ }

    // Tools
    const snap = await getDocs(query(collection(db, "tools"), orderBy("order", "asc")));
    const tools = snap.docs.map(d => d.data()).filter(t => t.visible !== false);
    render(tools);
  } catch (err) {
    console.error(err);
    grid.innerHTML = "";
    emptyState.hidden = false;
    emptyState.querySelector("p").textContent = "Couldn't load tools right now.";
  }
}

main();
