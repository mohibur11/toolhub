// ── Homepage tool list ────────────────────────────────────────────────────
// Tools are added by CODE, not from a database. To add a tool:
//   1. add an entry to this array, with a unique, permanent `id`
//   2. create its page under tools/<name>/index.html
// `url` is a relative path (or full https:// URL for an external tool).
// The admin panel can hide a tool from the homepage; it remembers the
// choice by `id` (Firestore: settings/tools), so don't rename ids.
export const TOOLS = [
  {
    id: "dpdc-bill-calculator",
    icon: "⚡",
    name: "DPDC Bill Calculator",
    description: "Estimate a DPDC electricity bill from the current tariff rates.",
    url: "tools/dpdc-bill-calculator/",
  },
  {
    id: "kor-hishab",
    icon: "৳",
    name: "Kor Hishab",
    description: "Bangladesh individual income tax calculator — full return computation for AY 2026–27 and 2025–26.",
    url: "tools/kor-hishab/",
  },
  {
    id: "fairshare",
    icon: "🤝",
    name: "FairShare",
    description: "Split trip and event expenses with friends, then settle up with the fewest payments. Data lives in your own Google Sheet.",
    url: "tools/fairshare/",
  },
  {
    id: "easyapply",
    icon: "📝",
    name: "EasyApply",
    description: "Teletalk govt job forms: enter your details, photo and signature once, then fill any application in one click — on your computer, tablet or phone. Data stays in your own Google Drive.",
    url: "tools/easyapply/",
  },
];
