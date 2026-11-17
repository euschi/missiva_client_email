// Azioni MCP sulle email: segnaposto con i dati del messaggio, campi ricavati dallo schema dello
// strumento, conversione dei valori nei tipi giusti e lettura del risultato.

import { conversationText } from "./aiprompt";
import type { JsonSchema, McpResult, McpServer, McpTool, Message } from "./types";

/** Azione rapida salvata: uno strumento con gli argomenti già impostati (con segnaposto). */
export interface McpAction {
  id: string;
  name: string;
  serverId: string;
  tool: string;
  /** Schema dello strumento quando è stata salvata: serve a eseguirla senza richiederlo. */
  schema: JsonSchema;
  /** Nome dell'argomento → modello di testo con segnaposto `{{...}}`. */
  args: Record<string, string>;
}

export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "oggetto", label: "Oggetto" },
  { key: "testo", label: "Testo del messaggio" },
  { key: "mittente", label: "Mittente (nome e indirizzo)" },
  { key: "email_mittente", label: "Indirizzo del mittente" },
  { key: "nome_mittente", label: "Nome del mittente" },
  { key: "destinatari", label: "Destinatari" },
  { key: "data", label: "Data (AAAA-MM-GG HH:MM)" },
  { key: "data_iso", label: "Data ISO 8601" },
  { key: "conversazione", label: "Conversazione intera" },
  { key: "message_id", label: "Message-ID" },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Valori dei segnaposto per un messaggio; la conversazione si calcola solo se serve. */
export async function emailValues(m: Message, thread: Message[], needed: string[]): Promise<Record<string, string>> {
  const d = new Date(m.date * 1000);
  const person = (name: string, email: string) => (name && name !== email ? `${name} <${email}>` : email);
  const values: Record<string, string> = {
    oggetto: m.subject,
    testo: m.body.trim(),
    mittente: person(m.fromName, m.fromEmail),
    email_mittente: m.fromEmail,
    nome_mittente: m.fromName || m.fromEmail,
    destinatari: [...m.to, ...m.cc].map((c) => person(c.name, c.email)).join(", "),
    data: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    data_iso: d.toISOString(),
    message_id: m.messageId ?? "",
    conversazione: "",
  };
  if (needed.includes("conversazione")) values.conversazione = await conversationText(thread.length ? thread : [m], false);
  return values;
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Segnaposto usati nei modelli. */
export const usedPlaceholders = (templates: string[]) => [...new Set(templates.flatMap((t) => [...t.matchAll(PLACEHOLDER)].map((x) => x[1])))];

/** Sostituisce i segnaposto; quelli sconosciuti restano com'erano. `escape` adatta i valori al contesto. */
export function fill(template: string, values: Record<string, string>, escape: (v: string) => string = (v) => v): string {
  return template.replace(PLACEHOLDER, (all, key: string) => (key in values ? escape(values[key]) : all));
}

/** Valore dentro una stringa JSON, senza le virgolette esterne. */
const jsonEscape = (v: string) => JSON.stringify(v).slice(1, -1);

export type FieldType = "string" | "number" | "integer" | "boolean" | "enum" | "json";

export interface Field {
  key: string;
  label: string;
  description: string;
  type: FieldType;
  options: string[];
  required: boolean;
  /** Testi lunghi: area di testo invece della riga singola. */
  multiline: boolean;
}

function typeOf(s: JsonSchema): FieldType {
  if (Array.isArray(s.enum) && s.enum.length > 0 && s.enum.every((v) => typeof v === "string")) return "enum";
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== "null") : s.type;
  if (t === "string" || t === "number" || t === "integer" || t === "boolean") return t;
  // Oggetti, array e schemi senza tipo: si scrivono in JSON.
  return t === undefined && !s.properties && !s.items ? "string" : "json";
}

const LONG = /body|content|text|testo|corpo|description|descri|note|message|messaggio|markdown|html|summary/i;

/** Campi del modulo dallo schema degli argomenti, prima gli obbligatori. */
export function fieldsOf(schema: JsonSchema | undefined): Field[] {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(props)
    .map(([key, raw]) => {
      const s = raw ?? {};
      const type = typeOf(s);
      return {
        key,
        label: s.title || key,
        description: s.description ?? "",
        type,
        options: type === "enum" ? (s.enum as string[]) : [],
        required: required.has(key),
        multiline: type === "json" || (type === "string" && LONG.test(key)),
      };
    })
    .sort((a, b) => Number(b.required) - Number(a.required));
}

/** Proposta iniziale per un campo: segnaposto dedotto dal nome, oppure il default dello schema. */
export function suggestion(field: Field, schema: JsonSchema | undefined): string {
  const def = schema?.properties?.[field.key]?.default;
  if (def !== undefined) return typeof def === "string" ? def : JSON.stringify(def);
  if (field.type !== "string") return "";
  const k = field.key.toLowerCase();
  if (/subject|oggetto|title|titolo/.test(k)) return "{{oggetto}}";
  if (/^(body|content|text|testo|corpo|description|descrizione|notes?|message|messaggio)$/.test(k)) return "{{testo}}";
  if (/sender|from|mittente/.test(k)) return "{{email_mittente}}";
  return "";
}

