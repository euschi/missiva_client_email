// Formattazione di date, nomi e dimensioni in italiano.

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 86_400_000;

function daysAgo(ts: number): number {
  return Math.round((dayStart(new Date()) - dayStart(new Date(ts * 1000))) / DAY);
}

const hm = (d: Date) => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Ora breve nell'elenco: "09:42", "Ieri", "Lun", "12 ott". */
export function shortTime(ts: number): string {
  const d = new Date(ts * 1000);
  const n = daysAgo(ts);
  // Date future (messaggi programmati, posticipi): sempre con l'ora.
  if (n === -1) return `Domani ${hm(d)}`;
  if (n < -1 && n > -7) return `${cap(d.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", ""))} ${hm(d)}`;
  if (n <= -7) return `${d.toLocaleDateString("it-IT", { day: "numeric", month: "short" }).replace(".", "")} ${hm(d)}`;
  if (n === 0) return hm(d);
  if (n === 1) return "Ieri";
  if (n < 7) return cap(d.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", ""));
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "short" }).replace(".", "");
}

/** Data estesa nel pannello di lettura: "Oggi, 09:42", "Lunedì, 10:30". */
export function longTime(ts: number): string {
  const d = new Date(ts * 1000);
  const n = daysAgo(ts);
  if (n === 0) return `Oggi, ${hm(d)}`;
  if (n === -1) return `Domani, ${hm(d)}`;
  if (n === 1) return `Ieri, ${hm(d)}`;
  if (Math.abs(n) < 7) return `${cap(d.toLocaleDateString("it-IT", { weekday: "long" }))}, ${hm(d)}`;
  return `${d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}, ${hm(d)}`;
}

export function groupLabel(ts: number): string {
  const n = daysAgo(ts);
  if (n === -1) return "Domani";
  if (n < -1) return "Più avanti";
  if (n === 0) return "Oggi";
  if (n === 1) return "Ieri";
  if (n < 7) return "Questa settimana";
  if (n < 31) return "Questo mese";
  return "Più vecchi";
}

export function initials(name: string): string {
  const parts = name.replace(/[<>"@].*$/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export const monoOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

export const providerLabel = (p: string, host: string) =>
  p === "google" ? "Gmail · Google" : p === "microsoft" ? "Microsoft 365" : `IMAP · ${host}`;

/** Paragrafi del corpo, separati da righe vuote. */
export const paragraphs = (body: string) => body.split(/\n{2,}/).filter((p) => p.trim());

export function relativeSync(at: Date | null): string {
  if (!at) return "Mai sincronizzato";
  const min = Math.floor((Date.now() - at.getTime()) / 60000);
  if (min < 1) return "Sincronizzato · adesso";
  if (min < 60) return `Sincronizzato · ${min} min fa`;
  return `Sincronizzato · ${hm(at)}`;
}
