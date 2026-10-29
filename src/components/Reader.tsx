import { useState } from "react";
import { fileSize, initials, longTime, monoOf, paragraphs, plural, providerLabel } from "../format";
import { Icon } from "../icons";
import type { Account, Message } from "../types";

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
}

export function Reader(p: Props) {
  const m = p.message;
  const canMove = m && m.folder !== "trash";
  return (
    <main className="reader">
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

function Letter({ message: m, account: a, onQuickReply, onOpenAttachment }: Props & { message: Message }) {
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
              Ricevuto su {a.name} · {providerLabel(a.provider, a.imap.host)}
            </span>
          )}
          <h2 className="reader-subject">{m.subject}</h2>
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
                <button key={f.index} type="button" className="attach" disabled={opening !== null} onClick={() => open(f.index)} title="Salva in Scaricati e apri">
                  <span className="file-tile">{f.kind}</span>
                  <span className="attach-meta">
                    <span className="attach-name">{f.name}</span>
                    <span className="mono paper-muted" style={{ fontSize: 11.5 }}>
                      {opening === f.index ? "Scarico…" : fileSize(f.size)}
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
