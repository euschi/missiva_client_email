import { useRef, useState, type PointerEvent } from "react";
import { monoOf, providerLabel } from "../format";
import { Icon, type IconName } from "../icons";
import type { Label } from "../store";
import { Popover } from "./Pickers";
import type { Account, Folder, Mailbox, OpenBox } from "../types";

export type View = "inbox" | "flagged" | "snoozed" | "scheduled" | "drafts" | "sent" | "archive" | "trash";

export const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: "inbox", label: "Posta in arrivo", icon: "inbox" },
  { id: "flagged", label: "Contrassegnati", icon: "star" },
  { id: "snoozed", label: "Posticipati", icon: "clock" },
  { id: "scheduled", label: "Programmati", icon: "calendar" },
  { id: "drafts", label: "Bozze", icon: "draft" },
  { id: "sent", label: "Inviati", icon: "send" },
  { id: "archive", label: "Archivio", icon: "archive" },
  { id: "trash", label: "Cestino", icon: "trash" },
];

interface Props {
  accounts: Account[];
  view: View;
  /** Vista unificata su tutti gli account. */
  onView: (v: View) => void;
  accountFilter: string;
  /** Cartella speciale di un solo account (posta in arrivo, inviati…). */
  onOpenFolder: (accountId: string, folder: Folder) => void;
  counts: Partial<Record<View, number>>;
  unreadByAccount: Record<string, number>;
  errors: Record<string, string>;
  mailboxes: Record<string, Mailbox[]>;
  box: OpenBox | null;
  onOpenBox: (b: OpenBox) => void;
  boxUnread: (b: OpenBox) => number;
  resyncing: string[];
  onRenameAccount: (a: Account, name: string) => void;
  onResyncAccount: (a: Account) => void;
  onReorderAccounts: (ids: string[]) => void;
  labels: Label[];
  labelCounts: Record<string, number>;
  labelFilter: string | null;
  onLabelFilter: (id: string | null) => void;
  onCompose: () => void;
  onAddAccount: () => void;
  onSettings: () => void;
}

const show = (n: number | undefined) => (n ? String(n) : "");

/** Rami chiusi della barra laterale, ricordati tra un avvio e l'altro. */
function useClosed() {
  const KEY = "missiva.sidebar.closed";
  const [closed, setClosed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const toggle = (id: string) =>
    setClosed((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Senza storage vale solo per questa sessione.
      }
      return next;
    });
  return { isOpen: (id: string) => !closed.includes(id), toggle };
}
type Branches = ReturnType<typeof useClosed>;

function Chevron({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className="tree-toggle" aria-expanded={open} aria-label={open ? `Chiudi ${label}` : `Apri ${label}`} onClick={onToggle}>
      <Icon name="chevron" size={13} stroke={2.2} className={open ? undefined : "rot-270"} />
    </button>
  );
}

