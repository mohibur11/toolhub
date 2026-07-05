// ── DPDC retail tariff — shared data + helpers ─────────────────────────────
// The STRUCTURE (which voltage levels, consumer classes, slab boundaries)
// lives here in code. The NUMBERS (energy rates, demand charges, VAT, the
// effective date) can be overridden by the admin and stored in Firestore
// (doc: tariffs/dpdc). applyOverrides() overlays those numbers onto this
// structure, so adding a new class = code change, changing a rate = admin.
//
// Source of defaults: https://dpdc.gov.bd/pages/static-pages/6922de6f933eb65569e1a9c4
// energy rates in Taka/kWh; demand charge in Taka/kW/month.

export const DEFAULT_EFFECTIVE = "June 2026";
export const DEFAULT_VAT = 5; // percent

export const RATE_LABELS = { flat: "Flat", peak: "Peak", offpeak: "Off-peak", superoffpeak: "Super off-peak" };

export const DEFAULT_TARIFF = {
  LT: {
    label: "Low Tension (LT) — 230 / 400 V",
    hint: "AC single phase 230 V / three phase 400 V · sanctioned load: single phase 0–7.5 kW, three phase 0–80 kW.",
    classes: [
      { code: "LT-A", label: "Residential (আবাসিক)", demand: 42.00, residential: [
          { name: "Lifeline (≤ 50 units)", rate: 4.63 },
          { name: "Step 1: 1–75", upto: 75, rate: 5.26 },
          { name: "Step 2: 76–200", upto: 200, rate: 8.50 },
          { name: "Step 3: 201–300", upto: 300, rate: 9.10 },
          { name: "Step 4: 301–400", upto: 400, rate: 9.62 },
          { name: "Step 5: 401–600", upto: 600, rate: 15.01 },
          { name: "Step 6: 601+", upto: Infinity, rate: 17.35 }
      ]},
      { code: "LT-B", label: "Irrigation / agriculture pump", demand: 42.00, flat: 6.04 },
      { code: "LT-C1", label: "Small industry", demand: 48.00, tou: { flat: 12.73, offpeak: 11.45, peak: 15.27 } },
      { code: "LT-C2", label: "Construction", demand: 120.00, flat: 18.09 },
      { code: "LT-D1", label: "Education / religious / charitable / hospital", demand: 60.00, flat: 9.05 },
      { code: "LT-D2", label: "Street lights & water pumps", demand: 90.00, flat: 11.46 },
      { code: "LT-D3", label: "EV & battery charging station", demand: 90.00, tou: { flat: 11.36, offpeak: 10.22, superoffpeak: 9.09, peak: 14.20 } },
      { code: "LT-E", label: "Commercial & office", demand: 90.00, tou: { flat: 15.36, offpeak: 13.82, peak: 18.43 } },
      { code: "LT-T", label: "Temporary", demand: 120.00, flat: 23.81 }
    ]
  },
  MT: {
    label: "Medium Tension (MT) — 11 kV",
    hint: "AC 11 kV · sanctioned load: above 50 kW up to 5 MW.",
    classes: [
      { code: "MT-1", label: "Residential", demand: 90.00, tou: { flat: 12.50, offpeak: 11.25, peak: 15.62 } },
      { code: "MT-2", label: "Commercial & office", demand: 90.00, tou: { flat: 13.93, offpeak: 12.54, peak: 17.41 } },
      { code: "MT-3", label: "Industry", demand: 90.00, tou: { flat: 12.85, offpeak: 11.56, peak: 16.06 } },
      { code: "MT-4", label: "Construction", demand: 120.00, tou: { flat: 17.16, offpeak: 15.44, peak: 21.45 } },
      { code: "MT-5", label: "General", demand: 90.00, tou: { flat: 12.58, offpeak: 11.32, peak: 15.72 } },
      { code: "MT-6", label: "Temporary", demand: 120.00, flat: 22.56 },
      { code: "MT-7", label: "EV & battery charging station", demand: 90.00, tou: { flat: 11.31, offpeak: 10.18, superoffpeak: 9.05, peak: 14.14 } },
      { code: "MT-8", label: "Irrigation / agriculture pump", demand: 90.00, tou: { flat: 7.38, offpeak: 6.64, peak: 9.23 } }
    ]
  },
  HT: {
    label: "High Tension (HT) — 33 kV",
    hint: "AC 33 kV · sanctioned load: above 5 MW up to 30 MW (above 20 MW must be double circuit).",
    classes: [
      { code: "HT-1", label: "General", demand: 90.00, tou: { flat: 12.54, offpeak: 11.28, peak: 15.67 } },
      { code: "HT-2", label: "Commercial & office", demand: 90.00, tou: { flat: 13.64, offpeak: 12.28, peak: 17.05 } },
      { code: "HT-3", label: "Industry", demand: 90.00, tou: { flat: 12.75, offpeak: 11.47, peak: 15.93 } },
      { code: "HT-4", label: "Construction", demand: 90.00, tou: { flat: 15.96, offpeak: 14.36, peak: 19.95 } }
    ]
  },
  EHT: {
    label: "Extra High Tension (EHT) — 132 / 230 kV",
    hint: "AC 132 kV & 230 kV · EHT-1: 20–140 MW, EHT-2: above 140 MW.",
    classes: [
      { code: "EHT-1", label: "General (20–140 MW)", demand: 90.00, tou: { flat: 12.66, offpeak: 11.39, peak: 15.82 } },
      { code: "EHT-2", label: "General (above 140 MW)", demand: 90.00, tou: { flat: 12.61, offpeak: 11.35, peak: 15.76 } }
    ]
  }
};

// Deep clone of the default structure with admin-set numbers overlaid.
// `rates` is the map stored in Firestore (tariffs/dpdc → rates). Pass null
// to get the pristine defaults.
export function applyOverrides(rates) {
  const t = structuredClone(DEFAULT_TARIFF);
  if (!rates) return t;
  for (const lvl of Object.keys(t)) {
    const lvlOv = rates[lvl];
    if (!lvlOv) continue;
    for (const cls of t[lvl].classes) {
      const o = lvlOv[cls.code];
      if (!o) continue;
      if (typeof o.demand === "number") cls.demand = o.demand;
      if (typeof o.flat === "number" && cls.flat != null) cls.flat = o.flat;
      if (o.tou && cls.tou) {
        for (const k of Object.keys(cls.tou)) {
          if (typeof o.tou[k] === "number") cls.tou[k] = o.tou[k];
        }
      }
      if (Array.isArray(o.residential) && cls.residential) {
        cls.residential.forEach((s, i) => {
          if (typeof o.residential[i] === "number") s.rate = o.residential[i];
        });
      }
    }
  }
  return t;
}
