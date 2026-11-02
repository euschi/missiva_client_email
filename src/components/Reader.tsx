import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { fileSize, initials, longTime, monoOf, paragraphs, plural, providerLabel } from "../format";
import { Icon } from "../icons";
import type { Label } from "../store";
import type { Account, Attachment, Folder, HtmlView, Invite, Mailbox, Message, Scheduled, Unsubscribe } from "../types";
import { MailFrame } from "./MailFrame";
import { LabelChips, LabelPicker, Popover, WhenPicker } from "./Pickers";
import { isImage, Thumb } from "./Preview";

export type ReaderMenu = "snooze" | "label" | "move" | "more" | null;

interface Props {
  message: Message | null;
  account: Account | undefined;
  onArchive: (m: Message) => void;
  onDelete: (m: Message) => void;
  onToggleStar: (m: Message) => void;
  onToggleRead: (m: Message) => void;
  onReply: (m: Message, all: boolean) => void;
  onForward: (m: Message) => void;
  /** Riapre una bozza nella finestra Scrivi. */
  onResumeDraft: (m: Message) => void;
  onQuickReply: (m: Message, text: string) => Promise<boolean>;
  /** Apre il visore sull'allegato `index`. */
  onPreview: (m: Message, index: number) => void;
  /** Clic su un link http(s) nel testo del messaggio, con il testo che mostrava. */
  onLink: (url: string, text: string) => void;
  /** Clic su un link mailto:, intero. */
  onMailto: (href: string) => void;
  onSpam: (m: Message) => void;
  onBulkSpam: () => void;
  onPrint: () => void;
  onExport: (m: Message) => void;
  onSaveAttachment: (m: Message, file: Attachment) => void;
  onSaveAll: (m: Message, files: Attachment[]) => void;
  onUnsubscribe: (m: Message, info: Unsubscribe) => void;
  onRespondInvite: (m: Message, status: "accepted" | "tentative" | "declined") => void;
  /** Preferenza: carica subito immagini e stili remoti. */
  remoteImages: boolean;
  /** Conversazione del messaggio aperto, dal più vecchio (vuota se non calcolata). */
  thread: Message[];
  /** Mittenti di cui mostrare sempre le immagini remote. */
  trustedSenders: string[];
  onTrustSender: (email: string) => void;
  /** Selezione multipla: con almeno due messaggi il lettore mostra il riepilogo e le azioni di gruppo. */
  bulk: Message[] | null;
  onBulkMove: (to: Folder) => void;
  /** Cartelle dell'utente in cui spostare (solo se i selezionati sono di un account). */
  bulkBoxes: Mailbox[];
  /** I selezionati appartengono a più account. */
  bulkMixed: boolean;
  onBulkMoveBox: (mailbox: Mailbox) => void;
  /** Etichette presenti su tutti i selezionati. */
  bulkLabelIds: string[];
  onBulkToggleLabel: (id: string) => void;
  onBulkCreateLabel: (name: string) => void;
  onBulkFlags: (flags: { seen?: boolean; flagged?: boolean }) => void;
  onBulkClear: () => void;
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
  const toggle = (menu: ReaderMenu) => p.onMenu(p.menu === menu ? null : menu);
  const close = () => p.onMenu(null);
  if (p.bulk) return <BulkPanel {...p} bulk={p.bulk} />;
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
            <button type="button" className="icon-btn lg" aria-label={m?.folder === "trash" ? "Elimina definitivamente" : "Sposta nel cestino"} title={m?.folder === "trash" ? "Elimina definitivamente" : "Sposta nel cestino"} disabled={!m} onClick={() => m && p.onDelete(m)}>
              <Icon name="trash" size={17} stroke={1.7} />
            </button>
            <button
              type="button"
              className="icon-btn lg"
              aria-label={m?.unread ? "Segna come letto" : "Segna come da leggere"}
              title={m?.unread ? "Segna come letto" : "Segna come da leggere (U)"}
              disabled={!m}
              onClick={() => m && p.onToggleRead(m)}
            >
              <Icon name={m?.unread ? "mail" : "markUnread"} size={17} stroke={1.7} />
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
            <span className="pop-anchor">
              <button type="button" className="icon-btn lg" aria-label="Altre azioni" title="Altre azioni" aria-expanded={p.menu === "more"} disabled={!m} onClick={() => toggle("more")}>
                <Icon name="more" size={17} stroke={2.4} />
              </button>
              {m && p.menu === "more" && (
                <Popover label="Altre azioni" onClose={close}>
                  <button type="button" className="pop-item" onClick={() => (close(), p.onSpam(m))}>
                    <span className="label-name"><Icon name="ban" size={15} stroke={1.8} />Segnala come spam</span>
                  </button>
                  <button type="button" className="pop-item" onClick={() => (close(), p.onPrint())}>
                    <span className="label-name"><Icon name="print" size={15} stroke={1.8} />Stampa o salva in PDF</span>
                  </button>
                  <button type="button" className="pop-item" disabled={m.id.startsWith("local:")} onClick={() => (close(), p.onExport(m))}>
                    <span className="label-name"><Icon name="download" size={15} stroke={1.8} />Esporta in .eml</span>
                  </button>
                </Popover>
              )}
            </span>
          </div>
          <div className="toolbar-group end">
            {m?.folder === "drafts" && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => p.onResumeDraft(m)}>
                <Icon name="pen" size={15} />
                Riprendi
              </button>
            )}
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

