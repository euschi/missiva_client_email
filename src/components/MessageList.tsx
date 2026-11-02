import { useEffect, useRef, useState, type PointerEvent } from "react";
import { groupLabel, initials, monoOf, shortTime } from "../format";
import { Icon, type IconName } from "../icons";
import type { Label } from "../store";
import type { Account, Message } from "../types";
import { LabelChips } from "./Pickers";

export type Chip = "all" | "unread" | "attach";

const CHIPS: { id: Chip; label: string }[] = [
  { id: "all", label: "Tutti" },
  { id: "unread", label: "Non letti" },
  { id: "attach", label: "Con allegati" },
];

/** Voce del menu col tasto destro. */
export interface RowMenuItem {
  label: string;
  icon: IconName;
  run: () => void;
  /** Linea di separazione prima della voce. */
  gap?: boolean;
}

/** Dove è stato lasciato un messaggio trascinato. */
export interface DropTarget {
  /** Account della cartella; senza è una vista unificata. */
  accountId: string | null;
  folder: "inbox" | "archive" | "trash" | null;
  path: string | null;
}

/** Soglia in pixel oltre la quale una pressione sulla riga diventa un trascinamento. */
const DRAG_THRESHOLD = 6;
const DROP_SELECTOR = "[data-drop-folder], [data-drop-path]";

const deleteLabel = (m: Message) => (m.scheduled ? "Annulla invio" : m.folder === "trash" ? "Elimina definitivamente" : "Sposta nel cestino");

interface Props {
  title: string;
  subtitle: string;
  chip: Chip;
  onChip: (c: Chip) => void;
  messages: Message[];
  accounts: Record<string, Account>;
  selectedId: string | null;
  /** Clic su una riga, con Ctrl (aggiungi/togli) o Maiusc (intervallo). */
  onSelect: (m: Message, mods: { ctrl: boolean; shift: boolean }) => void;
  /** Messaggi della selezione multipla (vuoto se ce n'è uno solo). */
  checkedIds: string[];
  /** Casella di una riga: con `shift` seleziona l'intervallo dall'ultima spuntata. */
  onCheck: (m: Message, shift: boolean) => void;
  /** Seleziona tutto l'elenco, o niente se è già tutto selezionato. */
  onCheckAll: () => void;
  onToggleRead: (m: Message) => void;
  onArchive: (m: Message) => void;
  onDelete: (m: Message) => void;
  labelsOf: (m: Message) => Label[];
  /** Ora di riapparizione (posticipati) o di invio (programmati). */
  wakeOf: (m: Message) => number | undefined;
  /** Messaggi nella conversazione di `m`. */
  threadSize: (m: Message) => number;
  empty: { title: string; text: string; action?: { label: string; run: () => void } };
  /** Con una ricerca in corso: invito a cercare anche sul server. */
  serverSearch: { label: string; busy: boolean; run: (() => void) | null } | null;
  /** «Carica messaggi più vecchi» in fondo all'elenco. */
  older: { busy: boolean; run: () => void } | null;
  /** «Svuota il cestino», solo nel Cestino. */
  onEmptyTrash: (() => void) | null;
  rowMenu: (m: Message) => RowMenuItem[];
  /** Quanti messaggi muove il trascinamento di `m`: la selezione, se ne fa parte. */
  dragCount: (m: Message) => number;
  onDrop: (m: Message, target: DropTarget) => void;
}

