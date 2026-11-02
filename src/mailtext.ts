// Analisi di testi legati alla posta: filtri di ricerca, link mailto:, link sospetti, citazioni HTML.

import type { Draft, Message, SearchQuery } from "./types";

/** Date accettate: AAAA-MM-GG oppure GG/MM/AAAA. */
function isoDate(text: string): string | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const it = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  return it ? `${it[3]}-${it[2].padStart(2, "0")}-${it[1].padStart(2, "0")}` : null;
}

/**
 * Scompone la ricerca: `da:mario a:anna oggetto:"fattura maggio" dopo:2026-01-31 prima:15/03/2026
 * ha:allegati stato:nonletti stato:contrassegnati`; il resto sono parole da cercare ovunque.
 */
export function parseSearch(raw: string): SearchQuery {
  const q: SearchQuery = { words: [], from: [], to: [], subject: [], after: null, before: null, unread: false, flagged: false, attachment: false };
  for (const match of raw.matchAll(/(?:([\p{L}]+):)?(?:"([^"]*)"|(\S+))/gu)) {
    const key = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? "";
    if (!value) continue;
    const lower = value.toLowerCase();
    if (key === "da") q.from.push(value);
    else if (key === "a") q.to.push(value);
    else if (key === "oggetto") q.subject.push(value);
    else if (key === "dopo" && isoDate(value)) q.after = isoDate(value);
    else if (key === "prima" && isoDate(value)) q.before = isoDate(value);
    else if (key === "ha" && lower.startsWith("allegat")) q.attachment = true;
    else if (key === "stato" && lower.startsWith("nonlett")) q.unread = true;
    else if (key === "stato" && lower.startsWith("contrassegn")) q.flagged = true;
    // Un prefisso sconosciuto (es. un orario, «ore:12») resta testo da cercare.
    else q.words.push(key ? `${match[1]}:${value}` : value);
  }
  return q;
}

/** La ricerca vale anche per i messaggi già scaricati. */
export function matchesSearch(m: Message, q: SearchQuery): boolean {
  const has = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());
  const day = (iso: string) => new Date(`${iso}T00:00:00`).getTime() / 1000;
  const people = [...m.to, ...m.cc].flatMap((c) => [c.name, c.email]);
  return (
    q.words.every((w) => [m.fromName, m.fromEmail, m.subject, m.body].some((s) => has(s, w))) &&
    q.from.every((w) => has(m.fromName, w) || has(m.fromEmail, w)) &&
    q.to.every((w) => people.some((p) => has(p, w))) &&
    q.subject.every((w) => has(m.subject, w)) &&
    (!q.after || m.date >= day(q.after)) &&
    (!q.before || m.date < day(q.before)) &&
    (!q.unread || m.unread) &&
    (!q.flagged || m.flagged) &&
    (!q.attachment || m.attachments.some((f) => !f.inline))
  );
}

const decode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const addresses = (text: string | null | undefined) => (text ? decode(text).split(",").map((a) => a.trim()).filter(Boolean) : []);

/**
 * Bozza da un link mailto:. Si leggono solo destinatari, oggetto e testo: un link non deve
 * poter allegare file né inviare nulla, e la finestra Scrivi resta da confermare.
 */
export function parseMailto(href: string): Partial<Draft> {
  const rest = href.replace(/^mailto:/i, "");
  const cut = rest.indexOf("?");
  // In un mailto: il + è un carattere vero, non uno spazio come nei moduli web.
  const params = new URLSearchParams(cut < 0 ? "" : rest.slice(cut + 1).replace(/\+/g, "%2B"));
  const get = (name: string) => [...params.entries()].find(([k]) => k.toLowerCase() === name)?.[1];
  return {
    to: [...addresses(cut < 0 ? rest : rest.slice(0, cut)), ...addresses(get("to"))],
    cc: addresses(get("cc")),
    bcc: addresses(get("bcc")),
    subject: get("subject") ?? "",
    body: get("body") ?? "",
  };
}

const urlOf = (text: string) => {
  try {
    return new URL(text);
  } catch {
    return null;
  }
};

/** Dominio di un testo che sembra un indirizzo web («www.banca.it», «https://banca.it/login»). */
function domainInText(text: string): string | null {
  const t = text.trim();
  if (/\s/.test(t) || t.includes("@")) return null;
  const m = /^(?:https?:\/\/)?((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})(?:[/:?#]|$)/iu.exec(t);
  return m ? m[1].toLowerCase() : null;
}

/** Ultime due parti del nome: «login.banca.it» e «www.banca.it» sono lo stesso sito. */
const sameSite = (a: string, b: string) => {
  const tail = (h: string) => h.replace(/\.$/, "").split(".").slice(-2).join(".");
  return tail(a) === tail(b);
};

/** Perché un link è sospetto, oppure `null`. Serve a chiedere conferma, non a bloccarlo. */
export function suspiciousLink(href: string, text = ""): string | null {
  const url = urlOf(href);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  if (url.username || url.password) return `L’indirizzo nasconde il sito vero: porta a ${host}.`;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return `Porta a un indirizzo numerico (${host}) invece che a un sito con un nome.`;
  if (host.split(".").some((part) => part.startsWith("xn--"))) return `Il nome ${host} usa caratteri speciali che possono imitare un altro sito.`;
  const shown = domainInText(text);
  if (shown && !sameSite(shown, host)) return `Il testo del link mostra ${shown}, ma porta a ${host}.`;
  return null;
}

/** HTML sicuro da reincludere in una risposta: niente script, oggetti incorporati o gestori di eventi. */
export function cleanQuotedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, object, embed, form, link, meta, base").forEach((el) => el.remove());
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith("on") || attr.value.trim().toLowerCase().startsWith("javascript:")) el.removeAttribute(attr.name);
    }
  }
  const styles = [...doc.head.querySelectorAll("style")].map((s) => s.outerHTML).join("");
  return styles + doc.body.innerHTML;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Citazione con l'impaginazione dell'originale, preceduta da una riga di introduzione. */
export const quotedHtmlBlock = (intro: string, html: string) =>
  `<br><div style="color:#666">${escapeHtml(intro)}</div><blockquote style="margin:8px 0 0;padding-left:12px;border-left:2px solid #ccc">${cleanQuotedHtml(html)}</blockquote>`;