/** Informazione letta dal messaggio completo quando lo si apre; `null` finché non c'è o se non serve. */
function useMessageInfo<T>(m: Message, wanted: boolean, cache: Map<string, T | null>, read: (m: Message) => Promise<T | null>): T | null {
  const [value, setValue] = useState<T | null>(() => cache.get(m.id) ?? null);
  useEffect(() => {
    if (!wanted) return setValue(null);
    if (cache.has(m.id)) return setValue(cache.get(m.id) ?? null);
    setValue(null);
    let gone = false;
    read(m)
      // Senza rete la lettura fallisce in silenzio: è un di più, non il messaggio.
      .catch(() => null)
      .then((v) => {
        cache.set(m.id, v);
        if (!gone) setValue(v);
      });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, wanted]);
  return value;
}

const unsubscribeCache = new Map<string, Unsubscribe | null>();
const inviteCache = new Map<string, Invite | null>();

/** Invito di calendario con le risposte per l'organizzatore. */
function InviteCard({ invite, onRespond }: { invite: Invite; onRespond: (status: "accepted" | "tentative" | "declined") => void }) {
  const [answered, setAnswered] = useState<string | null>(null);
  const when = invite.start
    ? invite.allDay
      ? new Date(invite.start * 1000).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : new Date(invite.start * 1000).toLocaleString("it-IT", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    : null;
  const answer = (status: "accepted" | "tentative" | "declined", label: string) => {
    setAnswered(label);
    onRespond(status);
  };
  return (
    <div className="invite-card">
      <Icon name="calendar" size={18} stroke={1.8} />
      <div className="invite-main">
        <strong>{invite.method === "CANCEL" ? `Annullato: ${invite.summary}` : invite.summary}</strong>
        {when && <span>{when}</span>}
        {invite.location && <span>{invite.location}</span>}
        {invite.organizer && <span className="paper-muted">Organizza {invite.organizer}</span>}
      </div>
      {invite.method === "REQUEST" && invite.organizer && (
        <div className="invite-actions">
          {answered ? (
            <span className="paper-muted">{answered}</span>
          ) : (
            <>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => answer("accepted", "Hai accettato")}>Accetta</button>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => answer("tentative", "Hai risposto forse")}>Forse</button>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => answer("declined", "Hai rifiutato")}>Rifiuta</button>
            </>
          )}
        </div>
      )}
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

  const onServer = !m.scheduled && !m.id.startsWith("local:");
  const unsubscribe = useMessageInfo(m, onServer && !mine(m), unsubscribeCache, api.unsubscribeInfo);
  const invite = useMessageInfo(m, onServer, inviteCache, api.calendarInvite);
  const [hover, setHover] = useState<string | null>(null);

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
          {unsubscribe && (
            <div className="snooze-note">
              <Icon name="ban" size={14} stroke={2} />
              Fa parte di una lista di invio
              <button type="button" className="link-btn" onClick={() => p.onUnsubscribe(m, unsubscribe)}>
                Disiscriviti
              </button>
            </div>
          )}
          {invite && <InviteCard invite={invite} onRespond={(status) => p.onRespondInvite(m, status)} />}
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
                onHoverLink={setHover}
              />
            </div>
          ))}
        </div>
      </div>

      {hover && <div className="link-status" role="status">{hover}</div>}

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
  onHoverLink: (href: string | null) => void;
}