export function MessageList({ title, subtitle, chip, onChip, messages, accounts, selectedId, onSelect, checkedIds, onCheck, onCheckAll, onToggleRead, onArchive, onDelete, labelsOf, wakeOf, threadSize, empty, serverSearch, older, onEmptyTrash, rowMenu, dragCount, onDrop }: Props) {
  const groups: { label: string; items: Message[] }[] = [];
  for (const m of messages) {
    const label = groupLabel(m.date);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(m);
    else groups.push({ label, items: [m] });
  }

  const [menu, setMenu] = useState<{ items: RowMenuItem[]; x: number; y: number } | null>(null);
  const press = useRef<{ m: Message; x: number; y: number; dragging: boolean } | null>(null);
  const hoverEl = useRef<Element | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; count: number } | null>(null);

  const setHover = (el: Element | null) => {
    if (hoverEl.current === el) return;
    hoverEl.current?.classList.remove("drop-hover");
    el?.classList.add("drop-hover");
    hoverEl.current = el;
  };
  const onDragMove = (e: PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
      p.dragging = true;
      // La cattura arriva solo ora: un semplice clic deve restare un clic sulla riga.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setGhost({ x: e.clientX, y: e.clientY, count: dragCount(p.m) });
    setHover(document.elementFromPoint(e.clientX, e.clientY)?.closest(DROP_SELECTOR) ?? null);
  };
  const endDrag = (drop: boolean) => {
    const p = press.current;
    const el = hoverEl.current as HTMLElement | null;
    press.current = null;
    setHover(null);
    setGhost(null);
    if (drop && p?.dragging && el) {
      const { dropAccount, dropFolder, dropPath } = el.dataset;
      onDrop(p.m, { accountId: dropAccount ?? null, folder: (dropFolder as DropTarget["folder"]) ?? null, path: dropPath ?? null });
    }
  };

  const selecting = checkedIds.length > 0;
  const allChecked = selecting && checkedIds.length === messages.length;

  return (
    <section aria-label="Elenco messaggi" className={selecting ? "list selecting" : "list"} onPointerMove={onDragMove} onPointerUp={() => endDrag(true)} onPointerCancel={() => endDrag(false)}>
      <div className="list-head">
        <div className="list-title-row">
          <div>
            <h1 className="list-title">{title}</h1>
            <span className="list-sub">{selecting ? `${checkedIds.length} di ${messages.length} selezionati` : subtitle}</span>
          </div>
          {onEmptyTrash && messages.length > 0 && !selecting && (
            <button type="button" className="check-all" onClick={onEmptyTrash}>
              Svuota
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              role="checkbox"
              className="check-all"
              aria-checked={allChecked ? true : selecting ? "mixed" : false}
              title={allChecked ? "Deseleziona tutti" : "Seleziona tutti"}
              onClick={onCheckAll}
            >
              <span className="check-box">{allChecked ? <Icon name="check" size={12} stroke={3} /> : selecting && <i />}</span>
              Tutti
            </button>
          )}
        </div>
        <div role="tablist" aria-label="Filtro" className="chips">
          {CHIPS.map((c) => (
            <button key={c.id} type="button" role="tab" className="chip" aria-selected={chip === c.id} onClick={() => onChip(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="list-scroll scroll">
        {serverSearch && (
          <button type="button" className="list-more top" disabled={!serverSearch.run} onClick={() => serverSearch.run?.()}>
            <Icon name={serverSearch.busy ? "sync" : "search"} size={14} stroke={2} className={serverSearch.busy ? "spin" : undefined} />
            {serverSearch.label}
          </button>
        )}
        {messages.length === 0 && (
          <div className="empty">
            <h2>{empty.title}</h2>
            <p>{empty.text}</p>
            {empty.action && (
              <button type="button" className="btn btn-primary btn-sm" onClick={empty.action.run}>
                {empty.action.label}
              </button>
            )}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} className="group">
            <div className="group-label eyebrow">{g.label}</div>
            {g.items.map((m) => {
              const a = accounts[m.accountId];
              const wake = wakeOf(m);
              const isChecked = checkedIds.includes(m.id);
              // Le copie locali appena inviate non esistono ancora sul server.
              const local = m.id.startsWith("local:");
              return (
                <div key={m.id} className="row-wrap">
                <button
                  type="button"
                  className={["row", m.unread && "unread", isChecked && "checked"].filter(Boolean).join(" ")}
                  aria-current={m.id === selectedId}
                  // Maiusc + clic non deve selezionare il testo delle righe.
                  onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                  onClick={(e) => onSelect(m, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
                  onPointerDown={(e) => {
                    if (e.button === 0 && !e.ctrlKey && !e.shiftKey && !m.scheduled && !local) press.current = { m, x: e.clientX, y: e.clientY, dragging: false };
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ items: rowMenu(m), x: e.clientX, y: e.clientY });
                  }}
                >
                  <span className="avatar-wrap">
                    <span className="avatar">{initials(m.fromName)}</span>
                    {a && (
                      <span className="acct-badge" title={a.name} style={{ background: a.color }}>
                        {monoOf(a.name)}
                      </span>
                    )}
                  </span>
                  <span className="row-main">
                    <span className="row-top">
                      {m.unread && <span className="unread-dot" aria-label="Non letto" />}
                      <span className="row-from">{m.fromName}</span>
                      {threadSize(m) > 1 && <span className="row-thread" aria-label={`${threadSize(m)} messaggi nella conversazione`}>{threadSize(m)}</span>}
                      {m.flagged && <Icon name="star" size={12} fill="currentColor" label="Contrassegnato" />}
                      {m.attachments.length > 0 && <Icon name="clip" size={13} stroke={2} label="Allegato" />}
                      <span className="row-time">{shortTime(m.date)}</span>
                    </span>
                    <span className="row-subject">{m.subject}</span>
                    {m.snippet && <span className="row-snippet">{m.snippet}</span>}
                    {(wake || labelsOf(m).length > 0) && (
                      <span className="row-extra">
                        {wake && (
                          <span className={m.scheduled?.error ? "wake error" : "wake"}>
                            <Icon name={m.scheduled?.error ? "alert" : "clock"} size={12} stroke={2} />
                            {m.scheduled?.error ? "Invio non riuscito" : shortTime(wake)}
                          </span>
                        )}
                        <LabelChips labels={labelsOf(m)} small />
                      </span>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  role="checkbox"
                  className="row-check"
                  aria-checked={isChecked}
                  aria-label={`Seleziona il messaggio di ${m.fromName}: ${m.subject}`}
                  title="Seleziona"
                  // Maiusc + clic non deve selezionare il testo delle righe.
                  onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                  onClick={(e) => onCheck(m, e.shiftKey)}
                >
                  <span className="check-box">{isChecked && <Icon name="check" size={12} stroke={3} />}</span>
                </button>
                {!local && (
                  <div className="row-actions" role="group" aria-label="Azioni rapide">
                    {!m.scheduled && (
                      <button type="button" className="icon-btn" aria-label={m.unread ? "Segna come letto" : "Segna come da leggere"} title={m.unread ? "Segna come letto" : "Segna come da leggere"} onClick={() => onToggleRead(m)}>
                        <Icon name={m.unread ? "mail" : "markUnread"} size={15} stroke={1.8} />
                      </button>
                    )}
                    {!m.scheduled && m.folder !== "archive" && (
                      <button type="button" className="icon-btn" aria-label="Archivia" title="Archivia" onClick={() => onArchive(m)}>
                        <Icon name="archive" size={15} stroke={1.8} />
                      </button>
                    )}
                    <button type="button" className="icon-btn" aria-label={deleteLabel(m)} title={deleteLabel(m)} onClick={() => onDelete(m)}>
                      <Icon name="trash" size={15} stroke={1.8} />
                    </button>
                  </div>
                )}
                </div>
              );
            })}
          </div>
        ))}
        {older && messages.length > 0 && (
          <button type="button" className="list-more" disabled={older.busy} onClick={older.run}>
            {older.busy && <Icon name="sync" size={14} stroke={2} className="spin" />}
            {older.busy ? "Scarico…" : "Carica messaggi più vecchi"}
          </button>
        )}
      </div>
      {menu && <RowMenu {...menu} onClose={() => setMenu(null)} />}
      {ghost && (
        <div className="drag-ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>
          {ghost.count === 1 ? "1 messaggio" : `${ghost.count} messaggi`}
        </div>
      )}
    </section>
  );
}

/** Menu col tasto destro, dentro la finestra anche vicino ai bordi. */
function RowMenu({ items, x, y, onClose }: { items: RowMenuItem[]; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
      el.querySelector<HTMLElement>("button")?.focus();
    }
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [x, y, onClose]);
  return (
    <div ref={ref} role="menu" aria-label="Azioni sul messaggio" className="popover row-menu" style={pos}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.gap ? "pop-item gap" : "pop-item"}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <span className="label-name">
            <Icon name={item.icon} size={15} stroke={1.8} />
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}
