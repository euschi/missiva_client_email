// Quello che una bozza sul server non conserva: testo con la formattazione, Ccn, firma scelta,
// citazione con la sua impaginazione e immagini nel testo. Si ritrova per Message-ID.
import { api } from "./api";
import type { InlineImage } from "./types";

export interface DraftMeta {
  accountId: string;
  /** Secondi Unix dell'ultimo salvataggio. */
  savedAt: number;
  body: string;
  bcc: string[];
  quote: string | null;
  quoteHtml: string | null;
  signatureId: string;
  images: InlineImage[];
}

const NAME = "drafts_meta";
/** Bozze abbandonate (eliminate altrove): dopo sei mesi si dimenticano. */
const MAX_AGE_SEC = 180 * 24 * 3600;
/** Una citazione enorme non vale il peso del file: si ripiega sul testo. */
const MAX_QUOTE_HTML = 400_000;

type All = Record<string, DraftMeta>;

let cache: Promise<All> | null = null;
let queue: Promise<void> = Promise.resolve();

const load = (): Promise<All> =>
  (cache ??= api.readStore(NAME).then(
    (v) => (v && typeof v === "object" && !Array.isArray(v) ? (v as All) : {}),
    () => ({}),
  ));

/** Le scritture passano in fila, ognuna sull'ultima versione. */
function update(change: (all: All) => All): Promise<void> {
  queue = queue.then(async () => {
    const now = Date.now() / 1000;
    const next = Object.fromEntries(Object.entries(change({ ...(await load()) })).filter(([, m]) => now - m.savedAt < MAX_AGE_SEC));
    cache = Promise.resolve(next);
    await api.writeStore(NAME, next).catch(() => {});
  });
  return queue;
}

export const rememberDraft = (messageId: string, meta: DraftMeta) =>
  update((all) => ({ ...all, [messageId]: meta.quoteHtml && meta.quoteHtml.length > MAX_QUOTE_HTML ? { ...meta, quoteHtml: null } : meta }));

export const forgetDraft = (messageId: string | null | undefined) =>
  messageId
    ? update((all) => {
        delete all[messageId];
        return all;
      })
    : Promise.resolve();

export const draftMeta = async (messageId: string | null | undefined): Promise<DraftMeta | null> => (messageId ? ((await load())[messageId] ?? null) : null);
