// Formattazione leggera: **grassetto**, _corsivo_, [link](url), elenchi "- ", citazioni "> " e tabelle "| a | b |".
// Il testo resta leggibile così com'è (parte text/plain) e diventa HTML per la parte text/html.
// L'editor di Scrivi mostra la formattazione vera: legge l'HTML di toHtml e restituisce questo testo (toMarkdown).

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const IMAGE = /!\[([^\]\n]*)\]\(cid:([^\s)]+)\)/g;
const LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g;
const BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const ITALIC = /(^|[\s(])_(?=\S)(.+?)(?<=\S)_(?=$|[\s).,;:!?])/g;
const LIST = /^\s*[-*] /;
const QUOTE = /^\s*>/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Celle di una riga di tabella; "\|" è una barra dentro la cella. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return inner.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

const isTableStart = (lines: string[], i: number) => TABLE_ROW.test(lines[i]) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]);

const CELL = "border:1px solid #ccc;padding:4px 10px;text-align:left;vertical-align:top";

/** Anteprima di un'immagine per l'editor, dal suo cid; senza, l'email la richiama con `cid:`. */
export type ImageUrls = (cid: string) => string | undefined;

let imageUrls: ImageUrls | null = null;

function image(alt: string, cid: string): string {
  if (!imageUrls) return `<img src="cid:${cid}" alt="${alt}" style="max-width:100%">`;
  return `<img src="${esc(imageUrls(cid) ?? "")}" alt="${alt}" data-cid="${cid}">`;
}

function inline(s: string): string {
  // Le immagini prima dei link: hanno la stessa forma con il ! davanti.
  return esc(s).replace(IMAGE, (_, alt, cid) => image(alt, cid)).replace(LINK, '<a href="$2">$1</a>').replace(BOLD, "<strong>$1</strong>").replace(ITALIC, "$1<em>$2</em>");
}

/** Il rientro a inizio riga resta visibile anche in HTML, che altrimenti lo comprime. */
function indented(line: string): string {
  const lead = line.match(/^[ \t]*/)![0];
  return lead.replace(/\t/g, "    ").replace(/ /g, "&nbsp;") + inline(line.slice(lead.length));
}

/**
 * HTML del testo. Per l'email le righe consecutive formano un paragrafo; con `editor` ogni riga è un
 * paragrafo a sé e le righe vuote restano, così l'editor mostra il testo esattamente com'è.
 */
export function toHtml(text: string, editor = false, images?: ImageUrls): string {
  if (editor) {
    const previous = imageUrls;
    imageUrls = images ?? (() => undefined);
    try {
      return blocks(text, true);
    } finally {
      imageUrls = previous;
    }
  }
  return blocks(text, false);
}

