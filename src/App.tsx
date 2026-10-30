import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, errorText, inTauri } from "./api";
import { AddAccount } from "./components/AddAccount";
import { Compose } from "./components/Compose";
import { MessageList, type Chip } from "./components/MessageList";
import { Reader } from "./components/Reader";
import { Settings, type Section } from "./components/Settings";
import { Sidebar, VIEWS, type View } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { longTime, plural, relativeSync } from "./format";
import { Icon } from "./icons";
import { notifyNewMail } from "./notify";
import { applyPrefs, loadPrefs, savePrefs, type Prefs } from "./prefs";
import type { Account, Draft, Folder, Message } from "./types";

type ModalState =
  | { kind: "compose"; draft: Draft }
  | { kind: "account" }
  | { kind: "settings"; section: Section };

const SYNC_EVERY_MS = 5 * 60_000;

const folderOf = (v: View): Folder => (v === "flagged" ? "inbox" : v);
const byDateDesc = (a: Message, b: Message) => b.date - a.date;
const prefixed = (prefix: string, s: string) => (s.toLowerCase().startsWith(prefix.toLowerCase()) ? s : `${prefix} ${s}`);
const quote = (m: Message) => `\n\nIl ${longTime(m.date)}, ${m.fromName} <${m.fromEmail}> ha scritto:\n` + m.body.split("\n").map((l) => `> ${l}`).join("\n");

