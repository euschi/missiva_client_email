// Conversazioni: messaggi collegati da Message-ID, In-Reply-To e References, sempre dentro lo stesso account.

import type { Message } from "./types";

const keyOf = (accountId: string, messageId: string) => `${accountId}|${messageId.toLowerCase()}`;

export interface Threads {
  /** Messaggi della conversazione di `m`, dal più vecchio; almeno `m` stesso. */
  of: (m: Message) => Message[];
  /** Quanti messaggi ha la conversazione di `m`. */
  size: (m: Message) => number;
}

/**
 * Raggruppa i messaggi di tutte le cartelle caricate. Lo stesso messaggio può stare in più
 * cartelle (es. Posta in arrivo e Archivio) o esistere come copia locale appena inviata:
 * vale una sola copia, preferendo quella arrivata dal server.
 */
export function buildThreads(all: Message[]): Threads {
  const groupKey = (m: Message) => (m.messageId ? keyOf(m.accountId, m.messageId) : m.id);

  const unique = new Map<string, Message>();
  for (const m of all) {
    const prev = unique.get(groupKey(m));
    if (!prev || (prev.id.startsWith("local:") && !m.id.startsWith("local:"))) unique.set(groupKey(m), m);
  }

  // Union-find sulle chiavi dei Message-ID.
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(k, root);
    return root;
  };
  const join = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const m of unique.values()) {
    const own = groupKey(m);
    find(own);
    for (const id of [...m.references, ...(m.inReplyTo ? [m.inReplyTo] : [])]) join(own, keyOf(m.accountId, id));
  }

  const groups = new Map<string, Message[]>();
  for (const m of unique.values()) {
    const root = find(groupKey(m));
    groups.set(root, [...(groups.get(root) ?? []), m]);
  }
  for (const list of groups.values()) list.sort((a, b) => a.date - b.date);

  const listOf = (m: Message) => groups.get(find(groupKey(m))) ?? [m];
  return {
    of: (m) => {
      const list = listOf(m);
      // Il messaggio aperto resta quello scelto, anche se la copia tenuta è di un'altra cartella.
      return list.some((x) => x.id === m.id) ? list : list.map((x) => (groupKey(x) === groupKey(m) ? m : x));
    },
    size: (m) => listOf(m).length,
  };
}
