import { TOOLS } from "./tools.js";

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

render(TOOLS);
