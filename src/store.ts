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

export const LABEL_COLORS = ["#C9F26B", "#FFB86B", "#8FD3FF", "#C7B5FF", "#FF8F7A", "#7EE0B5", "#F2A65A", "#E8A0FF"];

/** L'header Message-ID sopravvive agli spostamenti tra cartelle, l'UID no. */
export const keyOf = (m: Message) => m.messageId ?? m.id;

/** Stato salvato in un archivio JSON del backend; finché non è caricato vale `initial`. */
export function useStore<T>(name: "snoozed" | "labels", initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    api.readStore(name).then((v) => v != null && setValue({ ...initial, ...(v as T) }), () => {});
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
