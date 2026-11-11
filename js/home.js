import { TOOLS } from "./tools.js?v=4";
import { cachedHidden, fetchHidden } from "./tool-visibility.js?v=4";

const grid = document.getElementById("tool-grid");
const emptyState = document.getElementById("empty-state");
const countEl = document.getElementById("tool-count");

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

// Show every tool except the ones the admin hid; re-render only if the list changed.
let shown = null;
function showAllExcept(hidden) {
  const off = new Set(hidden);
  const tools = TOOLS.filter((t) => !off.has(t.id));
  const key = tools.map((t) => t.id).join(",");
  if (key === shown) return;
  shown = key;
  render(tools);
}

// Paint straight away with what this device saw last time, then check for changes.
// First visit: wait briefly for the settings; if they can't be read, show every tool.
const cached = cachedHidden();
if (cached) showAllExcept(cached);
fetchHidden({ timeoutMs: cached ? 10000 : 2500 })
  .then(showAllExcept)
  .catch(() => {
    if (!cached) showAllExcept([]);
  });