export function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [byFolder, setByFolder] = useState<Partial<Record<Folder, Message[]>>>({});
  const [view, setView] = useState<View>("inbox");
  const [accountFilter, setAccountFilter] = useState("all");
  const [chip, setChip] = useState<Chip>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(0);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<ModalState | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [, setTick] = useState(0);
  const [trayAvailable, setTrayAvailable] = useState(false);
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
    const t = setTimeout(() => setToast(null), toast.error ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const patchMessage = (id: string, patch: Partial<Message>) =>
    setByFolder((all) => Object.fromEntries(Object.entries(all).map(([f, list]) => [f, list?.map((m) => (m.id === id ? { ...m, ...patch } : m))])));
  const dropMessage = (id: string) =>
    setByFolder((all) => Object.fromEntries(Object.entries(all).map(([f, list]) => [f, list?.filter((m) => m.id !== id)])));

  const sync = useCallback(async (folder: Folder) => {
    setSyncing((n) => n + 1);
    try {
      const report = await api.syncFolder(folder);
      if (folder === "inbox") {
        const known = knownIds.current;
        const fresh = known ? report.messages.filter((m) => m.unread && !known.has(m.id)) : [];
        knownIds.current = new Set([...(known ?? []), ...report.messages.map((m) => m.id)]);
        if (fresh.length && prefsRef.current.notify) notifyNewMail(fresh, prefsRef.current.notifyPreview);
      }
      setByFolder((all) => ({ ...all, [folder]: report.messages.sort(byDateDesc) }));
      setErrors(Object.fromEntries(report.errors.map((e) => [e.accountId, e.message])));
      setLastSync(new Date());
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setSyncing((n) => n - 1);
    }
  }, [notify]);

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
      else await loadFolder("inbox");
    })();
  }, [loadFolder, notify]);

  useEffect(() => {
    if (accounts.length === 0) return;
    const folder = folderOf(view);
    const t = setInterval(() => {
      sync(folder);
      if (folder !== "inbox") sync("inbox");
    }, SYNC_EVERY_MS);
    const clock = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, [view, accounts.length, sync]);

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

  const changeView = (v: View) => {
    setView(v);
    setSelectedId(null);
    const folder = folderOf(v);
    if (folder !== "inbox" || !byFolder.inbox) loadFolder(folder);
  };

  // Elenco visibile: cartella, account, filtro rapido e ricerca.
  const inbox = byFolder.inbox ?? [];
  const q = query.trim().toLowerCase();
  const visible = (byFolder[folderOf(view)] ?? []).filter(
    (m) =>
      accountsById[m.accountId] &&
      (accountFilter === "all" || m.accountId === accountFilter) &&
      (view !== "flagged" || m.flagged) &&
      (chip !== "unread" || m.unread) &&
      (chip !== "attach" || m.attachments.length > 0) &&
      (!q || [m.fromName, m.fromEmail, m.subject, m.body].some((s) => s.toLowerCase().includes(q))),
  );
  const selected = visible.find((m) => m.id === selectedId) ?? visible[0] ?? null;

  const unreadByAccount = Object.fromEntries(accounts.map((a) => [a.id, inbox.filter((m) => m.unread && m.accountId === a.id).length]));
  const inFilter = (m: Message) => accountFilter === "all" || m.accountId === accountFilter;
  const totalUnread = inbox.filter((m) => m.unread && accountsById[m.accountId]).length;
  useEffect(() => {
    api.setTrayUnread(totalUnread).catch(() => {});
  }, [totalUnread]);

  const counts = {
    inbox: inbox.filter((m) => m.unread && inFilter(m)).length,
    flagged: inbox.filter((m) => m.flagged && inFilter(m)).length,
    drafts: (byFolder.drafts ?? []).filter(inFilter).length,
  };

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

  const move = (m: Message, to: Folder) => {
    const i = visible.findIndex((x) => x.id === m.id);
    setSelectedId(visible[i + 1]?.id ?? visible[i - 1]?.id ?? null);
    dropMessage(m.id);
    api
      .moveMessage(m, to)
      .then(() => notify(to === "archive" ? "Messaggio archiviato" : "Messaggio spostato nel cestino"))
      .catch((e) => {
        notify(errorText(e), true);
        sync(m.folder);
      });
  };

  const compose = (draft: Partial<Draft> = {}) => {
    if (accounts.length === 0) return setModal({ kind: "account" });
    const accountId = draft.accountId ?? (accountFilter !== "all" ? accountFilter : undefined);
    setModal({ kind: "compose", draft: { to: [], subject: "", body: "", inReplyTo: null, ...draft, accountId } });
  };

  const reply = (m: Message, all: boolean) => {
    const own = accountsById[m.accountId]?.email.toLowerCase();
    const others = all ? [...m.to, ...m.cc].map((c) => c.email).filter((e) => e.toLowerCase() !== own && e !== m.fromEmail) : [];
    compose({ accountId: m.accountId, to: [m.fromEmail], cc: others, subject: prefixed("Re:", m.subject), body: quote(m), inReplyTo: m.messageId });
  };

  const forward = (m: Message) =>
    compose({
      accountId: m.accountId,
      subject: prefixed("I:", m.subject),
      body: `\n\n---------- Messaggio inoltrato ----------\nDa: ${m.fromName} <${m.fromEmail}>\nData: ${longTime(m.date)}\nOggetto: ${m.subject}\n\n${m.body}`,
    });

  const quickReply = async (m: Message, text: string) => {
    try {
      await api.sendMessage({ accountId: m.accountId, to: [m.fromEmail], cc: [], bcc: [], subject: prefixed("Re:", m.subject), body: text + quote(m), attachments: [], inReplyTo: m.messageId });
      notify(`Risposta inviata a ${m.fromName}`);
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

  // ---------- Account ----------

  const accountAdded = (a: Account) => {
    setAccounts((list) => [...list, a]);
    setModal(null);
    notify(`${a.email} aggiunto: sincronizzo la posta…`);
    loadFolder(folderOf(view));
  };

  const accountChanged = (a: Account) => setAccounts((list) => list.map((x) => (x.id === a.id ? a : x)));

  const accountRemoved = (id: string) => {
    setAccounts((list) => list.filter((a) => a.id !== id));
    setByFolder((all) => Object.fromEntries(Object.entries(all).map(([f, list]) => [f, list?.filter((m) => m.accountId !== id)])));
    if (accountFilter === id) setAccountFilter("all");
  };

  // ---------- Scorciatoie ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal) return;
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "F5") {
        e.preventDefault();
        sync(folderOf(view));
      } else if (!typing && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const step = (d: number) => {
          const i = visible.findIndex((m) => m.id === selected?.id);
          const next = visible[Math.min(Math.max(i + d, 0), visible.length - 1)];
          if (next) select(next);
        };
        const actions: Record<string, () => void> = {
          c: () => compose(),
          j: () => step(1),
          k: () => step(-1),
        };
        if (selected) {
          Object.assign(actions, {
            r: () => reply(selected, false),
            a: () => reply(selected, true),
            f: () => forward(selected),
            e: () => selected.folder !== "archive" && move(selected, "archive"),
            delete: () => selected.folder !== "trash" && move(selected, "trash"),
            s: () => toggleStar(selected),
            u: () => !selected.unread && markUnread(selected),
          });
        }
        const run = actions[e.key.toLowerCase()];
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

  const title = VIEWS.find((v) => v.id === view)!.label;
  const scope = accountFilter === "all" ? "Tutti gli account" : `${accountsById[accountFilter]?.name} · ${accountsById[accountFilter]?.email}`;
  const unread = visible.filter((m) => m.unread).length;
  const subtitle = q ? `${plural(visible.length, "risultato", "risultati")} per «${query.trim()}»` : `${scope} · ${plural(unread, "non letto", "non letti")}`;

  const empty =
    loaded && accounts.length === 0
      ? { title: "Nessun account", text: "Aggiungi una casella Google, Microsoft o IMAP per iniziare.", action: { label: "Aggiungi account", run: () => setModal({ kind: "account" }) } }
      : q
        ? { title: "Nessun risultato", text: "Prova con un altro nome, oggetto o parola del testo." }
        : syncing && !byFolder[folderOf(view)]
          ? { title: "Sincronizzo…", text: "Scarico i messaggi dai server." }
          : { title: "Tutto in ordine", text: "Non ci sono messaggi qui." };

  return (
    <div className="app">
      <TitleBar
        accountCount={accounts.length}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        syncing={syncing > 0}
        syncLabel={syncLabel}
        syncError={errorCount > 0 && !syncing}
        onSync={() => sync(folderOf(view))}
      />
      <div className="panes">
        <Sidebar
          accounts={accounts}
          view={view}
          onView={changeView}
          accountFilter={accountFilter}
          onAccountFilter={(id) => {
            setAccountFilter(id);
            setSelectedId(null);
          }}
          counts={counts}
          unreadByAccount={unreadByAccount}
          errors={errors}
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
          onSelect={select}
          empty={empty}
        />
        <Reader
          message={selected}
          account={selected ? accountsById[selected.accountId] : undefined}
          onArchive={(m) => move(m, "archive")}
          onDelete={(m) => move(m, "trash")}
          onToggleStar={toggleStar}
          onMarkUnread={markUnread}
          onReply={reply}
          onForward={forward}
          onQuickReply={quickReply}
          onOpenAttachment={openAttachment}
        />
      </div>

      {modal?.kind === "compose" && (
        <Compose
          accounts={accounts}
          draft={modal.draft}
          onClose={() => setModal(null)}
          onSent={(a) => {
            setModal(null);
            notify(`Messaggio inviato da ${a.name}`);
          }}
        />
      )}
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
          <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Chiudi avviso" onClick={() => setToast(null)}>
            <Icon name="close" size={12} stroke={2} />
          </button>
        </div>
      )}
    </div>
  );
}
