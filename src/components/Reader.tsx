import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { fileSize, initials, longTime, monoOf, paragraphs, plural, providerLabel } from "../format";
import { Icon } from "../icons";
import type { Label } from "../store";
import type { Account, HtmlView, Message, Scheduled } from "../types";
import { MailFrame } from "./MailFrame";
import { LabelChips, LabelPicker, Popover, WhenPicker } from "./Pickers";
import { isImage, Thumb } from "./Preview";

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
  /** Apre il visore sull'allegato `index`. */
  onPreview: (m: Message, index: number) => void;
  onMailto: (address: string) => void;
  /** Preferenza: carica subito immagini e stili remoti. */
  remoteImages: boolean;
  /** Conversazione del messaggio aperto, dal più vecchio (vuota se non calcolata). */
  thread: Message[];
  /** Mittenti di cui mostrare sempre le immagini remote. */
  trustedSenders: string[];
  onTrustSender: (email: string) => void;
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

/** HTML già convertito per messaggio: riaprire un messaggio non lo rilegge dal disco. */
const htmlCache = new Map<string, HtmlView | null>();

/** HTML del messaggio: `undefined` finché carica, `null` se c'è solo il testo. */
function useHtml(m: Message): HtmlView | null | undefined {
  const wanted = m.hasHtml && !m.scheduled;
  const [html, setHtml] = useState<HtmlView | null | undefined>(() => (wanted ? htmlCache.get(m.id) : null));
  useEffect(() => {
    if (!wanted) return setHtml(null);
    if (htmlCache.has(m.id)) return setHtml(htmlCache.get(m.id));
    setHtml(undefined);
    let gone = false;
    api
      .messageHtml(m)
      .then((v) => (htmlCache.set(m.id, v), v))
      // Se l'HTML non arriva (offline, messaggio sparito) resta il testo.
      .catch(() => null)
      .then((v) => !gone && setHtml(v));
    return () => {
      gone = true;
    };
    // Solo il cambio di messaggio conta: segnarlo come letto crea un oggetto nuovo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, wanted]);
  return html;
}

function Letter(p: Props & { message: Message }) {
  const { message: m, account: a, onQuickReply, messageLabels, snoozedUntil, onUnsnooze } = p;
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const thread = p.thread.length ? p.thread : [m];
  const mine = (x: Message) => !!a && x.fromEmail.toLowerCase() === a.email.toLowerCase();
  // La risposta rapida va in fondo alla conversazione: risponde all'ultimo messaggio degli altri.
  const last = thread[thread.length - 1];
  const target = [...thread].reverse().find((x) => !mine(x)) ?? last;
  const first = mine(target) ? (target.to[0]?.name ?? "") : target.fromName.split(" ")[0];

  // Aperti: quello scelto, l'ultimo e i non letti; il resto si apre con un clic.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (x: Message) => toggled[x.id] ?? (x.id === m.id || x === last || x.unread);
  const allOpen = thread.every(isOpen);

  // Nelle conversazioni lunghe porta in vista il messaggio scelto.
  const selectedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thread.length > 1 && m !== last) selectedRef.current?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id]);

  const send = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    if (await onQuickReply(target, reply.trim())) setReply("");
    setSending(false);
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
          <h2 className="reader-subject">{thread[0].subject.replace(/^((re|r|fwd?|i)\s*:\s*)+/i, "") || m.subject}</h2>
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
          {thread.length > 1 && (
            <div className="thread-bar">
              <span>{plural(thread.length, "messaggio", "messaggi")} nella conversazione</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => setToggled(Object.fromEntries(thread.map((x) => [x.id, !allOpen])))}
              >
                {allOpen ? "Comprimi" : "Espandi tutto"}
              </button>
            </div>
          )}
        </div>

        <div className="thread">
          {thread.map((x) => (
            <div key={x.id} ref={x.id === m.id ? selectedRef : undefined}>
              <ThreadMessage
                {...p}
                message={x}
                mine={mine(x)}
                open={isOpen(x)}
                collapsible={thread.length > 1}
                onToggle={() => setToggled((t) => ({ ...t, [x.id]: !isOpen(x) }))}
              />
            </div>
          ))}
        </div>
      </div>

      {m.folder !== "drafts" && !m.scheduled && (
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

interface ThreadMessageProps extends Props {
  message: Message;
  mine: boolean;
  open: boolean;
  collapsible: boolean;
  onToggle: () => void;
}

/** Un messaggio della conversazione: compatto (mittente e anteprima) oppure completo. */
function ThreadMessage({ message: m, account: a, mine, open, collapsible, onToggle, onPreview, onMailto, remoteImages, trustedSenders, onTrustSender }: ThreadMessageProps) {
  const html = useHtml(m);
  const sender = m.fromEmail.toLowerCase();
  const [showOnce, setShowOnce] = useState(false);
  const showRemote = remoteImages || showOnce || trustedSenders.includes(sender);

  const files = m.attachments.filter((f) => !(f.inline && html));
  const recipients = [...m.to, ...m.cc].map((c) => (a && c.email.toLowerCase() === a.email.toLowerCase() ? "te" : c.name));
  const toLine = recipients.length ? `a ${recipients.slice(0, 3).join(", ")}${recipients.length > 3 ? ` e altri ${recipients.length - 3}` : ""}` : "";
  const name = mine ? "Tu" : m.fromName;

  if (!open) {
    return (
      <button type="button" className="thread-collapsed" onClick={onToggle} aria-expanded={false}>
        <span className="avatar sm">{initials(m.fromName)}</span>
        <span className="thread-who">{name}</span>
        <span className="thread-snippet">{m.snippet}</span>
        <span className="mono paper-muted">{longTime(m.date)}</span>
      </button>
    );
  }

  return (
    <section className={collapsible ? "thread-message boxed" : "thread-message"} aria-label={`Messaggio di ${name}`}>
      <div className={collapsible ? "sender clickable" : "sender"} onClick={collapsible ? onToggle : undefined}>
        <span className="avatar">{initials(m.fromName)}</span>
        <div className="sender-main">
          <div className="sender-line">
            <span className="sender-name">{name}</span>
            {m.fromEmail !== m.fromName && <span className="mono paper-muted">{m.fromEmail}</span>}
            {m.id.startsWith("local:") && <span className="sent-badge">Inviato ora</span>}
          </div>
          {toLine && <span className="paper-muted" style={{ fontSize: 13 }}>{toLine}</span>}
        </div>
        <span className="mono paper-muted">{longTime(m.date)}</span>
      </div>

      {html && html.remote && !showRemote && (
        <div className="remote-note">
          <Icon name="shield" size={15} stroke={1.9} />
          <span>Immagini remote bloccate per proteggere la privacy.</span>
          <button type="button" className="link-btn" onClick={() => setShowOnce(true)}>
            Mostra
          </button>
          <button type="button" className="link-btn" onClick={() => onTrustSender(sender)}>
            Mostra sempre da {m.fromEmail}
          </button>
        </div>
      )}

      {html ? (
        <MailFrame html={html.html} remote={showRemote} onMailto={onMailto} />
      ) : (
        <div className={html === undefined ? "body-text loading" : "body-text"}>
          {paragraphs(m.body).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
          {!m.body.trim() && <p className="paper-muted">(Messaggio senza testo)</p>}
        </div>
      )}

      {files.length > 0 && (
        <div className="attachments">
          <span className="eyebrow">{plural(files.length, "allegato", "allegati")}</span>
          <div className="attach-grid">
            {files.map((f) => (
              <button
                key={f.index}
                type="button"
                className="attach"
                disabled={!!m.scheduled || m.id.startsWith("local:")}
                onClick={() => onPreview(m, f.index)}
                title={m.scheduled ? f.name : `Anteprima di ${f.name}`}
              >
                {!m.scheduled && isImage(f) ? <Thumb message={m} file={f} /> : <span className="file-tile">{f.kind}</span>}
                <span className="attach-meta">
                  <span className="attach-name">{f.name}</span>
                  <span className="mono paper-muted" style={{ fontSize: 11.5 }}>
                    {m.scheduled ? "File locale" : fileSize(f.size)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