/** Un messaggio della conversazione: compatto (mittente e anteprima) oppure completo. */
function ThreadMessage({ message: m, account: a, mine, open, collapsible, onToggle, onPreview, onLink, onMailto, remoteImages, trustedSenders, onTrustSender, onHoverLink, onSaveAttachment, onSaveAll }: ThreadMessageProps) {
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
        <MailFrame html={html.html} remote={showRemote} onLink={onLink} onMailto={onMailto} onHover={onHoverLink} />
      ) : (
        <div className={html === undefined ? "body-text loading" : "body-text"}>
          {paragraphs(m.body).map((para, i) => (
            <p key={i}><LinkedText text={para} onLink={onLink} /></p>
          ))}
          {!m.body.trim() && <p className="paper-muted">(Messaggio senza testo)</p>}
        </div>
      )}

      {files.length > 0 && (
        <div className="attachments">
          <div className="attach-head">
            <span className="eyebrow">{plural(files.length, "allegato", "allegati")}</span>
            {!m.scheduled && !m.id.startsWith("local:") && files.length > 1 && (
              <button type="button" className="link-btn" onClick={() => onSaveAll(m, files)}>
                Salva tutti
              </button>
            )}
          </div>
          <div className="attach-grid">
            {files.map((f) => (
              <div key={f.index} className="attach-wrap">
              <button
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
              {!m.scheduled && !m.id.startsWith("local:") && (
                <button type="button" className="icon-btn attach-save" aria-label={`Salva ${f.name} con nome`} title="Salva con nome" onClick={() => onSaveAttachment(m, f)}>
                  <Icon name="download" size={15} stroke={1.9} />
                </button>
              )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Indirizzi web nel testo semplice, senza la punteggiatura che li segue nella frase. */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const TRAILING_RE = /[.,;:!?'’)\]}»]+$/;

/** Testo con gli indirizzi web cliccabili. */
function LinkedText({ text, onLink }: { text: string; onLink: (url: string, text: string) => void }) {
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(TRAILING_RE, "");
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    parts.push(
      text.slice(pos, match.index),
      <a
        key={match.index}
        href={href}
        title={href}
        onClick={(e) => {
          e.preventDefault();
          onLink(href, url);
        }}
      >
        {url}
      </a>,
    );
    pos = match.index + url.length;
  }
  parts.push(text.slice(pos));
  return <>{parts}</>;
}

const MOVE_FOLDERS: { id: Folder; label: string; icon: "inbox" | "archive" | "trash" }[] = [
  { id: "inbox", label: "Posta in arrivo", icon: "inbox" },
  { id: "archive", label: "Archivio", icon: "archive" },
  { id: "trash", label: "Cestino", icon: "trash" },
];

/** Messaggi selezionati: azioni di gruppo e riepilogo al posto del lettore. */
function BulkPanel({ bulk, onBulkMove, onBulkFlags, onBulkClear, bulkBoxes, bulkMixed, onBulkMoveBox, bulkLabelIds, onBulkToggleLabel, onBulkCreateLabel, onBulkSpam, labels, menu, onMenu }: Props & { bulk: Message[] }) {
  const closeMenu = () => onMenu(null);
  const toggleMenu = (next: ReaderMenu) => onMenu(menu === next ? null : next);
  const allFlagged = bulk.every((m) => m.flagged);
  const anyUnread = bulk.some((m) => m.unread);
  const allTrash = bulk.every((m) => m.folder === "trash");
  const shown = bulk.slice(0, 8);
  return (
    <main className="reader">
      <div className="reader-bar">
        <div className="toolbar-group">
          <button type="button" className="icon-btn lg" aria-label="Archivia i selezionati" title="Archivia (E)" onClick={() => onBulkMove("archive")}>
            <Icon name="archive" size={17} stroke={1.7} />
          </button>
          <button type="button" className="icon-btn lg" aria-label={allTrash ? "Elimina definitivamente i selezionati" : "Sposta i selezionati nel cestino"} title={allTrash ? "Elimina definitivamente" : "Sposta nel cestino (Canc)"} onClick={() => onBulkMove("trash")}>
            <Icon name="trash" size={17} stroke={1.7} />
          </button>
          <button
            type="button"
            className="icon-btn lg"
            aria-label={anyUnread ? "Segna come letti" : "Segna come non letti"}
            title={anyUnread ? "Segna come letti" : "Segna come non letti (U)"}
            onClick={() => onBulkFlags({ seen: anyUnread })}
          >
            <Icon name={anyUnread ? "mail" : "markUnread"} size={17} stroke={1.7} />
          </button>
          <span className="divider" />
          <button
            type="button"
            className={allFlagged ? "icon-btn lg starred" : "icon-btn lg"}
            aria-label={allFlagged ? "Togli contrassegno" : "Contrassegna"}
            aria-pressed={allFlagged}
            title="Contrassegna (S)"
            onClick={() => onBulkFlags({ flagged: !allFlagged })}
          >
            <Icon name="star" size={17} stroke={1.7} fill={allFlagged ? "currentColor" : "none"} />
          </button>
          <button type="button" className="icon-btn lg" aria-label="Segnala come spam" title="Segnala come spam" onClick={onBulkSpam}>
            <Icon name="ban" size={17} stroke={1.7} />
          </button>
          <span className="pop-anchor">
            <button type="button" className="icon-btn lg" aria-label="Sposta in una cartella" title="Sposta in…" aria-expanded={menu === "move"} onClick={() => toggleMenu("move")}>
              <Icon name="folder" size={17} stroke={1.7} />
            </button>
            {menu === "move" && (
              <Popover label="Sposta in" onClose={closeMenu}>
                <div className="pop-title">Sposta in</div>
                <div className="pop-scroll scroll">
                  {MOVE_FOLDERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="pop-item"
                      onClick={() => {
                        closeMenu();
                        onBulkMove(f.id);
                      }}
                    >
                      <span className="label-name">
                        <Icon name={f.icon} size={15} stroke={1.8} />
                        {f.label}
                      </span>
                    </button>
                  ))}
                  {bulkBoxes.map((b) => (
                    <button
                      key={b.path}
                      type="button"
                      className="pop-item"
                      onClick={() => {
                        closeMenu();
                        onBulkMoveBox(b);
                      }}
                    >
                      <span className="label-name">
                        <Icon name="folder" size={15} stroke={1.8} />
                        {b.label}
                      </span>
                    </button>
                  ))}
                </div>
                {bulkMixed && <div className="pop-empty">Le altre cartelle compaiono selezionando messaggi di un solo account.</div>}
              </Popover>
            )}
          </span>
          <span className="pop-anchor">
            <button type="button" className="icon-btn lg" aria-label="Etichetta i selezionati" title="Etichetta" aria-expanded={menu === "label"} onClick={() => toggleMenu("label")}>
              <Icon name="tag" size={17} stroke={1.7} />
            </button>
            {menu === "label" && (
              <Popover label="Etichetta" onClose={closeMenu}>
                <LabelPicker labels={labels} selected={bulkLabelIds} onToggle={onBulkToggleLabel} onCreate={onBulkCreateLabel} />
              </Popover>
            )}
          </span>
        </div>
        <div className="toolbar-group end">
          <button type="button" className="btn btn-soft btn-sm" onClick={onBulkClear}>
            Deseleziona
          </button>
        </div>
      </div>
      <article className="paper scroll">
        <div className="paper-inner bulk">
          <div className="bulk-count">{bulk.length}</div>
          <h2 className="reader-subject">{bulk.length === 1 ? "messaggio selezionato" : "messaggi selezionati"}</h2>
          <ul className="bulk-list">
            {shown.map((m) => (
              <li key={m.id}>
                <span className="bulk-from">{m.fromName}</span>
                <span className="bulk-subject">{m.subject}</span>
              </li>
            ))}
            {bulk.length > shown.length && <li className="paper-muted">e altri {bulk.length - shown.length}</li>}
          </ul>
          <p className="paper-muted bulk-hint">
            <kbd>Canc</kbd> cestino · <kbd>E</kbd> archivia · <kbd>S</kbd> contrassegna · <kbd>U</kbd> non letti · <kbd>Esc</kbd> deseleziona
          </p>
        </div>
      </article>
    </main>
  );
}
