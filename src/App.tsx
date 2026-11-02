import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errorText, inTauri } from "./api";
import { AddAccount } from "./components/AddAccount";
import { Compose } from "./components/Compose";
import { Confirm } from "./components/Modal";
import { LinkChooser } from "./components/LinkChooser";
import { MessageList, type Chip } from "./components/MessageList";
import { nextLabelColor } from "./components/Pickers";
import { Preview } from "./components/Preview";
import { Reader, type ReaderMenu } from "./components/Reader";
import { Settings, type Section } from "./components/Settings";
import { Sidebar, VIEWS, type View } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { longTime, plural, relativeSync } from "./format";
import { Icon } from "./icons";
import { notifyNewMail } from "./notify";
import { buildThreads } from "./threads";
import { applyPrefs, loadPrefs, savePrefs, type Prefs } from "./prefs";
import { keyOf, useStore, type Labels, type Snooze } from "./store";
import type { Account, Browser, Contact, Draft, Folder, Mailbox, Message, OpenBox, Outgoing, Scheduled } from "./types";

type ModalState =
  | { kind: "compose"; draft: Draft }
  | { kind: "account" }
  | { kind: "settings"; section: Section }
  | { kind: "preview"; message: Message; index: number }
  | { kind: "link"; url: string; browsers: Browser[] }
  | { kind: "confirm"; title: string; text: string; action: string; run: () => void };

/** Posta in arrivo e cartella aperta: ogni minuto. */
const SYNC_EVERY_MS = 60_000;
/** Tempo per annullare uno spostamento, prima che arrivi al server. */
const UNDO_MS = 6_000;
/** Inviati (per le conversazioni) si aggiorna un giro sì e quattro no. */
const SENT_EVERY_TICKS = 5;

const folderOf = (v: View): Folder => (v === "flagged" || v === "snoozed" || v === "scheduled" ? "inbox" : v);
const nowSec = () => Math.floor(Date.now() / 1000);
/** Message-ID nuovo, sul dominio del mittente come fanno i client di posta. */
const newMessageId = (email = "") => `${crypto.randomUUID()}@${email.split("@")[1] || "missiva.local"}`;

/** Un messaggio in coda di invio, mostrato nell'elenco come gli altri. */
const scheduledMessage = (s: Scheduled): Message => {
  const o = s.outgoing;
  return {
    id: `scheduled:${s.id}`,
    accountId: o.accountId,
    folder: "drafts",
    mailbox: "",
    uid: 0,
    messageId: null,
    inReplyTo: o.inReplyTo,
    references: o.references ?? [],
    fromName: `A: ${o.to.join(", ")}`,
    fromEmail: "",
    to: o.to.map((email) => ({ name: email, email })),
    cc: o.cc.map((email) => ({ name: email, email })),
    subject: o.subject || "(senza oggetto)",
    snippet: o.body.replace(/\s+/g, " ").slice(0, 180),
    body: o.body,
    date: s.at,
    unread: false,
    flagged: false,
    attachments: o.attachments.map((path, index) => {
      const name = path.split("/").pop() ?? path;
      return { index, name, size: 0, kind: (name.split(".").pop() ?? "FILE").slice(0, 4).toUpperCase(), mime: "", inline: false };
    }),
    hasHtml: false,
    scheduled: s,
  };
};
const byDateDesc = (a: Message, b: Message) => b.date - a.date;

/** Chiave in `byFolder` dei messaggi di una cartella dell'utente. */
const boxKey = (b: OpenBox) => `box:${b.accountId}:${b.mailbox.path}`;
const isBoxKey = (key: string) => key.startsWith("box:");
/** Risultati dell'ultima ricerca sul server: stanno in `byFolder` per seguire letture e spostamenti. */
const SEARCH_KEY = "box:search";
/** Messaggi vecchi caricati a mano per una cartella: la sincronizzazione non li tocca. */
const olderKey = (listKey: string) => `box:older:${listKey}`;
const uniqueById = (list: Message[]) => [...new Map(list.map((m) => [m.id, m])).values()];
const prefixed = (prefix: string, s: string) => (s.toLowerCase().startsWith(prefix.toLowerCase()) ? s : `${prefix} ${s}`);
const quote = (m: Message) => `\n\nIl ${longTime(m.date)}, ${m.fromName} <${m.fromEmail}> ha scritto:\n` + m.body.split("\n").map((l) => `> ${l}`).join("\n");

