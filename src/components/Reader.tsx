import { useState } from "react";
import { fileSize, initials, longTime, monoOf, paragraphs, plural, providerLabel } from "../format";
import { Icon } from "../icons";
import type { Label } from "../store";
import type { Account, Message, Scheduled } from "../types";
import { LabelChips, LabelPicker, Popover, WhenPicker } from "./Pickers";

export type ReaderMenu = "snooze" | "label" | null;

interface Props {
  message: Message | null;
  account: Account | undefined;
  onArchive: (m: Message) => void;
  onDelete: (m: Message) => void;
  onToggleStar: (m: Message) => void;
  onMarkUnread: (m: Message) => void;
  onReply: (m: Message, all: boolean) => void;
  onForward: (m: Message) => void;
  onQuickReply: (m: Message, text: string) => Promise<boolean>;
  onOpenAttachment: (m: Message, index: number) => Promise<void>;
  menu: ReaderMenu;
  onMenu: (menu: ReaderMenu) => void;
  labels: Label[];
  messageLabels: Label[];
  onToggleLabel: (m: Message, id: string) => void;
  onCreateLabel: (m: Message, name: string) => void;
  snoozedUntil: number | undefined;
  onSnooze: (m: Message, at: number) => void;
  onUnsnooze: (m: Message) => void;
  onSendScheduled: (s: Scheduled) => void;
  onEditScheduled: (s: Scheduled) => void;
  onCancelScheduled: (s: Scheduled) => void;
}

export function Reader(p: Props) {
  const m = p.message;
  const canMove = m && m.folder !== "trash";
  const toggle = (menu: ReaderMenu) => p.onMenu(p.menu === menu ? null : menu);
  const close = () => p.onMenu(null);
  return (
    <main className="reader">
      {m?.scheduled ? (
        <ScheduledBar s={m.scheduled} {...p} />
      ) : (
        <div className="reader-bar">
          <div className="toolbar-group">
            <button type="button" className="icon-btn lg" aria-label="Archivia" title="Archivia" disabled={!m || m.folder === "archive"} onClick={() => m && p.onArchive(m)}>
              <Icon name="archive" size={17} stroke={1.7} />
            </button>
            <button type="button" className="icon-btn lg" aria-label="Sposta nel cestino" title="Sposta nel cestino" disabled={!canMove} onClick={() => m && p.onDelete(m)}>
              <Icon name="trash" size={17} stroke={1.7} />
            </button>
            <button type="button" className="icon-btn lg" aria-label="Segna come non letto" title="Segna come non letto" disabled={!m || m.unread} onClick={() => m && p.onMarkUnread(m)}>
              <Icon name="markUnread" size={17} stroke={1.7} />
            </button>
            <span className="divider" />
            <button
              type="button"
              className={m?.flagged ? "icon-btn lg starred" : "icon-btn lg"}
              aria-label={m?.flagged ? "Togli contrassegno" : "Contrassegna"}
              aria-pressed={!!m?.flagged}
              disabled={!m}
              onClick={() => m && p.onToggleStar(m)}
            >
              <Icon name="star" size={17} stroke={1.7} fill={m?.flagged ? "currentColor" : "none"} />
            </button>
            <span className="pop-anchor">
              <button
                type="button"
                className={p.snoozedUntil ? "icon-btn lg starred" : "icon-btn lg"}
                aria-label="Posticipa"
                title="Posticipa (B)"
                aria-expanded={p.menu === "snooze"}
                disabled={!m || m.folder !== "inbox"}
                onClick={() => toggle("snooze")}
              >
                <Icon name="clock" size={17} stroke={1.7} />
              </button>
              {m && p.menu === "snooze" && (
                <Popover label="Posticipa" onClose={close}>
                  <WhenPicker
                    title="Torna in arrivo"
                    onPick={(at) => {
                      close();
                      p.onSnooze(m, at);
                    }}
                  />
                </Popover>
              )}
            </span>
            <span className="pop-anchor">
              <button type="button" className="icon-btn lg" aria-label="Etichetta" title="Etichetta (L)" aria-expanded={p.menu === "label"} disabled={!m} onClick={() => toggle("label")}>
                <Icon name="tag" size={17} stroke={1.7} />
              </button>
              {m && p.menu === "label" && (
                <Popover label="Etichetta" onClose={close}>
                  <LabelPicker
                    labels={p.labels}
                    selected={p.messageLabels.map((l) => l.id)}
                    onToggle={(id) => p.onToggleLabel(m, id)}
                    onCreate={(name) => p.onCreateLabel(m, name)}
                  />
                </Popover>
              )}
            </span>
          </div>
          <div className="toolbar-group end">
            <button type="button" className="btn btn-soft btn-sm" disabled={!m} onClick={() => m && p.onReply(m, false)}>
              <Icon name="reply" size={15} />
              Rispondi
            </button>
            <button type="button" className="icon-btn" aria-label="Rispondi a tutti" title="Rispondi a tutti" disabled={!m} onClick={() => m && p.onReply(m, true)}>
              <Icon name="replyAll" size={16} stroke={1.7} />
            </button>
            <button type="button" className="icon-btn" aria-label="Inoltra" title="Inoltra" disabled={!m} onClick={() => m && p.onForward(m)}>
              <Icon name="forward" size={16} stroke={1.7} />
            </button>
          </div>
        </div>
      )}

      <article className="paper scroll" key={m?.id}>
        {m ? <Letter {...p} message={m} /> : (
          <div className="empty">
            <h2>Nessun messaggio aperto</h2>
            <p>Scegli un messaggio dall’elenco per leggerlo qui.</p>
          </div>
        )}
      </article>
    </main>
  );
}

