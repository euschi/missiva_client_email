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
  onSelect: (m: Message) => void;
  labelsOf: (m: Message) => Label[];
  /** Ora di riapparizione (posticipati) o di invio (programmati). */
  wakeOf: (m: Message) => number | undefined;
  /** Messaggi nella conversazione di `m`. */
  threadSize: (m: Message) => number;
  empty: { title: string; text: string; action?: { label: string; run: () => void } };
}

export function MessageList({ title, subtitle, chip, onChip, messages, accounts, selectedId, onSelect, labelsOf, wakeOf, threadSize, empty }: Props) {
  const groups: { label: string; items: Message[] }[] = [];
  for (const m of messages) {
    const label = groupLabel(m.date);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(m);
    else groups.push({ label, items: [m] });
  }

  return (
    <section aria-label="Elenco messaggi" className="list">
      <div className="list-head">
        <div className="list-title-row">
          <div>
            <h1 className="list-title">{title}</h1>
            <span className="list-sub">{subtitle}</span>
          </div>
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
              return (
                <button
                  key={m.id}
                  type="button"
                  className={m.unread ? "row unread" : "row"}
                  aria-current={m.id === selectedId}
                  onClick={() => onSelect(m)}
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
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