function blocks(text: string, editor: boolean): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableStart(lines, i)) {
      const head = cells(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cells(lines[i++]));
      const cols = Math.max(head.length, ...rows.map((r) => r.length));
      const fill = (r: string[]) => Array.from({ length: cols }, (_, k) => inline(r[k] ?? ""));
      const th = fill(head).map((c) => `<th style="${CELL};background:#f3f3f3">${c}</th>`).join("");
      const body = rows.map((r) => `<tr>${fill(r).map((c) => `<td style="${CELL}">${c}</td>`).join("")}</tr>`).join("");
      out.push(`<table style="border-collapse:collapse;margin:.4em 0"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`);
    } else if (QUOTE.test(lines[i])) {
      const block: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) block.push(lines[i++].replace(/^\s*> ?/, ""));
      out.push(`<blockquote style="margin:0 0 0 .8em;padding-left:.8em;border-left:3px solid #ccc;color:#555">${blocks(block.join("\n"), editor)}</blockquote>`);
    } else if (LIST.test(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && LIST.test(lines[i])) items.push(`<li>${editor ? "<p>" : ""}${inline(lines[i++].replace(LIST, ""))}${editor ? "</p>" : ""}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
    } else if (editor) {
      out.push(`<p>${indented(lines[i++])}</p>`);
    } else if (!lines[i].trim()) {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !QUOTE.test(lines[i]) && !LIST.test(lines[i]) && !isTableStart(lines, i)) para.push(indented(lines[i++]));
      out.push(`<p>${para.join("<br>")}</p>`);
    }
  }
  return out.join("\n");
}

/** Vero se il testo usa la formattazione: solo allora si invia anche la versione HTML. */
export function hasFormatting(text: string): boolean {
  const lines = text.split("\n");
  return [IMAGE, LINK, BOLD, ITALIC].some((re) => new RegExp(re.source).test(text)) || lines.some((l, i) => LIST.test(l) || isTableStart(lines, i));
}

// ---------- Dall'editor al testo ----------

/** Nodo come lo restituisce l'editor (formato JSON di ProseMirror). */
export interface DocNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: DocNode[];
}

type Mark = { key: string; open: string; close: string };

/** Dall'esterno all'interno: link, corsivo, grassetto. È l'ordine che toHtml riconosce. */
function marksOf(n: DocNode): Mark[] {
  const list: Mark[] = [];
  const link = n.marks?.find((m) => m.type === "link");
  if (link) list.push({ key: `link:${link.attrs?.href}`, open: "[", close: `](${link.attrs?.href})` });
  if (n.marks?.some((m) => m.type === "italic")) list.push({ key: "italic", open: "_", close: "_" });
  if (n.marks?.some((m) => m.type === "bold")) list.push({ key: "bold", open: "**", close: "**" });
  return list;
}

/** Testo di un paragrafo con i segni di formattazione; gli spazi restano fuori dai segni. */
function inlineText(nodes: DocNode[] = []): string {
  let out = "";
  let open: Mark[] = [];
  const closeFrom = (k: number) => {
    for (let j = open.length - 1; j >= k; j--) {
      const ws = out.match(/\s*$/)![0];
      out = out.slice(0, out.length - ws.length) + open[j].close + ws;
    }
    open = open.slice(0, k);
  };
  for (const n of nodes) {
    if (n.type === "hardBreak") {
      closeFrom(0);
      out += "\n";
      continue;
    }
    const text = n.type === "image" ? imageText(n) : (n.text ?? "").replace(/\u00a0/g, " ");
    const core = text.trim();
    if (!core) {
      out += text;
      continue;
    }
    const want = marksOf(n);
    let k = 0;
    while (k < open.length && k < want.length && open[k].key === want[k].key) k++;
    closeFrom(k);
    const lead = text.slice(0, text.length - text.trimStart().length);
    const trail = text.slice(text.trimEnd().length);
    out += lead + want.slice(k).map((m) => m.open).join("") + core + trail;
    open = want;
  }
  closeFrom(0);
  return out;
}

/** Un'immagine nel testo: si richiama con il suo cid, il nome è il testo alternativo. */
function imageText(n: DocNode): string {
  const cid = n.attrs?.cid as string | undefined;
  if (!cid) return "";
  const alt = String(n.attrs?.alt ?? "").replace(/[\]\n]/g, " ").trim();
  return `![${alt}](cid:${cid})`;
}

/** Testo da mostrare senza HTML: le immagini diventano «[immagine: nome]», come nell'email. */
export function plainImages(text: string): string {
  return text.replace(new RegExp(IMAGE.source, "g"), (_, alt: string) => (alt.trim() ? `[immagine: ${alt.trim()}]` : "[immagine]"));
}

/** cid delle immagini richiamate nel testo. */
export function imageCids(text: string): string[] {
  return [...text.matchAll(new RegExp(IMAGE.source, "g"))].map((m) => m[2]);
}

function blockLines(n: DocNode): string[] {
  switch (n.type) {
    case "paragraph":
      return inlineText(n.content).split("\n");
    case "bulletList":
    case "orderedList":
      return (n.content ?? []).flatMap((item) =>
        (item.content ?? []).flatMap(blockLines).map((l, k) => (k === 0 ? `- ${l}` : `  ${l}`)),
      );
    case "blockquote":
      return (n.content ?? []).flatMap(blockLines).map((l) => (l ? `> ${l}` : ">"));
    case "table": {
      const rows = (n.content ?? []).map((row) =>
        (row.content ?? []).map((cell) => (cell.content ?? []).flatMap(blockLines).join(" ").replace(/\|/g, "\\|").trim()),
      );
      if (rows.length === 0) return [];
      const line = (r: string[]) => `| ${r.map((c) => c || " ").join(" | ")} |`;
      return [line(rows[0]), line(rows[0].map(() => "---")), ...rows.slice(1).map(line)];
    }
    case "image":
      return [imageText(n)];
    default:
      return n.content ? n.content.flatMap(blockLines) : n.text ? [n.text] : [];
  }
}

/** Testo con la formattazione leggera dal documento dell'editor: ogni paragrafo è una riga. */
export function toMarkdown(doc: DocNode): string {
  return (doc.content ?? []).flatMap(blockLines).join("\n").replace(/\s+$/, "");
}
