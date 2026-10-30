// Scelte rapide di data e ora per "Posticipa" e "Invia più tardi".

const at = (base: Date, days: number, h: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(h, 0, 0, 0);
  return d;
};

export interface Preset {
  label: string;
  at: Date;
}

export function presets(now = new Date()): Preset[] {
  const list: Preset[] = [];
  // Tra tre ore, arrotondato al quarto d'ora, se resta nella giornata lavorativa.
  const later = new Date(Math.ceil((now.getTime() + 3 * 3_600_000) / 900_000) * 900_000);
  if (later.getDate() === now.getDate() && later.getHours() < 20) list.push({ label: "Più tardi oggi", at: later });
  list.push({ label: "Domani mattina", at: at(now, 1, 8) });
  list.push({ label: "Domani pomeriggio", at: at(now, 1, 14) });
  const day = now.getDay();
  // Sabato se siamo tra lunedì e giovedì.
  if (day >= 1 && day <= 4) list.push({ label: "Questo fine settimana", at: at(now, 6 - day, 9) });
  // Lunedì prossimo, se non coincide con "domani".
  const toMonday = (8 - day) % 7 || 7;
  if (toMonday > 1) list.push({ label: "Lunedì mattina", at: at(now, toMonday, 8) });
  return list;
}

/** Valore per <input type="datetime-local"> nel fuso locale. */
export function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const unix = (d: Date) => Math.floor(d.getTime() / 1000);