/** Argomenti pronti per lo strumento, con i segnaposto sostituiti e i valori nel tipo giusto. */
export function buildArgs(fields: Field[], templates: Record<string, string>, values: Record<string, string>): { args: Record<string, unknown>; problems: string[] } {
  const args: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const f of fields) {
    const template = templates[f.key] ?? "";
    if (!template.trim()) {
      if (f.required) problems.push(`«${f.label}» è obbligatorio`);
      continue;
    }
    if (f.type === "json") {
      try {
        args[f.key] = JSON.parse(fill(template, values, jsonEscape));
      } catch {
        problems.push(`«${f.label}» deve essere JSON valido`);
      }
      continue;
    }
    const text = fill(template, values);
    if (f.type === "number" || f.type === "integer") {
      const n = Number(text.trim().replace(",", "."));
      if (!text.trim() || !Number.isFinite(n) || (f.type === "integer" && !Number.isInteger(n))) problems.push(`«${f.label}» deve essere un numero${f.type === "integer" ? " intero" : ""}`);
      else args[f.key] = n;
    } else if (f.type === "boolean") {
      args[f.key] = /^(true|sì|si|1|vero)$/i.test(text.trim());
    } else {
      args[f.key] = text;
    }
  }
  return { args, problems };
}

/** Il risultato in testo leggibile, con le eventuali immagini come data URI. */
export function resultView(r: McpResult): { text: string; images: string[]; isError: boolean } {
  const parts: string[] = [];
  const images: string[] = [];
  for (const c of r.content ?? []) {
    if (c.type === "text" && c.text) parts.push(c.text);
    else if (c.type === "image" && c.data) images.push(`data:${c.mimeType ?? "image/png"};base64,${c.data}`);
    else if (c.type === "resource" && c.resource) parts.push(c.resource.text ?? c.resource.uri ?? "");
    else if (c.type === "resource_link" && c.uri) parts.push(c.name ? `${c.name}: ${c.uri}` : c.uri);
  }
  if (!parts.length && r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent, null, 2));
  const text = parts.filter(Boolean).join("\n\n").trim();
  return { text: text || (images.length ? "" : "Fatto: lo strumento non ha restituito testo."), images, isError: !!r.isError };
}

/** Riga di comando in programma e argomenti, rispettando virgolette e barre inverse. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else cur += ch;
  }
  if (has || cur) out.push(cur);
  return out;
}

export const joinCommand = (parts: string[]) => parts.map((p) => (p === "" || /[\s"'\\]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p)).join(" ");

/** Righe «CHIAVE=valore» (o «Nome: valore» per gli header) in un oggetto. */
export function parsePairs(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(sep);
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    if (key) out[key] = line.slice(i + 1).trim();
  }
  return out;
}

export const pairsText = (o: Record<string, string>, sep: "=" | ": ") =>
  Object.entries(o)
    .map(([k, v]) => `${k}${sep}${v}`)
    .join("\n");

const strings = (o: unknown): Record<string, string> =>
  o && typeof o === "object" ? Object.fromEntries(Object.entries(o as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : {};

/**
 * Collegamenti da una configurazione JSON in stile Claude Desktop / Cursor / VS Code:
 * `{"mcpServers": {"nome": {...}}}`, `{"servers": {...}}`, `{"nome": {...}}` o un solo server.
 */
export function parseServersJson(text: string): McpServer[] {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Il JSON deve essere un oggetto");
  const root = data as Record<string, unknown>;
  const looksLikeServer = (v: unknown): boolean => !!v && typeof v === "object" && ("command" in v || "url" in v || "serverUrl" in v);
  const entries: [string, unknown][] = looksLikeServer(root)
    ? [[String(root.name ?? "Server MCP"), root]]
    : Object.entries((root.mcpServers ?? root.servers ?? root) as Record<string, unknown>).filter(([, v]) => looksLikeServer(v));
  if (!entries.length) throw new Error("Nessun server trovato nel JSON");
  return entries.map(([name, raw]): McpServer => {
    const v = raw as Record<string, unknown>;
    const url = String(v.url ?? v.serverUrl ?? "");
    if (url) return { id: "", name, transport: "http", command: "", args: [], url, env: {}, headers: strings(v.headers) };
    const args = Array.isArray(v.args) ? v.args.map(String) : [];
    return { id: "", name, transport: "stdio", command: String(v.command ?? ""), args, url: "", env: strings(v.env), headers: {} };
  });
}

/** Strumenti già letti per server, per non riavviare il server a ogni apertura. */
const toolCache = new Map<string, McpTool[]>();
export const cachedTools = (serverId: string) => toolCache.get(serverId);
export const cacheTools = (serverId: string, tools: McpTool[]) => void toolCache.set(serverId, tools);
export const forgetTools = (serverId: string) => void toolCache.delete(serverId);
