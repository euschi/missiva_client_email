import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, errorText, inTauri } from "../api";
import { initials, monoOf, providerLabel } from "../format";
import { Icon, type IconName } from "../icons";
import { hasFormatting, toHtml } from "../markdown";
import type { Account, Draft, Outgoing } from "../types";
import { CloseButton, Modal } from "./Modal";
import { Popover, WhenPicker } from "./Pickers";

interface Props {
  accounts: Account[];
  draft: Draft;
  onClose: () => void;
  onSent: (account: Account) => void;
  onScheduled: (account: Account, at: number) => void;
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Campo destinatari a "gettoni": Invio, virgola o Tab confermano un indirizzo. */
function Recipients({ label, values, onChange, autoFocus }: { label: string; values: string[]; onChange: (v: string[]) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const commit = () => {
    const parts = text.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...values, ...parts.filter((p) => !values.includes(p))]);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === "Tab" && text)) && !e.ctrlKey) {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !text && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <div className="recipients">
      {values.map((v) => (
        <span key={v} className={EMAIL.test(v) ? "recipient" : "recipient invalid"} title={EMAIL.test(v) ? v : "Indirizzo non valido"}>
          <span className="avatar">{initials(v.split("@")[0].replace(/[._-]/g, " "))}</span>
          {v}
          <button type="button" aria-label={`Rimuovi ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            <Icon name="close" size={11} stroke={2.4} />
          </button>
        </span>
      ))}
      <label style={{ flex: 1, minWidth: 160, display: "flex" }}>
        <span className="sr-only">{label}</span>
        <input type="text" value={text} placeholder={values.length ? "" : "Aggiungi destinatario"} autoFocus={autoFocus} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onBlur={commit} />
      </label>
    </div>
  );
}

type Format = { icon: IconName; label: string; keys?: string; apply: (sel: string) => { text: string; select?: [number, number] } };

// Ogni comando restituisce il testo da mettere al posto della selezione e cosa selezionare dopo.
const FORMATS: Format[] = [
  { icon: "bold", label: "Grassetto", keys: "Ctrl B", apply: (t) => ({ text: `**${t || "grassetto"}**`, select: [2, 2 + (t || "grassetto").length] }) },
  { icon: "italic", label: "Corsivo", keys: "Ctrl I", apply: (t) => ({ text: `_${t || "corsivo"}_`, select: [1, 1 + (t || "corsivo").length] }) },
  {
    icon: "link",
    label: "Link",
    apply: (t) => {
      const label = t || "testo";
      return { text: `[${label}](https://)`, select: [label.length + 3, label.length + 11] };
    },
  },
  { icon: "list", label: "Elenco puntato", apply: (t) => ({ text: (t || "").split("\n").map((l) => `- ${l}`).join("\n") }) },
  { icon: "quote", label: "Citazione", apply: (t) => ({ text: (t || "").split("\n").map((l) => `> ${l}`).join("\n") }) },
];

export function Compose({ accounts, draft, onClose, onSent, onScheduled }: Props) {
  const [fromId, setFromId] = useState(draft.accountId ?? accounts[0]?.id);
  const [picking, setPicking] = useState(false);
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc ?? []);
  const [bcc, setBcc] = useState(draft.bcc ?? []);
  const [showCc, setShowCc] = useState((draft.cc ?? []).length > 0);
  const [showBcc, setShowBcc] = useState((draft.bcc ?? []).length > 0);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [files, setFiles] = useState(draft.attachments ?? []);
  const [sending, setSending] = useState(false);
  const [later, setLater] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Selezione da ripristinare subito dopo un comando di formattazione, prima che arrivi altro input.
  const pendingSelection = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    if (!sel || !bodyRef.current) return;
    pendingSelection.current = null;
    bodyRef.current.focus();
    bodyRef.current.setSelectionRange(sel[0], sel[1]);
  }, [body]);

  const from = accounts.find((a) => a.id === fromId) ?? accounts[0];

  const formatted = hasFormatting(body);

  /** Invia subito oppure, con `at`, mette in coda per l'ora scelta. */
  const send = async (at?: number) => {
    if (sending || !from) return;
    setLater(false);
    // Il campo destinatari conferma l'ultimo indirizzo al blur: aspetta che lo stato si aggiorni.
    (document.activeElement as HTMLElement | null)?.blur();
    await new Promise((r) => setTimeout(r, 0));
    setError(null);
    setSending(true);
    const outgoing: Outgoing = { accountId: from.id, to, cc, bcc, subject, body, html: formatted ? toHtml(body) : null, attachments: files, inReplyTo: draft.inReplyTo };
    try {
      if (at) {
        await api.scheduleMessage(outgoing, at);
        onScheduled(from, at);
      } else {
        await api.sendMessage(outgoing);
        onSent(from);
      }
    } catch (e) {
      setError(errorText(e));
      setSending(false);
    }
  };

  const format = (f: Format) => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const { text, select } = f.apply(body.slice(a, b));
    pendingSelection.current = select ? [a + select[0], a + select[1]] : [a + text.length, a + text.length];
    setBody(body.slice(0, a) + text + body.slice(b));
  };

  const invalid = [...to, ...cc, ...bcc].some((v) => !EMAIL.test(v));
  const dirty = body !== draft.body || subject !== draft.subject || to.length !== draft.to.length || files.length > 0;
  const attach = async () => setFiles([...files, ...(await api.pickFiles()).filter((f) => !files.includes(f))]);

  return (
    <Modal label="Nuovo messaggio" onClose={onClose} dismissable={!dirty && !sending}>
      <div
        style={{ display: "contents" }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            send();
          } else if (e.ctrlKey && e.target === bodyRef.current && (e.key === "b" || e.key === "i")) {
            e.preventDefault();
            format(FORMATS[e.key === "b" ? 0 : 1]);
          }
        }}
      >
        <header className="window-head">
          <div className="window-head-title">
            <span className="window-title">{draft.inReplyTo ? "Risposta" : "Nuovo messaggio"}</span>
            <span className="window-meta">{formatted ? "Testo formattato" : "Testo semplice"}</span>
          </div>
          <CloseButton onClose={onClose} label="Chiudi e torna alla posta" />
        </header>

        <div className="compose-fields">
          <div className="field-row">
            <span className="field-label">Da</span>
            {from && (
              <button type="button" className="from-btn" aria-haspopup="listbox" aria-expanded={picking} onClick={() => setPicking(!picking)}>
                <span className="mono-tile" style={{ background: from.color }}>{monoOf(from.name)}</span>
                <span className="from-name">{from.name}</span>
                <span className="from-addr">{from.email}</span>
                <Icon name="chevron" size={14} stroke={2} />
              </button>
            )}
            {from && <span className="field-hint">invio tramite {providerLabel(from.provider, from.smtp.host)}</span>}
          </div>

          {picking && (
            <div
              role="listbox"
              aria-label="Scegli account di invio"
              className="listbox"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setPicking(false);
                }
              }}
            >
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="option"
                  className="option"
                  aria-selected={a.id === from?.id}
                  onClick={() => {
                    setFromId(a.id);
                    setPicking(false);
                  }}
                >
                  <span className="mono-tile" style={{ background: a.color }}>{monoOf(a.name)}</span>
                  <span className="meta">
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{a.name}</span>
                    <span className="mono" style={{ fontSize: 11.5, color: "var(--text-5)" }}>
                      {a.email} · {providerLabel(a.provider, a.smtp.host)}
                    </span>
                  </span>
                  {a.id === from?.id && <Icon name="check" size={16} stroke={2.2} className="option-check" />}
                </button>
              ))}
            </div>
          )}

          <div className="field-row">
            <span className="field-label">A</span>
            <Recipients label="Destinatari" values={to} onChange={setTo} autoFocus={to.length === 0} />
            <span className="cc-toggles">
              {!showCc && <button type="button" onClick={() => setShowCc(true)}>Cc</button>}
              {!showBcc && <button type="button" onClick={() => setShowBcc(true)}>Ccn</button>}
            </span>
          </div>
          {showCc && (
            <div className="field-row">
              <span className="field-label">Cc</span>
              <Recipients label="Copia conoscenza" values={cc} onChange={setCc} />
            </div>
          )}
          {showBcc && (
            <div className="field-row">
              <span className="field-label">Ccn</span>
              <Recipients label="Copia conoscenza nascosta" values={bcc} onChange={setBcc} />
            </div>
          )}

          <label className="field-row last">
            <span className="field-label">Oggetto</span>
            <input className="subject-input" type="text" value={subject} placeholder="Oggetto" onChange={(e) => setSubject(e.target.value)} />
          </label>
        </div>

        <div className="compose-paper">
          <div role="toolbar" aria-label="Formattazione e allegati" className="compose-toolbar">
            {FORMATS.map((f) => (
              <button
                key={f.label}
                type="button"
                className="icon-btn"
                aria-label={f.label}
                title={f.keys ? `${f.label} (${f.keys})` : f.label}
                // Evita che il pulsante tolga il fuoco (e la selezione) al testo.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => format(f)}
              >
                <Icon name={f.icon} size={15} stroke={2} />
              </button>
            ))}
            <span className="toolbar-sep" />
            <button type="button" className="icon-btn" aria-label="Allega file" title={inTauri ? "Allega file" : "Disponibile nell’app"} onClick={attach} disabled={!inTauri}>
              <Icon name="clip" size={15} stroke={2} />
            </button>
            <span className="hint">{formatted ? "Inviato in HTML e testo semplice" : "Testo semplice"}</span>
          </div>
          <div className="compose-scroll scroll" onClick={(e) => e.target === e.currentTarget && bodyRef.current?.focus()}>
            <label style={{ display: "contents" }}>
              <span className="sr-only">Testo del messaggio</span>
              <textarea
                ref={bodyRef}
                className="compose-body"
                value={body}
                placeholder="Scrivi il messaggio…"
                autoFocus={to.length > 0}
                onChange={(e) => setBody(e.target.value)}
                onFocus={(e) => draft.inReplyTo && e.currentTarget.setSelectionRange(0, 0)}
              />
            </label>
            {from?.signature.trim() && (
              <div className="signature">
                <strong>{from.displayName}</strong>
                <span>{from.signature}</span>
              </div>
            )}
            {files.length > 0 && (
              <div className="file-chips">
                {files.map((f) => {
                  const name = f.split("/").pop() ?? f;
                  return (
                    <span key={f} className="file-chip">
                      <span className="file-tile">{(name.split(".").pop() ?? "FILE").slice(0, 4).toUpperCase()}</span>
                      {name}
                      <button type="button" aria-label={`Rimuovi ${name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>
                        <Icon name="close" size={11} stroke={2.4} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="compose-foot">
          {error ? (
            <span className="foot-note error" role="alert">{error}</span>
          ) : (
            from && (
              <span className="foot-note">
                <Icon name="lock" size={13} stroke={2} />
                {from.smtp.security === "tls" ? "TLS" : "STARTTLS"} verso {from.smtp.host}
              </span>
            )
          )}
          <div className="foot-actions">
            <button type="button" className="icon-btn" style={{ width: 40, height: 40 }} aria-label="Elimina bozza" title="Elimina bozza" onClick={onClose}>
              <Icon name="trash" size={17} stroke={1.7} />
            </button>
            <span className="pop-anchor">
              <button
                type="button"
                className="icon-btn"
                style={{ width: 40, height: 40 }}
                aria-label="Invia più tardi"
                title="Invia più tardi"
                aria-expanded={later}
                disabled={sending || !from || to.length === 0 || invalid}
                onClick={() => setLater(!later)}
              >
                <Icon name="clock" size={17} stroke={1.7} />
              </button>
              {later && (
                <Popover label="Invia più tardi" placement={["up", "end"]} onClose={() => setLater(false)}>
                  <WhenPicker title="Invia più tardi" onPick={(at) => send(at)} />
                </Popover>
              )}
            </span>
            <button type="button" className="btn btn-primary" onClick={() => send()} disabled={sending || !from || to.length === 0 || invalid}>
              {sending ? "Invio in corso…" : `Invia da ${from?.name ?? ""}`}
              <kbd>Ctrl ↵</kbd>
            </button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
