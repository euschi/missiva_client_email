// Dati locali condivisi con il backend: posticipi ed etichette in ~/.config/missiva/.

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Message } from "./types";

export interface Snooze {
  /** Secondi Unix. */
  until: number;
  accountId: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Labels {
  defs: Label[];
  /** Chiave del messaggio → id delle etichette. */
  byMessage: Record<string, string[]>;
}

/** Regola applicata ai nuovi messaggi in arrivo. */
export interface Rule {
  id: string;
  /** Solo per i messaggi di questo account; senza vale per tutti. */
  accountId: string | null;
  field: "from" | "to" | "subject";
  contains: string;
  action: "read" | "star" | "label" | "archive" | "trash" | "spam" | "move";
  labelId?: string;
  /** Cartella di destinazione per "move": percorso IMAP e nome leggibile. */
  boxPath?: string;
  boxLabel?: string;
  /** Falso quando la regola è sospesa; assente vale attiva. */
  enabled?: boolean;
}

/** Azioni che tolgono il messaggio dalla posta in arrivo. */
export const MOVING_ACTIONS: Rule["action"][] = ["archive", "trash", "spam", "move"];

export const ruleActive = (r: Rule) => r.enabled !== false;

/** Vero se il messaggio soddisfa la condizione della regola (account compreso). */
export function ruleMatches(r: Rule, m: Message): boolean {
  if ((r.accountId && r.accountId !== m.accountId) || !r.contains) return false;
  const text = r.field === "from" ? `${m.fromName} ${m.fromEmail}` : r.field === "to" ? [...m.to, ...m.cc].map((c) => `${c.name} ${c.email}`).join(" ") : m.subject;
  return text.toLowerCase().includes(r.contains.toLowerCase());
}

/** Modello di messaggio riutilizzabile. */
export interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export const LABEL_COLORS = ["#C9F26B", "#FFB86B", "#8FD3FF", "#C7B5FF", "#FF8F7A", "#7EE0B5", "#F2A65A", "#E8A0FF"];

/** L'header Message-ID sopravvive agli spostamenti tra cartelle, l'UID no. */
export const keyOf = (m: Message) => m.messageId ?? m.id;

/** Stato salvato in un archivio JSON del backend; finché non è caricato vale `initial`. */
export function useStore<T>(name: "snoozed" | "labels" | "trusted" | "rules" | "templates" | "mcp_actions", initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    api.readStore(name).then((v) => v != null && setValue(Array.isArray(initial) ? (v as T) : { ...initial, ...(v as T) }), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  const save = useCallback(
    (next: T) => {
      setValue(next);
      api.writeStore(name, next).catch(() => {});
    },
    [name],
  );
  return [value, save];
}
