// Formattazione leggera nell'editor: **grassetto**, _corsivo_, [link](url), elenchi "- " e citazioni "> ".
// Il testo resta leggibile così com'è (parte text/plain) e diventa HTML per la parte text/html.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g;
const BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const ITALIC = /(^|[\s(])_(?=\S)(.+?)(?<=\S)_(?=$|[\s).,;:!?])/g;
const LIST = /^\s*[-*] /;
const QUOTE = /^\s*>/;

function inline(s: string): string {
  return esc(s).replace(LINK, '<a href="$2">$1</a>').replace(BOLD, "<strong>$1</strong>").replace(ITALIC, "$1<em>$2</em>");
}

export function toHtml(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (QUOTE.test(lines[i])) {
      const block: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) block.push(lines[i++].replace(/^\s*> ?/, ""));
      out.push(`<blockquote style="margin:0 0 0 .8em;padding-left:.8em;border-left:3px solid #ccc;color:#555">${toHtml(block.join("\n"))}</blockquote>`);
    } else if (LIST.test(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && LIST.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(LIST, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
    } else if (!lines[i].trim()) {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !QUOTE.test(lines[i]) && !LIST.test(lines[i])) para.push(inline(lines[i++]));
      out.push(`<p>${para.join("<br>")}</p>`);
    }
  }
  return out.join("\n");
}

/** Vero se il testo usa la formattazione: solo allora si invia anche la versione HTML. */
export function hasFormatting(text: string): boolean {
  return [LINK, BOLD, ITALIC].some((re) => new RegExp(re.source).test(text)) || text.split("\n").some((l) => LIST.test(l));
}
