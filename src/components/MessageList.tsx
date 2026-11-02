import { groupLabel, initials, monoOf, shortTime } from "../format";
import { Icon } from "../icons";
import type { Label } from "../store";
import type { Account, Message } from "../types";
import { LabelChips } from "./Pickers";

export type Chip = "all" | "unread" | "attach";

const CHIPS: { id: Chip; label: string }[] = [
  { id: "all", label: "Tutti" },
  { id: "unread", label: "Non letti" },
  { id: "attach", label: "Con allegati" },
];

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
}

export function MessageList({ title, subtitle, chip, onChip, messages, accounts, selectedId, onSelect, checkedIds, onCheck, onCheckAll, onToggleRead, onArchive, onDelete, labelsOf, wakeOf, threadSize, empty }: Props) {
  const groups: { label: string; items: Message[] }[] = [];
  for (const m of messages) {
    const label = groupLabel(m.date);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(m);
    else groups.push({ label, items: [m] });
  }

  const selecting = checkedIds.length > 0;
  const allChecked = selecting && checkedIds.length === messages.length;

  return (
    <section aria-label="Elenco messaggi" className={selecting ? "list selecting" : "list"}>
      <div className="list-head">
        <div className="list-title-row">
          <div>
            <h1 className="list-title">{title}</h1>
            <span className="list-sub">{selecting ? `${checkedIds.length} di ${messages.length} selezionati` : subtitle}</span>
          </div>
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
                    {m.folder !== "trash" && (
                      <button type="button" className="icon-btn" aria-label={m.scheduled ? "Annulla invio" : "Sposta nel cestino"} title={m.scheduled ? "Annulla invio" : "Sposta nel cestino"} onClick={() => onDelete(m)}>
                        <Icon name="trash" size={15} stroke={1.8} />
                      </button>
                    )}
                  </div>
                )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