export function Sidebar(p: Props) {
  const branches = useClosed();
  const totalUnread = Object.values(p.unreadByAccount).reduce((a, b) => a + b, 0);
  const allOpen = branches.isOpen("all");
  const allLabel = p.accounts.length > 1 ? "Tutti gli account" : "Viste rapide";
  return (
    <nav aria-label="Caselle e account" className="sidebar scroll">
      <button type="button" className="btn btn-primary compose-btn" onClick={p.onCompose} disabled={p.accounts.length === 0}>
        <span>
          <Icon name="pen" size={17} stroke={2} />
          Scrivi
        </span>
        <kbd>C</kbd>
      </button>

      <div className="accounts">
        <div className="section-head">
          <span className="eyebrow">Account</span>
          <button type="button" className="icon-btn" aria-label="Aggiungi account" onClick={p.onAddAccount}>
            <Icon name="plus" size={15} stroke={2} />
          </button>
        </div>

        {p.accounts.length > 0 && (
          <div className="tree-root">
            <div className="acct-head">
              <Chevron open={allOpen} label={allLabel} onToggle={() => branches.toggle("all")} />
              <button
                type="button"
                className="acct-row all"
                aria-current={!p.box && p.accountFilter === "all" && p.view === "inbox"}
                onClick={() => p.onView("inbox")}
              >
                <span className="stack" aria-hidden="true">
                  {p.accounts.slice(0, 3).map((a) => (
                    <span key={a.id} style={{ background: a.color }} />
                  ))}
                </span>
                <span className="meta">
                  <span className="name">{allLabel}</span>
                </span>
                <span className="count">{show(totalUnread)}</span>
              </button>
            </div>
            {allOpen && (
              <div className="tree-children">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="nav-item tree-item"
                    aria-current={!p.box && p.accountFilter === "all" && p.view === v.id}
                    onClick={() => p.onView(v.id)}
                  >
                    <Icon name={v.icon} size={16} stroke={1.7} />
                    <span className="label">{v.label}</span>
                    <span className="count">{show(p.counts[v.id])}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <AccountList {...p} branches={branches} />
      </div>

      {p.labels.length > 0 && (
        <div className="accounts">
          <div className="section-head">
            <span className="eyebrow">Etichette</span>
          </div>
          {p.labels.map((l) => (
            <button
              key={l.id}
              type="button"
              className="nav-item"
              aria-pressed={p.labelFilter === l.id}
              aria-current={p.labelFilter === l.id}
              onClick={() => p.onLabelFilter(p.labelFilter === l.id ? null : l.id)}
            >
              <i className="label-dot lg" style={{ background: l.color }} />
              <span className="label">{l.name}</span>
              <span className="count">{show(p.labelCounts[l.id])}</span>
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-foot">
        <button type="button" className="nav-item" onClick={p.onAddAccount}>
          <Icon name="plus" size={17} stroke={1.7} />
          Aggiungi account
        </button>
        <button type="button" className="nav-item" onClick={p.onSettings}>
          <Icon name="sliders" size={17} stroke={1.7} />
          Impostazioni
        </button>
      </div>
    </nav>
  );
}

/** Soglia in pixel oltre la quale una pressione sull'account diventa un trascinamento. */
const DRAG_THRESHOLD = 5;

/** Account con menu rapido (⋯ o tasto destro), rinomina in linea e riordino per trascinamento. */
function AccountList(p: Props & { branches: Branches }) {
  const listRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: string; y: number; dragging: boolean } | null>(null);
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ids = p.accounts.map((a) => a.id);

  const move = (id: string, to: number) => {
    const from = ids.indexOf(id);
    const rest = ids.filter((x) => x !== id);
    rest.splice(to > from ? to - 1 : to, 0, id);
    if (rest.some((x, i) => x !== ids[i])) p.onReorderAccounts(rest);
  };

  /** Posizione d'inserimento (0…n) sotto il puntatore. */
  const dropIndex = (y: number) => {
    // Conta la riga dell'account, non tutto il suo albero di cartelle.
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-account] > .acct-head") ?? [])];
    const i = items.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? items.length : i;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>("[data-account]");
    if (e.button !== 0 || !item || renaming || !(e.target as HTMLElement).closest(".acct-head .acct-row")) return;
    press.current = { id: item.dataset.account!, y: e.clientY, dragging: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const pr = press.current;
    if (!pr) return;
    if (!pr.dragging) {
      if (Math.abs(e.clientY - pr.y) < DRAG_THRESHOLD) return;
      pr.dragging = true;
      // La cattura arriva solo ora: un semplice clic deve restare un clic sul pulsante.
      e.currentTarget.setPointerCapture(e.pointerId);
      setMenuFor(null);
    }
    setDrag({ id: pr.id, to: dropIndex(e.clientY) });
  };
  const onPointerUp = () => {
    if (press.current?.dragging && drag) move(drag.id, drag.to);
    press.current = null;
    setDrag(null);
  };

  const from = drag ? ids.indexOf(drag.id) : -1;
  const showDrop = drag && drag.to !== from && drag.to !== from + 1;

  return (
    <div
      ref={listRef}
      className={drag ? "acct-list dragging" : "acct-list"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => ((press.current = null), setDrag(null))}
    >
      {p.accounts.map((a, i) => {
        const error = p.errors[a.id];
        const busy = p.resyncing.includes(a.id);
        const close = () => setMenuFor(null);
        const open = p.branches.isOpen(a.id);
        const classes = [
          "acct-item",
          drag?.id === a.id && "lifted",
          menuFor === a.id && "menu-open",
          showDrop && drag.to === i && "drop-before",
          showDrop && drag.to === p.accounts.length && i === p.accounts.length - 1 && "drop-after",
        ].filter(Boolean);
        return (
          <div key={a.id} data-account={a.id} className={classes.join(" ")}>
            <div className="acct-head">
            <Chevron open={open} label={a.name} onToggle={() => p.branches.toggle(a.id)} />
            {renaming === a.id ? (
              <RenameRow
                account={a}
                onDone={(name) => {
                  setRenaming(null);
                  if (name !== null) p.onRenameAccount(a, name);
                }}
              />
            ) : (
              <button
                type="button"
                className={error ? "acct-row error" : "acct-row"}
                aria-current={!p.box && p.accountFilter === a.id && p.view === "inbox"}
                onClick={() => p.onOpenFolder(a.id, "inbox")}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuFor(a.id);
                }}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    if (e.key === "ArrowUp" && i > 0) move(a.id, i - 1);
                    if (e.key === "ArrowDown" && i < ids.length - 1) move(a.id, i + 2);
                  } else if (e.key === "F2") {
                    e.preventDefault();
                    setRenaming(a.id);
                  }
                }}
                title={error ? `Errore di sincronizzazione: ${error}` : a.email}
              >
                <span className="mono-tile" style={{ background: a.color }}>
                  {monoOf(a.name)}
                </span>
                <span className="meta">
                  <span className="name">{a.name}</span>
                  <span className="sub">
                    {busy ? "Risincronizzo…" : error ? "Errore di sincronizzazione" : providerLabel(a.provider, a.imap.host)}
                  </span>
                </span>
                {busy ? <Icon name="sync" size={14} stroke={2} className="spin count" /> : <span className="count">{show(p.unreadByAccount[a.id])}</span>}
              </button>
            )}
            {renaming !== a.id && (
              <button
                type="button"
                className="icon-btn acct-more"
                aria-label={`Azioni per ${a.name}`}
                aria-haspopup="menu"
                aria-expanded={menuFor === a.id}
                onClick={() => setMenuFor(menuFor === a.id ? null : a.id)}
              >
                <Icon name="more" size={16} stroke={2.6} />
              </button>
            )}
            {menuFor === a.id && (
              <Popover label={`Azioni per ${a.name}`} onClose={close} placement={["end"]}>
                <button type="button" className="pop-item" onClick={() => (close(), setRenaming(a.id))}>
                  <span>Rinomina</span>
                  <span className="pop-hint">F2</span>
                </button>
                <button type="button" className="pop-item" disabled={busy} onClick={() => (close(), p.onResyncAccount(a))}>
                  <span>Risincronizza</span>
                  <Icon name="sync" size={15} stroke={1.8} />
                </button>
                {p.accounts.length > 1 && (
                  <>
                    <button type="button" className="pop-item" disabled={i === 0} onClick={() => (close(), move(a.id, i - 1))}>
                      <span>Sposta su</span>
                      <span className="pop-hint">Alt ↑</span>
                    </button>
                    <button type="button" className="pop-item" disabled={i === ids.length - 1} onClick={() => (close(), move(a.id, i + 2))}>
                      <span>Sposta giù</span>
                      <span className="pop-hint">Alt ↓</span>
                    </button>
                  </>
                )}
              </Popover>
            )}
            </div>
            {open && <FolderTree {...p} account={a} />}
          </div>
        );
      })}
    </div>
  );
}

function RenameRow({ account, onDone }: { account: Account; onDone: (name: string | null) => void }) {
  const [name, setName] = useState(account.name);
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <form className="acct-row renaming" onSubmit={(e) => (e.preventDefault(), finish(name))}>
      <span className="mono-tile" style={{ background: account.color }}>
        {monoOf(name || account.name)}
      </span>
      <label className="sr-only" htmlFor={`rename-${account.id}`}>Nome dell'account</label>
      <input
        id={`rename-${account.id}`}
        autoFocus
        value={name}
        maxLength={40}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => finish(name)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            finish(null);
          }
        }}
      />
    </form>
  );
}

