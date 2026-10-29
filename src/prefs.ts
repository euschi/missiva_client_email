// Preferenze di aspetto: salvate in localStorage e applicate come variabili CSS su :root.

export type Reader = "paper" | "ink";
export type Density = "comfortable" | "compact";

export interface Prefs {
  /** Id di un preset oppure "custom". */
  accentId: string;
  customHex: string;
  reader: Reader;
  density: Density;
}

export const PRESETS = [
  { id: "lime", label: "Lime", hex: "#C9F26B" },
  { id: "amber", label: "Ambra", hex: "#FFB86B" },
  { id: "sky", label: "Cielo", hex: "#8FD3FF" },
  { id: "lavender", label: "Lavanda", hex: "#C7B5FF" },
  { id: "coral", label: "Corallo", hex: "#FF8F7A" },
  { id: "mint", label: "Menta", hex: "#7EE0B5" },
  { id: "paper", label: "Carta", hex: "#F4F1EA" },
  { id: "system", label: "Sistema", hex: "#78AEED" },
];

export const DEFAULT_PREFS: Prefs = { accentId: "lime", customHex: "#E8A0FF", reader: "paper", density: "comfortable" };

const KEY = "missiva.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Senza storage le preferenze valgono solo per questa sessione.
  }
}

export const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

export function accentOf(p: Prefs): string {
  if (p.accentId === "custom") return isHex(p.customHex) ? p.customHex : DEFAULT_PREFS.customHex;
  return (PRESETS.find((x) => x.id === p.accentId) ?? PRESETS[0]).hex;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Colore del testo sopra l'accento: scuro sui colori chiari, bianco su quelli scuri. */
export const inkFor = (hex: string) => (luminance(hex) > 0.18 ? "#121406" : "#FFFFFF");

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  const accent = accentOf(p);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-ink", inkFor(accent));
  root.dataset.reader = p.reader;
  root.dataset.density = p.density;
}