function ScheduledBar({ s, account, onSendScheduled, onEditScheduled, onCancelScheduled }: Props & { s: Scheduled }) {
  return (
    <div className="reader-bar">
      <div className="toolbar-group">
        <span className={s.error ? "bar-note error" : "bar-note"}>
          <Icon name={s.error ? "alert" : "calendar"} size={15} stroke={1.9} />
          {s.error ? `Invio non riuscito: ${s.error}` : `Parte ${longTime(s.at).toLowerCase()}${account ? ` da ${account.name}` : ""}`}
        </span>
      </div>
      <div className="toolbar-group end">
        <button type="button" className="btn btn-soft btn-sm" onClick={() => onCancelScheduled(s)}>
          <Icon name="trash" size={14} />
          Annulla invio
        </button>
        <button type="button" className="btn btn-soft btn-sm" onClick={() => onEditScheduled(s)}>
          <Icon name="pen" size={14} />
          Modifica
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onSendScheduled(s)}>
          <Icon name="send" size={14} />
          {s.error ? "Riprova" : "Invia ora"}
        </button>
      </div>
    </div>
  );
}

function Letter({ message: m, account: a, onQuickReply, onOpenAttachment, messageLabels, snoozedUntil, onUnsnooze }: Props & { message: Message }) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);
  const recipients = [...m.to, ...m.cc].map((c) => (a && c.email.toLowerCase() === a.email.toLowerCase() ? "te" : c.name));
  const toLine = recipients.length ? `a ${recipients.slice(0, 3).join(", ")}${recipients.length > 3 ? ` e altri ${recipients.length - 3}` : ""}` : "";
  const first = m.fromName.split(" ")[0];

  const send = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    if (await onQuickReply(m, reply.trim())) setReply("");
    setSending(false);
  };

  const open = async (index: number) => {
    setOpening(index);
    await onOpenAttachment(m, index);
    setOpening(null);
  };

  return (
    <>
      <div className="paper-inner">
        <div>
          {a && (
            <span className="recv-chip">
              <span className="tile" style={{ background: a.color }}>{monoOf(a.name)}</span>
              {m.scheduled ? `Invio da ${a.name} · ${providerLabel(a.provider, a.smtp.host)}` : `Ricevuto su ${a.name} · ${providerLabel(a.provider, a.imap.host)}`}
            </span>
          )}
          <h2 className="reader-subject">{m.subject}</h2>
          <LabelChips labels={messageLabels} />
          {snoozedUntil && (
            <div className="snooze-note">
              <Icon name="clock" size={14} stroke={2} />
              Posticipato: torna in arrivo {longTime(snoozedUntil).toLowerCase()}
              <button type="button" className="link-btn" onClick={() => onUnsnooze(m)}>
                Riporta ora
              </button>
            </div>
          )}
        </div>

        <div className="sender">
          <span className="avatar">{initials(m.fromName)}</span>
          <div className="sender-main">
            <div className="sender-line">
              <span className="sender-name">{m.fromName}</span>
              {m.fromEmail !== m.fromName && <span className="mono paper-muted">{m.fromEmail}</span>}
            </div>
            {toLine && <span className="paper-muted" style={{ fontSize: 13 }}>{toLine}</span>}
          </div>
          <span className="mono paper-muted">{longTime(m.date)}</span>
        </div>

        <div className="body-text">
          {paragraphs(m.body).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
          {!m.body.trim() && <p className="paper-muted">(Messaggio senza testo)</p>}
        </div>

        {m.attachments.length > 0 && (
          <div className="attachments">
            <span className="eyebrow">{plural(m.attachments.length, "allegato", "allegati")}</span>
            <div className="attach-grid">
              {m.attachments.map((f) => (
                <button key={f.index} type="button" className="attach" disabled={opening !== null || !!m.scheduled} onClick={() => open(f.index)} title={m.scheduled ? f.name : "Salva in Scaricati e apri"}>
                  <span className="file-tile">{f.kind}</span>
                  <span className="attach-meta">
                    <span className="attach-name">{f.name}</span>
                    <span className="mono paper-muted" style={{ fontSize: 11.5 }}>
                      {opening === f.index ? "Scarico…" : m.scheduled ? "File locale" : fileSize(f.size)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {m.folder !== "sent" && m.folder !== "drafts" && (
        <form className="quick-reply" onSubmit={(e) => (e.preventDefault(), send())}>
          <div className="quick-reply-box">
            <label style={{ flex: 1, minWidth: 0, display: "flex" }}>
              <span className="sr-only">Risposta rapida</span>
              <input type="text" placeholder={`Rispondi a ${first}…`} value={reply} onChange={(e) => setReply(e.target.value)} disabled={sending} />
            </label>
            {a && (
              <span className="via">
                <i style={{ background: a.color }} />
                da {a.name}
              </span>
            )}
            <button type="submit" className="send-mini" aria-label="Invia risposta" disabled={!reply.trim() || sending}>
              <Icon name="send" size={16} stroke={1.9} className={sending ? "spin" : undefined} />
            </button>
          </div>
        </form>
      )}
    </>
  );
}