/** Le cartelle speciali vengono prima, in quest'ordine; poi le altre in ordine alfabetico. */
const SPECIAL_ORDER: Folder[] = ["inbox", "drafts", "sent", "archive", "trash"];
const SPECIAL_VIEW = Object.fromEntries(VIEWS.map((v) => [v.id, v]));

interface FolderNode {
  box: Mailbox;
  children: FolderNode[];
}

/** Albero delle cartelle a partire dai percorsi IMAP: il genitore è la cartella più lunga che li precede. */
function buildTree(list: Mailbox[]): FolderNode[] {
  const nodes = list.map((box) => ({ box, children: [] as FolderNode[] }));
  const roots: FolderNode[] = [];
  for (const n of nodes) {
    const parent = nodes
      .filter((o) => o !== n && n.box.path.startsWith(o.box.path + o.box.delimiter))
      .sort((a, b) => b.box.path.length - a.box.path.length)[0];
    (parent ? parent.children : roots).push(n);
  }
  const rank = (n: FolderNode) => (n.box.special ? SPECIAL_ORDER.indexOf(n.box.special) : SPECIAL_ORDER.length);
  const sort = (level: FolderNode[]) => {
    level.sort((a, b) => rank(a) - rank(b) || a.box.name.localeCompare(b.box.name, "it", { sensitivity: "base" }));
    level.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

/** Cartelle del server di un account: speciali e personali insieme, con le sottocartelle. */
function FolderTree(p: Props & { branches: Branches; account: Account }) {
  const a = p.account;
  const list = p.mailboxes[a.id];
  if (!list) return <span className="tree-note">Carico le cartelle…</span>;
  if (list.length === 0) return <span className="tree-note">Nessuna cartella</span>;

  const render = (nodes: FolderNode[], depth: number) =>
    nodes.map((n) => {
      const m = n.box;
      const id = `${a.id}:${m.path}`;
      const open = p.branches.isOpen(id);
      const special = m.special ? SPECIAL_VIEW[m.special] : undefined;
      const b = { accountId: a.id, mailbox: m };
      const current = m.special
        ? !p.box && p.accountFilter === a.id && p.view === m.special
        : p.box?.accountId === a.id && p.box.mailbox.path === m.path;
      const unread = m.special === "inbox" ? p.unreadByAccount[a.id] : m.special ? 0 : p.boxUnread(b);
      const select = () => {
        if (!m.selectable) p.branches.toggle(id);
        else if (m.special) p.onOpenFolder(a.id, m.special);
        else p.onOpenBox(b);
      };
      return (
        <div key={m.path} className="tree-node">
          <div className="tree-line" style={{ paddingLeft: depth * 14 }}>
            {n.children.length > 0 ? <Chevron open={open} label={m.name} onToggle={() => p.branches.toggle(id)} /> : <span className="tree-toggle" />}
            <button type="button" className={m.selectable ? "nav-item tree-item" : "nav-item tree-item container"} aria-current={current} title={m.label} onClick={select}>
              <Icon name={special?.icon ?? "folder"} size={16} stroke={1.7} />
              <span className="label">{special?.label ?? m.name}</span>
              <span className="count">{show(unread)}</span>
            </button>
          </div>
          {open && n.children.length > 0 && render(n.children, depth + 1)}
        </div>
      );
    });

  return <div className="tree-children">{render(buildTree(list), 0)}</div>;
}