/** Rubrica ricavata dalla posta scaricata: prima chi ho scritto io, poi per numero di messaggi. */
function contactsFrom(byFolder: Record<string, Message[] | undefined>, accounts: Account[]): Contact[] {
  const own = new Set(accounts.map((a) => a.email.toLowerCase()));
  const found = new Map<string, Contact & { score: number }>();
  const add = (name: string, email: string, weight: number) => {
    const key = email.toLowerCase();
    if (!key.includes("@") || own.has(key) || /^(no-?reply|do-?not-?reply|mailer-daemon|notifications?)@/.test(key)) return;
    const known = found.get(key);
    const label = name && name !== email ? name : known?.name || email;
    found.set(key, { name: label, email, score: (known?.score ?? 0) + weight });
  };
  for (const list of Object.values(byFolder)) {
    for (const m of list ?? []) {
      if (m.folder === "sent") [...m.to, ...m.cc].forEach((c) => add(c.name, c.email, 5));
      else if (m.folder !== "trash" && m.fromEmail) add(m.fromName, m.fromEmail, 1);
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

export function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Chiavi: le cartelle speciali ("inbox", "sent"…) e le cartelle dell'utente (boxKey).
  const [byFolder, setByFolder] = useState<Record<string, Message[] | undefined>>({});
  const [mailboxes, setMailboxes] = useState<Record<string, Mailbox[]>>({});
  const [box, setBox] = useState<OpenBox | null>(null);
  const [view, setView] = useState<View>("inbox");
  const [accountFilter, setAccountFilter] = useState("all");
  const [chip, setChip] = useState<Chip>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Selezione multipla: caselle delle righe, Ctrl/Maiusc + clic, Maiusc + frecce.
  const [checked, setChecked] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [syncing, setSyncing] = useState(0);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<ModalState | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [toast, setToast] = useState<{ text: string; error?: boolean; undo?: () => void } | null>(null);
  // Messaggi già tolti dall'elenco, in attesa che scada il tempo per annullare.
  const [hidden, setHidden] = useState<string[]>([]);
  const pending = useRef<{ ids: string[]; selected: string | null; timer: ReturnType<typeof setTimeout>; commit: () => void } | null>(null);
  /** Query già cercata sul server (in minuscolo) e stato della ricerca. */
  const [serverQuery, setServerQuery] = useState<{ q: string; busy: boolean } | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  /** Elenchi arrivati in fondo: non c'è altro da caricare. */
  const [olderDone, setOlderDone] = useState<string[]>([]);
  const [, setTick] = useState(0);
  const [trayAvailable, setTrayAvailable] = useState(false);
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [menu, setMenu] = useState<ReaderMenu>(null);
  const [scheduled, setScheduled] = useState<Scheduled[]>([]);
  const [snoozed, setSnoozed] = useStore<Record<string, Snooze>>("snoozed", {});
  const [labels, setLabels] = useStore<Labels>("labels", { defs: [], byMessage: {} });
  /** Mittenti di cui mostrare sempre le immagini remote (indirizzi in minuscolo). */
  const [trusted, setTrusted] = useStore<string[]>("trusted", []);
  const searchRef = useRef<HTMLInputElement>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  // Id già visti in posta in arrivo: serve a notificare solo i messaggi davvero nuovi.
  const knownIds = useRef<Set<string> | null>(null);

  const accountsById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  useEffect(() => applyPrefs(prefs), [prefs]);
  const setPrefs = (p: Prefs) => {
    setPrefsState(p);
    savePrefs(p);
  };

  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? UNDO_MS : toast.error ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const patchMessage = (id: string, patch: Partial<Message>) =>
    setByFolder((all) => Object.fromEntries(Object.entries(all).map(([f, list]) => [f, list?.map((m) => (m.id === id ? { ...m, ...patch } : m))])));
  const dropMessage = (id: string) =>
    setByFolder((all) => Object.fromEntries(Object.entries(all).map(([f, list]) => [f, list?.filter((m) => m.id !== id)])));

  /** Con `account` aggiorna solo i messaggi e l'errore di quell'account. Vero se nessun account ha dato errore. */
  const sync = useCallback(async (folder: Folder, account?: string): Promise<boolean> => {
    setSyncing((n) => n + 1);
    try {
      const report = await api.syncFolder(folder, account);
      if (folder === "inbox") {
        const known = knownIds.current;
        const fresh = known ? report.messages.filter((m) => m.unread && !known.has(m.id)) : [];
        knownIds.current = new Set([...(known ?? []), ...report.messages.map((m) => m.id)]);
        if (fresh.length && prefsRef.current.notify) notifyNewMail(fresh, prefsRef.current.notifyPreview);
      }
      const failed = Object.fromEntries(report.errors.map((e) => [e.accountId, e.message]));
      if (account) {
        setByFolder((all) => ({
          ...all,
          [folder]: [...(all[folder] ?? []).filter((m) => m.accountId !== account), ...report.messages].sort(byDateDesc),
        }));
        setErrors(({ [account]: _, ...rest }) => ({ ...rest, ...failed }));
      } else {
        setByFolder((all) => ({ ...all, [folder]: report.messages.sort(byDateDesc) }));
        setErrors(failed);
      }
      setLastSync(new Date());
      return report.errors.length === 0;
    } catch (e) {
      notify(errorText(e), true);
      return false;
    } finally {
      setSyncing((n) => n - 1);
    }
  }, [notify]);

  /** Sincronizza una cartella dell'utente; in silenzio (sincronizzazione periodica) non mostra errori. */
  const syncBox = useCallback(async (b: OpenBox, quiet = false): Promise<boolean> => {
    setSyncing((n) => n + 1);
    try {
      const report = await api.syncMailbox(b.accountId, b.mailbox.path);
      setByFolder((all) => ({ ...all, [boxKey(b)]: report.messages.sort(byDateDesc) }));
      if (report.errors.length && !quiet) notify(`«${b.mailbox.label}»: ${report.errors[0].message}`, true);
      return report.errors.length === 0;
    } catch (e) {
      if (!quiet) notify(errorText(e), true);
      return false;
    } finally {
      setSyncing((n) => n - 1);
    }
  }, [notify]);

  /** Cartelle dell'utente: prima dalla cache (subito), poi aggiornate dal server. */
  const loadMailboxes = useCallback((list: Account[]) => {
    for (const a of list) {
      const set = (boxes: Mailbox[]) => setMailboxes((all) => ({ ...all, [a.id]: boxes }));
      api.mailboxes(a.id, false).then(set, () => {}).finally(() => api.mailboxes(a.id, true).then(set, () => {}));
    }
  }, []);

  const loadFolder = useCallback(async (folder: Folder) => {
    const cached = await api.cachedMessages(folder).catch(() => []);
    if (folder === "inbox" && cached.length && !knownIds.current) knownIds.current = new Set(cached.map((m) => m.id));
    setByFolder((all) => ({ ...all, [folder]: all[folder]?.length ? all[folder] : cached.sort(byDateDesc) }));
    await sync(folder);
  }, [sync]);

  // Avvio: account, cache della posta in arrivo, poi sincronizzazione.
  useEffect(() => {
    (async () => {
      const list = await api.listAccounts().catch((e) => (notify(errorText(e), true), []));
      setAccounts(list);
      setLoaded(true);
      if (list.length === 0) setModal({ kind: "account" });
      else {
        loadMailboxes(list);
        await loadFolder("inbox");
        // Le risposte inviate servono a completare le conversazioni.
        loadFolder("sent");
      }
    })();
  }, [loadFolder, loadMailboxes, notify]);

  useEffect(() => {
    if (accounts.length === 0) return;
    const folder = folderOf(view);
    let tick = 0;
    let last = Date.now();
    const run = (withSent: boolean) => {
      last = Date.now();
      if (box) syncBox(box, true);
      else sync(folder);
      if (folder !== "inbox" || box) sync("inbox");
      if ((folder !== "sent" || box) && withSent) sync("sent");
    };
    const t = setInterval(() => run(++tick % SENT_EVERY_TICKS === 0), SYNC_EVERY_MS);
    // Tornando alla finestra dopo un po' la posta si aggiorna subito, senza aspettare il giro.
    const onFocus = () => Date.now() - last > 30_000 && run(false);
    window.addEventListener("focus", onFocus);
    const clock = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
      window.removeEventListener("focus", onFocus);
    };
  }, [view, box, accounts.length, sync, syncBox]);

  const loadScheduled = useCallback(() => api.listScheduled().then(setScheduled, () => {}), []);
  useEffect(() => {
    loadScheduled();
    if (!inTauri) return;
    const off = listen<{ subject: string; error: string | null }>("outbox-changed", (e) => {
      loadScheduled();
      const subject = e.payload.subject || "(senza oggetto)";
      if (e.payload.error) notify(`«${subject}» non è partito: ${e.payload.error}`, true);
      else notify(`Messaggio programmato inviato: «${subject}»`);
    });
    return () => {
      off.then((f) => f());
    };
  }, [loadScheduled, notify]);

  // Area di notifica: disponibilità, voce "Sincronizza ora" e chiusura che nasconde la finestra.
  useEffect(() => {
    if (!inTauri) return;
    api.trayAvailable().then(setTrayAvailable);
    const win = getCurrentWindow();
    const unlisten = [
      listen("tray-sync", () => sync(folderOf(viewRef.current))),
      win.onCloseRequested(async (e) => {
        if (prefsRef.current.closeToTray && (await api.trayAvailable())) {
          e.preventDefault();
          await win.hide();
        }
      }),
    ];
    return () => unlisten.forEach((p) => p.then((off) => off()));
  }, [sync]);

  const viewRef = useRef(view);
  viewRef.current = view;

  const openBox = async (b: OpenBox) => {
    setBox(b);
    setSelectedId(null);
    setChecked([]);
    setMenu(null);
    if (!byFolder[boxKey(b)]) {
      const cached = await api.cachedMailbox(b.accountId, b.mailbox.path).catch(() => []);
      setByFolder((all) => ({ ...all, [boxKey(b)]: all[boxKey(b)] ?? cached.sort(byDateDesc) }));
    }
    await syncBox(b);
  };

  const syncCurrent = () => (box ? syncBox(box) : sync(folderOf(view)));

  const changeView = (v: View) => {
    setBox(null);
    setView(v);
    setSelectedId(null);
    setChecked([]);
    setMenu(null);
    if (v === "scheduled") loadScheduled();
    const folder = folderOf(v);
    if (folder !== "inbox" || !byFolder.inbox) loadFolder(folder);
  };

  // Posticipi ed etichette sono legati alla chiave del messaggio.
  const now = nowSec();
  const snoozeOf = (m: Message) => (m.folder === "inbox" && snoozed[keyOf(m)]?.until > now ? snoozed[keyOf(m)].until : undefined);
  const labelsOf = (m: Message) => (labels.byMessage[keyOf(m)] ?? []).map((id) => labels.defs.find((l) => l.id === id)).filter((l) => l !== undefined);

  // Elenco visibile: cartella, account, filtro rapido, etichetta e ricerca.
  const isHidden = (m: Message) => hidden.includes(m.id);
  const inbox = (byFolder.inbox ?? []).filter((m) => !snoozeOf(m) && !isHidden(m));
  const q = query.trim().toLowerCase();
  const searching = !!q && serverQuery?.q === q;
  const listKey = box ? boxKey(box) : folderOf(view);
  // Anche i messaggi vecchi caricati a mano, ma non nelle viste calcolate.
  const canLoadOlder = !q && (!!box || !["flagged", "snoozed", "scheduled"].includes(view));
  const older = canLoadOlder ? (byFolder[olderKey(listKey)] ?? []) : [];
  const source = searching
    ? (byFolder[SEARCH_KEY] ?? [])
    : box
    ? uniqueById([...(byFolder[boxKey(box)] ?? []), ...older])
    : view === "scheduled"
      ? scheduled.map(scheduledMessage).sort((a, b) => a.date - b.date)
      : view === "snoozed"
        ? (byFolder.inbox ?? []).filter((m) => snoozeOf(m)).sort((a, b) => snoozeOf(a)! - snoozeOf(b)!)
        : view === "inbox"
          ? uniqueById([...inbox, ...older.filter((m) => !snoozeOf(m))])
          : uniqueById([...(byFolder[folderOf(view)] ?? []), ...older]);
  const visible = source.filter(
    (m) =>
      accountsById[m.accountId] &&
      !isHidden(m) &&
      (box || accountFilter === "all" || m.accountId === accountFilter) &&
      (box || searching || view !== "flagged" || m.flagged) &&
      (!labelFilter || labelsOf(m).some((l) => l.id === labelFilter)) &&
      (chip !== "unread" || m.unread) &&
      (chip !== "attach" || m.attachments.length > 0) &&
      (!q || searching || [m.fromName, m.fromEmail, m.subject, m.body].some((s) => s.toLowerCase().includes(q))),
  );
  const selected = visible.find((m) => m.id === selectedId) ?? visible[0] ?? null;
  const chosen = checked.length ? visible.filter((m) => checked.includes(m.id)) : [];
  const bulk = chosen.length ? chosen : null;
  const bulkAccount = bulk?.every((m) => m.accountId === bulk[0].accountId) ? bulk[0].accountId : null;
  const bulkBoxes = (bulkAccount && mailboxes[bulkAccount]?.filter((b) => b.selectable && !b.special)) || [];
  // Conversazioni su tutte le cartelle caricate (Inviati compresa).
  const threads = useMemo(() => buildThreads(Object.values(byFolder).flatMap((list) => list ?? [])), [byFolder]);
  const composing = modal?.kind === "compose";
  // Suggerimenti dei destinatari: chi ho già scritto prima, poi chi mi ha scritto.
  const contacts = useMemo(() => (composing ? contactsFrom(byFolder, accounts) : []), [composing, byFolder, accounts]);

  const unreadByAccount = Object.fromEntries(accounts.map((a) => [a.id, inbox.filter((m) => m.unread && m.accountId === a.id).length]));
  // Contatori della radice «Tutti gli account»: sempre su tutti gli account.
  const known = (m: Message) => !!accountsById[m.accountId];
  const totalUnread = inbox.filter((m) => m.unread && accountsById[m.accountId]).length;
  useEffect(() => {
    api.setTrayUnread(totalUnread).catch(() => {});
  }, [totalUnread]);

  const counts = {
    inbox: inbox.filter((m) => m.unread && known(m)).length,
    flagged: inbox.filter((m) => m.flagged && known(m)).length,
    snoozed: (byFolder.inbox ?? []).filter((m) => snoozeOf(m) && known(m)).length,
    scheduled: scheduled.length,
    drafts: (byFolder.drafts ?? []).filter(known).length,
  };
  const labelCounts = Object.fromEntries(labels.defs.map((l) => [l.id, Object.values(labels.byMessage).filter((ids) => ids.includes(l.id)).length]));

  // Allo scadere del posticipo il messaggio torna in arrivo come non letto, con notifica.
  useEffect(() => {
    // Dopo la prima sincronizzazione, che altrimenti riscriverebbe lo stato "letto".
    if (!byFolder.inbox || !lastSync || syncing) return;
    const due = Object.entries(snoozed).filter(([, s]) => s.until <= now);
    if (due.length === 0) return;
    const back = byFolder.inbox.filter((m) => due.some(([k]) => k === keyOf(m)));
    for (const m of back) {
      if (!m.unread) markUnread(m);
    }
    if (back.length && prefs.notify) notifyNewMail(back, prefs.notifyPreview);
    setSnoozed(Object.fromEntries(Object.entries(snoozed).filter(([, s]) => s.until > now)));
  });

  // ---------- Azioni sui messaggi ----------

  const select = (m: Message) => {
    setSelectedId(m.id);
    if (m.unread && prefs.markReadOnOpen) {
      patchMessage(m.id, { unread: false });
      api.setFlags(m, { seen: true }).catch((e) => {
        patchMessage(m.id, { unread: true });
        notify(errorText(e), true);
      });
    }
  };

  /** Messaggi tra due id dell'elenco visibile, estremi compresi. */
  const between = (fromId: string, toId: string) => {
    const a = visible.findIndex((x) => x.id === fromId);
    const b = visible.findIndex((x) => x.id === toId);
    if (a < 0 || b < 0) return [toId];
    return visible.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id);
  };

  /** Clic su una riga: semplice apre, Ctrl aggiunge o toglie, Maiusc seleziona l'intervallo. */
  const pick = (m: Message, mods: { ctrl: boolean; shift: boolean }) => {
    if (mods.shift) {
      setChecked(between(anchor.current ?? selected?.id ?? m.id, m.id));
      setSelectedId(m.id);
    } else if (mods.ctrl) {
      const base = checked.length ? checked : selected ? [selected.id] : [];
      const next = base.includes(m.id) ? base.filter((id) => id !== m.id) : [...base, m.id];
      setChecked(next);
      anchor.current = m.id;
      if (next.length === 1) setSelectedId(next[0]);
    } else {
      setChecked([]);
      anchor.current = m.id;
      select(m);
    }
  };

  /** Casella di una riga: non apre il messaggio; con Maiusc aggiunge l'intervallo dall'ultima spuntata. */
  const checkRow = (m: Message, shift: boolean) => {
    if (shift && anchor.current) {
      const range = between(anchor.current, m.id);
      setChecked((list) => [...new Set([...list, ...range])]);
    } else {
      setChecked((list) => (list.includes(m.id) ? list.filter((id) => id !== m.id) : [...list, m.id]));
    }
    anchor.current = m.id;
  };

  const checkAll = () => setChecked(chosen.length === visible.length ? [] : visible.map((m) => m.id));

  /** Maiusc + ↓/↑: allarga la selezione dall'àncora alla riga successiva o precedente. */
  const extend = (d: number) => {
    const i = visible.findIndex((x) => x.id === selected?.id);
    const next = visible[Math.min(Math.max(i + d, 0), visible.length - 1)];
    if (!next || !selected) return;
    anchor.current ??= selected.id;
    setChecked(between(anchor.current, next.id));
    setSelectedId(next.id);
  };

  /** Dopo un errore riallinea la cartella del messaggio con il server. */
  const refresh = (m: Message) => (m.folder === "other" ? box && syncBox(box) : sync(m.folder));

  /** Toglie i messaggi dalla selezione; se tra loro c'è quello aperto, apre il primo rimasto. */
  const leaveList = (ms: Message[]) => {
    const ids = new Set(ms.map((m) => m.id));
    const last = Math.max(...ms.map((m) => visible.indexOf(m)));
    const next = visible.slice(last + 1).find((m) => !ids.has(m.id)) ?? [...visible].reverse().find((m) => !ids.has(m.id));
    setChecked((list) => list.filter((id) => !ids.has(id)));
    if (!selected || ids.has(selected.id)) setSelectedId(next?.id ?? null);
  };

  /** Rende definitivo subito lo spostamento in attesa, se c'è. */
  const flushPending = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    p.commit();
  };

  const undoPending = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    setHidden((list) => list.filter((id) => !p.ids.includes(id)));
    setSelectedId(p.selected);
    setToast(null);
  };

  /**
   * Toglie subito i messaggi dall'elenco ma parla col server solo allo scadere del tempo per annullare.
   * Se l'app viene chiusa prima, i messaggi restano semplicemente dov'erano.
   */
  const moveWithUndo = (ms: Message[], text: string, call: () => Promise<void>, after?: () => void) => {
    flushPending();
    const ids = ms.map((m) => m.id);
    const commit = () => {
      ms.forEach((m) => dropMessage(m.id));
      setHidden((list) => list.filter((id) => !ids.includes(id)));
      call()
        .then(after)
        .catch((e) => {
          notify(errorText(e), true);
          ms.forEach(refresh);
        });
    };
    const openBefore = selected?.id ?? null;
    leaveList(ms);
    setHidden((list) => [...list, ...ids]);
    pending.current = { ids, selected: openBefore, commit, timer: setTimeout(flushPending, UNDO_MS) };
    setToast({ text, undo: undoPending });
  };

  const movedText = (n: number, to: Folder) =>
    to === "archive"
      ? plural(n, "messaggio archiviato", "messaggi archiviati")
      : `${plural(n, "messaggio spostato", "messaggi spostati")} ${to === "inbox" ? "in Posta in arrivo" : "nel cestino"}`;

  const movableFrom = (ms: Message[]) => ms.filter((m) => !m.scheduled && !m.id.startsWith("local:"));

  const moveMany = (ms: Message[], to: Folder) => {
    if (to === "trash") ms.filter((m) => m.scheduled).forEach((m) => cancelScheduled(m.scheduled!));
    const movable = movableFrom(ms).filter((m) => m.folder !== to);
    if (!movable.length) return;
    moveWithUndo(
      movable,
      movedText(movable.length, to),
      () => api.moveMessages(movable, to),
      // Riporta i messaggi nell'elenco di arrivo senza aspettare il prossimo giro.
      () => void (to === "inbox" && sync("inbox")),
    );
  };

  /** Sposta in una cartella dell'utente: i messaggi sono tutti dello stesso account. */
  const moveToBox = (ms: Message[], target: Mailbox) => {
    const movable = movableFrom(ms).filter((m) => m.mailbox !== target.path);
    if (!movable.length) return;
    const dest = { accountId: movable[0].accountId, mailbox: target };
    moveWithUndo(
      movable,
      `${plural(movable.length, "messaggio spostato", "messaggi spostati")} in «${target.label}»`,
      () => api.moveToMailbox(movable, target.path),
      () => void (byFolder[boxKey(dest)] && syncBox(dest, true)),
    );
  };

  /** Dal Cestino non si torna indietro: prima chiede conferma. */
  const askDeleteForever = (ms: Message[]) => {
    const targets = movableFrom(ms).filter((m) => m.folder === "trash");
    if (!targets.length) return;
    setModal({
      kind: "confirm",
      title: targets.length === 1 ? "Eliminare il messaggio?" : `Eliminare ${targets.length} messaggi?`,
      text: "Vengono cancellati definitivamente dal server e non si possono recuperare.",
      action: "Elimina definitivamente",
      run: () => {
        setModal(null);
        leaveList(targets);
        targets.forEach((m) => dropMessage(m.id));
        api
          .deleteForever(targets)
          .then(() => notify(`${plural(targets.length, "messaggio eliminato", "messaggi eliminati")} definitivamente`))
          .catch((e) => {
            notify(errorText(e), true);
            targets.forEach(refresh);
          });
      },
    });
  };

  const askEmptyTrash = () => {
    const account = accountFilter === "all" ? null : accountFilter;
    setModal({
      kind: "confirm",
      title: "Svuotare il cestino?",
      text: `Tutti i messaggi nel Cestino di ${account ? accountsById[account]?.name : "tutti gli account"}, anche quelli non scaricati, vengono cancellati definitivamente dal server.`,
      action: "Svuota il cestino",
      run: () => {
        setModal(null);
        setSelectedId(null);
        setChecked([]);
        api
          .emptyTrash(account)
          .then(() => notify("Cestino svuotato"))
          .catch((e) => notify(errorText(e), true))
          .finally(() => {
            setByFolder((all) => ({ ...all, [olderKey("trash")]: [] }));
            sync("trash");
          });
      },
    });
  };

  /** Nel Cestino elimina per sempre, altrove sposta nel Cestino. */
  const trash = (m: Message) => (m.folder === "trash" ? askDeleteForever([m]) : moveMany([m], "trash"));

  const searchOnServer = async () => {
    if (!q || serverQuery?.busy) return;
    const asked = q;
    setServerQuery({ q: asked, busy: true });
    setByFolder((all) => ({ ...all, [SEARCH_KEY]: [] }));
    setChecked([]);
    setSelectedId(null);
    try {
      const report = await api.searchMail(query.trim());
      setByFolder((all) => ({ ...all, [SEARCH_KEY]: report.messages.sort(byDateDesc) }));
      if (report.errors.length) {
        const name = accountsById[report.errors[0].accountId]?.name ?? "Un account";
        notify(`${name}: ricerca non riuscita (${report.errors[0].message})`, true);
      }
      setServerQuery({ q: asked, busy: false });
    } catch (e) {
      notify(errorText(e), true);
      setServerQuery(null);
    }
  };

  /** Scarica la pagina precedente per ogni casella presente nell'elenco. */
  const loadOlder = async () => {
    if (olderBusy) return;
    const key = listKey;
    const oldest = new Map<string, Message>();
    for (const m of source) {
      if (m.uid === 0 || m.id.startsWith("local:") || (!box && accountFilter !== "all" && m.accountId !== accountFilter)) continue;
      const group = `${m.accountId}|${m.mailbox}`;
      const known = oldest.get(group);
      if (!known || m.uid < known.uid) oldest.set(group, m);
    }
    setOlderBusy(true);
    const results = await Promise.allSettled([...oldest.values()].map((m) => api.loadOlder(m)));
    setOlderBusy(false);
    const found = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const failed = results.find((r) => r.status === "rejected");
    if (failed) notify(errorText(failed.reason), true);
    else if (!found.length) {
      setOlderDone((list) => [...list, key]);
      notify("Non ci sono altri messaggi");
    }
    if (found.length) setByFolder((all) => ({ ...all, [olderKey(key)]: uniqueById([...(all[olderKey(key)] ?? []), ...found]).sort(byDateDesc) }));
  };

  const flagMany = (ms: Message[], flags: { seen?: boolean; flagged?: boolean }) => {
    const real = ms.filter((m) => !m.scheduled);
    const patch: Partial<Message> = {};
    if (flags.seen !== undefined) patch.unread = !flags.seen;
    if (flags.flagged !== undefined) patch.flagged = flags.flagged;
    real.forEach((m) => patchMessage(m.id, patch));
    api.setFlagsMany(real, flags).catch((e) => {
      real.forEach((m) => patchMessage(m.id, { unread: m.unread, flagged: m.flagged }));
      notify(errorText(e), true);
    });
  };

  const toggleStar = (m: Message) => {
    patchMessage(m.id, { flagged: !m.flagged });
    api.setFlags(m, { flagged: !m.flagged }).catch((e) => {
      patchMessage(m.id, { flagged: m.flagged });
      notify(errorText(e), true);
    });
  };

  const markUnread = (m: Message) => {
    patchMessage(m.id, { unread: true });
    api.setFlags(m, { seen: false }).catch((e) => notify(errorText(e), true));
  };

  const toggleRead = (m: Message) => {
    patchMessage(m.id, { unread: !m.unread });
    api.setFlags(m, { seen: m.unread }).catch((e) => {
      patchMessage(m.id, { unread: m.unread });
      notify(errorText(e), true);
    });
  };

  const compose = (draft: Partial<Draft> = {}) => {
    if (accounts.length === 0) return setModal({ kind: "account" });
    const accountId = draft.accountId ?? box?.accountId ?? (accountFilter !== "all" ? accountFilter : undefined);
    setModal({ kind: "compose", draft: { to: [], subject: "", body: "", inReplyTo: null, ...draft, accountId } });
  };

  const reply = (m: Message, all: boolean) => {
    const own = accountsById[m.accountId]?.email.toLowerCase();
    const others = all ? [...m.to, ...m.cc].map((c) => c.email).filter((e) => e.toLowerCase() !== own && e !== m.fromEmail) : [];
    compose({ accountId: m.accountId, to: replyTo(m), cc: others, subject: prefixed("Re:", m.subject), body: quote(m), inReplyTo: m.messageId, references: chainOf(m) });
  };

  /** Copia su disco gli allegati veri del messaggio; se non riesce avvisa e prosegue senza. */
  const filesOf = async (m: Message) => {
    const indexes = m.attachments.filter((f) => !f.inline).map((f) => f.index);
    if (!indexes.length || m.id.startsWith("local:")) return [];
    try {
      return await api.prepareAttachments(m, indexes);
    } catch (e) {
      notify(`Allegati non recuperati: ${errorText(e)}`, true);
      return [];
    }
  };

  const forward = async (m: Message) => {
    const attachments = await filesOf(m);
    compose({
      accountId: m.accountId,
      subject: prefixed("I:", m.subject),
      body: `\n\n---------- Messaggio inoltrato ----------\nDa: ${m.fromName} <${m.fromEmail}>\nData: ${longTime(m.date)}\nOggetto: ${m.subject}\n\n${m.body}`,
      attachments,
    });
  };

  /** Riapre una bozza: il salvataggio successivo sostituisce questa copia. */
  const resumeDraft = async (m: Message) => {
    const attachments = await filesOf(m);
    compose({
      accountId: m.accountId,
      to: m.to.map((c) => c.email),
      cc: m.cc.map((c) => c.email),
      subject: m.subject === "(nessun oggetto)" ? "" : m.subject,
      body: m.body,
      attachments,
      inReplyTo: m.inReplyTo,
      references: m.references,
      draftId: m.messageId,
    });
  };

  /** Chi riceve la risposta: il mittente, oppure i destinatari se il messaggio l'ho mandato io. */
  const replyTo = (m: Message) => (isMine(m) ? m.to.map((c) => c.email) : [m.fromEmail]);
  const isMine = (m: Message) => m.fromEmail.toLowerCase() === accountsById[m.accountId]?.email.toLowerCase();
  const chainOf = (m: Message) => [...m.references, ...(m.messageId ? [m.messageId] : [])];

  /** Copia locale di un messaggio appena inviato: compare subito nella conversazione. */
  const addSent = (o: Outgoing) => {
    const a = accountsById[o.accountId];
    if (!a || !o.messageId) return;
    const date = nowSec();
    const copy: Message = {
      id: `local:${o.messageId}`,
      accountId: a.id,
      folder: "sent",
      mailbox: "",
      uid: 0,
      messageId: o.messageId,
      inReplyTo: o.inReplyTo,
      references: o.references ?? [],
      fromName: a.displayName || a.name,
      fromEmail: a.email,
      to: o.to.map((email) => ({ name: email, email })),
      cc: o.cc.map((email) => ({ name: email, email })),
      subject: o.subject || "(nessun oggetto)",
      snippet: o.body.replace(/\s+/g, " ").slice(0, 180),
      body: o.body,
      date,
      unread: false,
      flagged: false,
      attachments: o.attachments.map((path, index) => {
        const name = path.split("/").pop() ?? path;
        return { index, name, size: 0, kind: (name.split(".").pop() ?? "FILE").slice(0, 4).toUpperCase(), mime: "", inline: false };
      }),
      hasHtml: false,
    };
    setByFolder((all) => ({ ...all, sent: [copy, ...(all.sent ?? [])] }));
  };

  const quickReply = async (m: Message, text: string) => {
    const a = accountsById[m.accountId];
    const outgoing: Outgoing = {
      accountId: m.accountId,
      to: replyTo(m),
      cc: [],
      bcc: [],
      subject: prefixed("Re:", m.subject),
      body: text + quote(m),
      html: null,
      attachments: [],
      inReplyTo: m.messageId,
      references: chainOf(m),
      messageId: newMessageId(a?.email),
    };
    try {
      await api.sendMessage(outgoing);
      addSent(outgoing);
      notify(`Risposta inviata a ${isMine(m) ? outgoing.to.join(", ") : m.fromName}`);
      return true;
    } catch (e) {
      notify(errorText(e), true);
      return false;
    }
  };

  const openAttachment = async (m: Message, index: number) => {
    try {
      const path = await api.openAttachment(m, index);
      if (inTauri) notify(`Salvato in ${path}`);
    } catch (e) {
      notify(errorText(e), true);
    }
  };

  const snooze = (m: Message, until: number) => {
    const i = visible.findIndex((x) => x.id === m.id);
    setSelectedId(visible[i + 1]?.id ?? visible[i - 1]?.id ?? null);
    setSnoozed({ ...snoozed, [keyOf(m)]: { until, accountId: m.accountId } });
    notify(`Posticipato: torna ${longTime(until).toLowerCase()}`);
  };

  const unsnooze = (m: Message) => {
    const rest = { ...snoozed };
    delete rest[keyOf(m)];
    setSnoozed(rest);
    notify("Messaggio riportato in arrivo");
  };

  /** Se tutti i messaggi hanno già l'etichetta la toglie, altrimenti la aggiunge a tutti. */
  const toggleLabelMany = (ms: Message[], id: string) => {
    const everywhere = ms.every((m) => labels.byMessage[keyOf(m)]?.includes(id));
    const byMessage = { ...labels.byMessage };
    for (const m of ms) {
      const k = keyOf(m);
      const others = (byMessage[k] ?? []).filter((x) => x !== id);
      const next = everywhere ? others : [...others, id];
      if (next.length) byMessage[k] = next;
      else delete byMessage[k];
    }
    setLabels({ ...labels, byMessage });
  };

  const createLabelMany = (ms: Message[], name: string) => {
    const label = { id: crypto.randomUUID(), name, color: nextLabelColor(labels.defs) };
    const byMessage = { ...labels.byMessage };
    for (const m of ms) byMessage[keyOf(m)] = [...(byMessage[keyOf(m)] ?? []), label.id];
    setLabels({ defs: [...labels.defs, label], byMessage });
  };

  /** Apre il link nel browser predefinito; se non ci riesce chiede con cosa aprirlo. */
  const openLink = async (url: string) => {
    try {
      await api.openLink(url);
    } catch {
      const browsers = await api.listBrowsers().catch(() => []);
      setModal({ kind: "link", url, browsers });
    }
  };

  const sendScheduled = async (sc: Scheduled) => {
    try {
      await api.sendScheduledNow(sc.id);
      notify(`Messaggio inviato: «${sc.outgoing.subject || "(senza oggetto)"}»`);
    } catch (e) {
      notify(errorText(e), true);
    }
    loadScheduled();
  };

  const cancelScheduled = async (sc: Scheduled) => {
    await api.cancelScheduled(sc.id).catch((e) => notify(errorText(e), true));
    loadScheduled();
    notify("Invio annullato");
  };

  // La bozza sostituisce il programmato solo quando viene inviata o riprogrammata.
  const editScheduled = (sc: Scheduled) => {
    const o = sc.outgoing;
    compose({ accountId: o.accountId, to: o.to, cc: o.cc, bcc: o.bcc, subject: o.subject, body: o.body, attachments: o.attachments, inReplyTo: o.inReplyTo, references: o.references, replaces: sc.id });
  };

  const draftDone = async (draft: Draft) => {
    setModal(null);
    if (draft.replaces) await api.cancelScheduled(draft.replaces).catch(() => {});
    loadScheduled();
  };

  // ---------- Account ----------

  const accountAdded = (a: Account) => {
    setAccounts((list) => [...list, a]);
    setModal(null);
    notify(`${a.email} aggiunto: sincronizzo la posta…`);
    loadFolder(folderOf(view));
    loadMailboxes([a]);
  };

  const accountChanged = (a: Account) => setAccounts((list) => list.map((x) => (x.id === a.id ? a : x)));

  const renameAccount = async (a: Account, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === a.name) return;
    accountChanged({ ...a, name: trimmed });
    try {
      accountChanged(await api.updateAccount({ id: a.id, name: trimmed }));
    } catch (e) {
      accountChanged(a);
      notify(errorText(e), true);
    }
  };

  const [resyncing, setResyncing] = useState<string[]>([]);
  /** Riscarica dal server tutte le cartelle già aperte, solo per questo account. */
  const resyncAccount = async (a: Account) => {
    if (resyncing.includes(a.id)) return;
    setResyncing((ids) => [...ids, a.id]);
    const folders = [...new Set(["inbox", ...Object.keys(byFolder).filter((k) => !isBoxKey(k))])] as Folder[];
    const boxes = (mailboxes[a.id] ?? []).map((mailbox) => ({ accountId: a.id, mailbox })).filter((b) => byFolder[boxKey(b)]);
    loadMailboxes([a]);
    const ok = (await Promise.all([...folders.map((f) => sync(f, a.id)), ...boxes.map((b) => syncBox(b, true))])).every(Boolean);
    setResyncing((ids) => ids.filter((id) => id !== a.id));
    if (ok) notify(`${a.name} risincronizzato`);
    else notify(`${a.name}: sincronizzazione non riuscita, dettagli sull'account nella barra laterale`, true);
  };

  const reorderAccounts = async (ids: string[]) => {
    const before = accounts;
    const pos = (a: Account) => ids.indexOf(a.id);
    setAccounts([...accounts].sort((a, b) => pos(a) - pos(b)));
    try {
      setAccounts(await api.reorderAccounts(ids));
    } catch (e) {
      setAccounts(before);
      notify(errorText(e), true);
    }
  };

  const accountRemoved = (id: string) => {
    setAccounts((list) => list.filter((a) => a.id !== id));
    setByFolder((all) => Object.fromEntries(Object.entries(all).map(([f, list]) => [f, list?.filter((m) => m.accountId !== id)])));
    if (accountFilter === id) setAccountFilter("all");
    if (box?.accountId === id) setBox(null);
    setMailboxes(({ [id]: _, ...rest }) => rest);
  };

  // ---------- Scorciatoie ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || menu) return;
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.ctrlKey && !typing && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoPending();
      } else if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.ctrlKey && !typing && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setChecked(visible.map((m) => m.id));
      } else if (e.key === "F5") {
        e.preventDefault();
        syncCurrent();
      } else if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        if (e.shiftKey && ["arrowdown", "arrowup", "j", "k"].includes(key)) {
          e.preventDefault();
          return extend(key === "arrowdown" || key === "j" ? 1 : -1);
        }
        const step = (d: number) => {
          const i = visible.findIndex((m) => m.id === selected?.id);
          const next = visible[Math.min(Math.max(i + d, 0), visible.length - 1)];
          if (next) pick(next, { ctrl: false, shift: false });
        };
        const actions: Record<string, () => void> = {
          c: () => compose(),
          j: () => step(1),
          k: () => step(-1),
          arrowdown: () => step(1),
          arrowup: () => step(-1),
        };
        if (bulk) {
          Object.assign(actions, {
            escape: () => setChecked([]),
            e: () => moveMany(bulk, "archive"),
            delete: () => (bulk.every((m) => m.folder === "trash") ? askDeleteForever(bulk) : moveMany(bulk, "trash")),
            s: () => flagMany(bulk, { flagged: !bulk.every((m) => m.flagged) }),
            u: () => flagMany(bulk, { seen: false }),
          });
        } else if (selected?.scheduled) {
          const sc = selected.scheduled;
          Object.assign(actions, { delete: () => cancelScheduled(sc) });
        } else if (selected) {
          Object.assign(actions, {
            b: () => selected.folder === "inbox" && setMenu("snooze"),
            l: () => setMenu("label"),
            r: () => reply(selected, false),
            a: () => reply(selected, true),
            f: () => forward(selected),
            e: () => moveMany([selected], "archive"),
            delete: () => trash(selected),
            s: () => toggleStar(selected),
            u: () => !selected.unread && markUnread(selected),
          });
        }
        const run = actions[key];
        if (run) {
          e.preventDefault();
          run();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- Testi ----------

  const errorCount = Object.keys(errors).length;
  const syncLabel = syncing
    ? `Sincronizzo ${plural(accounts.length, "account", "account")}…`
    : errorCount
      ? `${plural(errorCount, "account", "account")} con errori`
      : relativeSync(lastSync);

  const title = box ? box.mailbox.name : VIEWS.find((v) => v.id === view)!.label;
  const activeLabel = labels.defs.find((l) => l.id === labelFilter);
  const scope = box
    ? `${accountsById[box.accountId]?.name} · ${box.mailbox.label}`
    : (accountFilter === "all" ? "Tutti gli account" : `${accountsById[accountFilter]?.name} · ${accountsById[accountFilter]?.email}`) +
    (activeLabel ? ` · ${activeLabel.name}` : "");
  const unread = visible.filter((m) => m.unread).length;
  const tally =
    view === "scheduled"
      ? plural(visible.length, "in coda", "in coda")
      : view === "snoozed"
        ? plural(visible.length, "posticipato", "posticipati")
        : plural(unread, "non letto", "non letti");
  const subtitle = q ? `${plural(visible.length, "risultato", "risultati")} per «${query.trim()}»` : `${scope} · ${tally}`;

  const empty =
    loaded && accounts.length === 0
      ? { title: "Nessun account", text: "Aggiungi una casella Google, Microsoft o IMAP per iniziare.", action: { label: "Aggiungi account", run: () => setModal({ kind: "account" }) } }
      : q
        ? searching
          ? { title: serverQuery?.busy ? "Cerco sul server…" : "Nessun risultato", text: serverQuery?.busy ? "Guardo in tutte le cartelle di ogni account." : "Neanche sul server c’è un messaggio con queste parole." }
          : { title: "Nessun risultato", text: "Tra i messaggi scaricati non c’è. Premi Invio per cercare su tutta la posta del server.", action: { label: "Cerca sul server", run: searchOnServer } }
        : syncing && !byFolder[listKey]
          ? { title: "Sincronizzo…", text: "Scarico i messaggi dai server." }
          : view === "snoozed"
            ? { title: "Niente in attesa", text: "Con Posticipa (B) un messaggio sparisce da Posta in arrivo e torna all’ora che scegli." }
            : view === "scheduled"
              ? { title: "Nessun invio in coda", text: "Nella finestra Scrivi usa l’orologio accanto a Invia per programmare un messaggio." }
              : activeLabel
                ? { title: "Nessun messaggio", text: `Nessun messaggio con l’etichetta «${activeLabel.name}» in questa cartella.` }
                : { title: "Tutto in ordine", text: "Non ci sono messaggi qui." };

  return (
    <div className="app">
      <TitleBar
        accountCount={accounts.length}
        query={query}
        onQuery={setQuery}
        onSearchServer={searchOnServer}
        searchRef={searchRef}
        syncing={syncing > 0}
        syncLabel={syncLabel}
        syncError={errorCount > 0 && !syncing}
        onSync={syncCurrent}
      />
      <div className="panes">
        <Sidebar
          accounts={accounts}
          view={view}
          onView={(v) => {
            changeView(v);
            setAccountFilter("all");
          }}
          accountFilter={accountFilter}
          onOpenFolder={(accountId, folder) => {
            changeView(folder as View);
            setAccountFilter(accountId);
          }}
          counts={counts}
          unreadByAccount={unreadByAccount}
          errors={errors}
          mailboxes={mailboxes}
          box={box}
          onOpenBox={openBox}
          boxUnread={(b) => byFolder[boxKey(b)]?.filter((m) => m.unread).length ?? 0}
          resyncing={resyncing}
          onRenameAccount={renameAccount}
          onResyncAccount={resyncAccount}
          onReorderAccounts={reorderAccounts}
          labels={labels.defs}
          labelCounts={labelCounts}
          labelFilter={labelFilter}
          onLabelFilter={(id) => {
            setLabelFilter(id);
            setSelectedId(null);
          }}
          onCompose={() => compose()}
          onAddAccount={() => setModal({ kind: "account" })}
          onSettings={() => setModal({ kind: "settings", section: "look" })}
        />
        <MessageList
          title={title}
          subtitle={subtitle}
          chip={chip}
          onChip={setChip}
          messages={visible}
          accounts={accountsById}
          selectedId={selected?.id ?? null}
          onSelect={pick}
          checkedIds={bulk ? bulk.map((m) => m.id) : []}
          onCheck={checkRow}
          onCheckAll={checkAll}
          onToggleRead={toggleRead}
          onArchive={(m) => moveMany([m], "archive")}
          onDelete={(m) => (m.scheduled ? cancelScheduled(m.scheduled) : trash(m))}
          labelsOf={labelsOf}
          wakeOf={(m) => m.scheduled?.at ?? snoozeOf(m)}
          threadSize={(m) => (m.scheduled ? 1 : threads.size(m))}
          empty={empty}
          serverSearch={
            !q || visible.length === 0
              ? null
              : searching
                ? { label: serverQuery?.busy ? "Cerco su tutta la posta del server…" : "Risultati dal server", busy: !!serverQuery?.busy, run: null }
                : { label: "Cerca su tutta la posta del server (Invio)", busy: false, run: searchOnServer }
          }
          older={canLoadOlder && !olderDone.includes(listKey) ? { busy: olderBusy, run: loadOlder } : null}
          onEmptyTrash={!box && view === "trash" ? askEmptyTrash : null}
        />
        <Reader
          message={selected}
          account={selected ? accountsById[selected.accountId] : undefined}
          onArchive={(m) => moveMany([m], "archive")}
          onDelete={trash}
          onToggleStar={toggleStar}
          onToggleRead={toggleRead}
          onReply={reply}
          onForward={forward}
          onResumeDraft={resumeDraft}
          onQuickReply={quickReply}
          bulk={bulk}
          onBulkMove={(to) => {
            if (!bulk) return;
            if (to === "trash" && bulk.every((m) => m.folder === "trash")) askDeleteForever(bulk);
            else moveMany(bulk, to);
          }}
          onBulkFlags={(flags) => bulk && flagMany(bulk, flags)}
          onBulkClear={() => setChecked([])}
          bulkBoxes={bulkBoxes}
          bulkMixed={!!bulk && !bulkAccount}
          onBulkMoveBox={(target) => bulk && moveToBox(bulk, target)}
          bulkLabelIds={bulk ? labels.defs.filter((l) => bulk.every((m) => labels.byMessage[keyOf(m)]?.includes(l.id))).map((l) => l.id) : []}
          onBulkToggleLabel={(id) => bulk && toggleLabelMany(bulk, id)}
          onBulkCreateLabel={(name) => bulk && createLabelMany(bulk, name)}
          thread={selected ? threads.of(selected) : []}
          trustedSenders={trusted}
          onTrustSender={(email) => setTrusted([...new Set([...trusted, email.toLowerCase()])])}
          onPreview={(m, index) => setModal({ kind: "preview", message: m, index })}
          onLink={openLink}
          onMailto={(address) => compose({ to: [address] })}
          remoteImages={prefs.remoteImages}
          menu={menu}
          onMenu={setMenu}
          labels={labels.defs}
          messageLabels={selected ? labelsOf(selected) : []}
          onToggleLabel={(m, id) => toggleLabelMany([m], id)}
          onCreateLabel={(m, name) => createLabelMany([m], name)}
          snoozedUntil={selected ? snoozeOf(selected) : undefined}
          onSnooze={snooze}
          onUnsnooze={unsnooze}
          onSendScheduled={sendScheduled}
          onEditScheduled={editScheduled}
          onCancelScheduled={cancelScheduled}
        />
      </div>

      {modal?.kind === "compose" && (
        <Compose
          accounts={accounts}
          draft={modal.draft}
          onClose={() => setModal(null)}
          onSent={(a, outgoing) => {
            addSent(outgoing);
            draftDone(modal.draft);
            notify(`Messaggio inviato da ${a.name}`);
          }}
          onScheduled={(a, at) => {
            draftDone(modal.draft);
            notify(`Programmato: parte ${longTime(at).toLowerCase()} da ${a.name}`);
          }}
          onDraftsChanged={(savedNow) => {
            if (savedNow) notify("Bozza salvata in Bozze");
            sync("drafts");
          }}
          contacts={contacts}
        />
      )}
      {modal?.kind === "preview" && (
        <Preview
          message={modal.message}
          files={modal.message.attachments.filter((f) => !f.inline)}
          index={modal.index}
          onIndex={(index) => setModal({ ...modal, index })}
          onOpenExternal={(index) => openAttachment(modal.message, index)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "confirm" && <Confirm title={modal.title} text={modal.text} action={modal.action} onConfirm={modal.run} onClose={() => setModal(null)} />}
      {modal?.kind === "link" && <LinkChooser url={modal.url} browsers={modal.browsers} onClose={() => setModal(null)} />}
      {modal?.kind === "account" && <AddAccount onClose={() => setModal(null)} onAdded={accountAdded} />}
      {modal?.kind === "settings" && (
        <Settings
          section={modal.section}
          accounts={accounts}
          prefs={prefs}
          onPrefs={setPrefs}
          onAccountChanged={accountChanged}
          onAccountRemoved={accountRemoved}
          onAddAccount={() => setModal({ kind: "account" })}
          trayAvailable={trayAvailable}
          labels={labels}
          onLabels={setLabels}
          onClearCache={async () => {
            await api.clearCache();
            setByFolder({});
            knownIds.current = null;
            await loadFolder(folderOf(view));
          }}
          onClose={() => setModal(null)}
        />
      )}

      {toast && (
        <div className={toast.error ? "toast error" : "toast"} role={toast.error ? "alert" : "status"}>
          <Icon name={toast.error ? "alert" : "check"} size={16} stroke={2} />
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" className="link-btn toast-undo" onClick={toast.undo}>
              Annulla
            </button>
          )}
          <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Chiudi avviso" onClick={() => setToast(null)}>
            <Icon name="close" size={12} stroke={2} />
          </button>
        </div>
      )}
    </div>
  );
}
