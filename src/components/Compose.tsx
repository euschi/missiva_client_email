import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, errorText, inTauri } from "../api";
import { initials, monoOf, providerLabel } from "../format";
import { Icon, type IconName } from "../icons";
import { hasFormatting, toHtml } from "../markdown";
import type { Template } from "../store";
import type { Account, Contact, Draft, Outgoing } from "../types";
import { CloseButton, Modal } from "./Modal";
import { MailEditorView, linkHref, useMailEditor } from "./MailEditor";
import { Popover, WhenPicker } from "./Pickers";

interface Props {
  accounts: Account[];
  draft: Draft;
  onClose: () => void;
  /** Pronto a partire: l'app lo spedisce dopo il tempo per annullare. */
  onQueued: (account: Account, outgoing: Outgoing, meta: { savedIn: string | null; replaces?: string }) => void;
  /** Secondi per annullare l'invio. */
  sendDelay: number;
  templates: Template[];
  onTemplates: (list: Template[]) => void;
  onScheduled: (account: Account, at: number) => void;
  /** La cartella Bozze è cambiata; `saved` se Missiva vi ha appena lasciato la bozza. */
  onDraftsChanged: (saved: boolean) => void;
  contacts: Contact[];
}

/** Dopo quanto dall'ultima modifica la bozza si salva da sola. */
const AUTOSAVE_MS = 15_000;
const MAX_SUGGESTIONS = 6;

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

interface RecipientsProps {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  contacts: Contact[];
  autoFocus?: boolean;
}

/** Campo destinatari a "gettoni": Invio, virgola o Tab confermano un indirizzo; suggerisce i contatti noti. */
function Recipients({ label, values, onChange, contacts, autoFocus }: RecipientsProps) {
  const [text, setText] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const needle = text.trim().toLowerCase();
  const suggestions = needle
    ? contacts.filter((c) => !values.includes(c.email) && (c.email.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle))).slice(0, MAX_SUGGESTIONS)
    : [];
  // Un indirizzo già completo non va sostituito per sbaglio dal primo suggerimento.
  const current = active ?? (EMAIL.test(text.trim()) ? -1 : 0);
  const choose = (email: string) => {
    onChange([...values, email]);
    setText("");
    setActive(null);
  };
  const commit = () => {
    const parts = text.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...values, ...parts.filter((p) => !values.includes(p))]);
    setText("");
    setActive(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((Math.max(current, d > 0 ? -1 : 0) + d + suggestions.length) % suggestions.length);
    } else if (suggestions[current] && (e.key === "Enter" || e.key === "Tab") && !e.ctrlKey) {
      e.preventDefault();
      choose(suggestions[current].email);
    } else if ((e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === "Tab" && text)) && !e.ctrlKey) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape" && suggestions.length) {
      e.stopPropagation();
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
        <input
          type="text"
          value={text}
          placeholder={values.length ? "" : "Aggiungi destinatario"}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value);
            setActive(null);
          }}
          onKeyDown={onKey}
          onBlur={commit}
        />
      </label>
      {suggestions.length > 0 && (
        <div className="popover suggestions" role="listbox" aria-label="Contatti suggeriti">
          {suggestions.map((c, i) => (
            <button
              key={c.email}
              type="button"
              role="option"
              tabIndex={-1}
              className="pop-item"
              aria-selected={i === current}
              // Il campo non deve perdere il fuoco, altrimenti confermerebbe il testo parziale.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(c.email);
              }}
            >
              <span className="suggestion-name">{c.name}</span>
              <span className="pop-hint">{c.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Format = { icon: IconName; label: string; keys?: string; mark: string; run: (e: Editor) => void };

// Comandi di formattazione: l'editor mostra subito il risultato, senza simboli.
const FORMATS: Format[] = [
  { icon: "bold", label: "Grassetto", keys: "Ctrl B", mark: "bold", run: (e) => e.chain().focus().toggleBold().run() },
  { icon: "italic", label: "Corsivo", keys: "Ctrl I", mark: "italic", run: (e) => e.chain().focus().toggleItalic().run() },
];
const BLOCKS: Format[] = [
  { icon: "list", label: "Elenco puntato", keys: "Ctrl Maiusc 8", mark: "bulletList", run: (e) => e.chain().focus().toggleBulletList().run() },
  { icon: "quote", label: "Citazione", keys: "Ctrl Maiusc B", mark: "blockquote", run: (e) => e.chain().focus().toggleBlockquote().run() },
];

/** Comandi che compaiono quando il cursore è in una tabella. */
const TABLE_ACTIONS: { label: string; run: (e: Editor) => void }[] = [
  { label: "+ Riga", run: (e) => e.chain().focus().addRowAfter().run() },
  { label: "+ Colonna", run: (e) => e.chain().focus().addColumnAfter().run() },
  { label: "− Riga", run: (e) => e.chain().focus().deleteRow().run() },
  { label: "− Colonna", run: (e) => e.chain().focus().deleteColumn().run() },
  { label: "Elimina tabella", run: (e) => e.chain().focus().deleteTable().run() },
];

/** Barra di formattazione: i pulsanti risultano premuti quando il cursore è nel testo formattato. */
function FormatBar({ editor }: { editor: Editor | null }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      active: e ? Object.fromEntries(["bold", "italic", "link", "bulletList", "blockquote", "table"].map((m) => [m, e.isActive(m)])) : {},
      link: (e?.getAttributes("link").href as string | undefined) ?? "",
      empty: e?.state.selection.empty ?? true,
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const active = state?.active ?? {};
  // Il pulsante non deve togliere il fuoco (e la selezione) al testo.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  const button = (f: Format) => (
    <button
      key={f.label}
      type="button"
      className="icon-btn"
      aria-label={f.label}
      aria-pressed={!!active[f.mark]}
      title={f.keys ? `${f.label} (${f.keys})` : f.label}
      onMouseDown={keep}
      onClick={() => editor && f.run(editor)}
    >
      <Icon name={f.icon} size={15} stroke={2} />
    </button>
  );

  const applyLink = () => {
    if (!editor) return;
    const url = linkHref(href);
    setLinkOpen(false);
    if (!url) return void editor.chain().focus().extendMarkRange("link").unsetLink().run();
    const chain = editor.chain().focus().extendMarkRange("link");
    // Senza testo selezionato il link mostra l'indirizzo stesso.
    if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: href.trim(), marks: [{ type: "link", attrs: { href: url } }] }).run();
    else chain.setLink({ href: url }).run();
  };

  return (
    <>
      {FORMATS.map(button)}
      <span className="pop-anchor">
        <button
          type="button"
          className="icon-btn"
          aria-label="Link"
          aria-pressed={!!active.link}
          aria-expanded={linkOpen}
          title="Link"
          onMouseDown={keep}
          onClick={() => {
            setHref(state?.link ?? "");
            setLinkOpen(!linkOpen);
          }}
        >
          <Icon name="link" size={15} stroke={2} />
        </button>
        {linkOpen && (
          <Popover label="Link" onClose={() => setLinkOpen(false)}>
            <form className="pop-custom" onSubmit={(e) => (e.preventDefault(), applyLink())}>
              <input type="text" autoFocus aria-label="Indirizzo del link" placeholder="https://… o email" value={href} onChange={(e) => setHref(e.target.value)} />
              <button type="submit" className="btn btn-soft btn-sm">{href.trim() || !active.link ? "Applica" : "Togli"}</button>
            </form>
          </Popover>
        )}
      </span>
      {BLOCKS.map(button)}
      <button
        type="button"
        className="icon-btn"
        aria-label="Inserisci tabella"
        aria-pressed={!!active.table}
        title="Inserisci tabella"
        disabled={!!active.table}
        onMouseDown={keep}
        onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <Icon name="table" size={15} stroke={2} />
      </button>
      {active.table && (
        <span className="table-actions" role="group" aria-label="Tabella">
          {TABLE_ACTIONS.map((t) => (
            <button key={t.label} type="button" className="btn btn-soft btn-sm" onMouseDown={keep} onClick={() => editor && t.run(editor)}>
              {t.label}
            </button>
          ))}
        </span>
      )}
    </>
  );
}

export function Compose({ accounts, draft, onClose, onQueued, sendDelay, templates, onTemplates, onScheduled, onDraftsChanged, contacts }: Props) {
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
  const [keepQuote, setKeepQuote] = useState(true);
  const [signatureId, setSignatureId] = useState(draft.signatureId ?? "default");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [dropping, setDropping] = useState(false);
  const from = accounts.find((a) => a.id === fromId) ?? accounts[0];

  const formatted = hasFormatting(body);
  const editor = useMailEditor({ value: body, onChange: setBody, placeholder: "Scrivi il messaggio…", autofocus: draft.to.length > 0 });

  const alternatives = from?.signatures ?? [];
  // Cambiando mittente una firma dell'altro account non vale più: si torna alla predefinita.
  const chosenSignature = signatureId === "none" || alternatives.some((x) => x.id === signatureId) ? signatureId : "default";
  const signatureText =
    chosenSignature === "none" ? "" : (alternatives.find((x) => x.id === chosenSignature)?.text ?? from?.signature ?? "");
  const signatureFormatted = hasFormatting(signatureText);

  // Il Message-ID resta lo stesso per tutta la bozza: è ciò che lega i salvataggi successivi.
  const messageId = useRef(draft.draftId ?? `${crypto.randomUUID()}@${from?.email.split("@")[1] || "missiva.local"}`);
  const outgoing = (): Outgoing => ({
    accountId: from?.id ?? "",
    to,
    cc,
    bcc,
    subject,
    body,
    html: formatted ? toHtml(body) : null,
    attachments: files,
    inReplyTo: draft.inReplyTo,
    references: draft.references ?? [],
    messageId: messageId.current,
    quote: keepQuote ? (draft.quote ?? null) : null,
    quoteHtml: keepQuote ? (draft.quoteHtml ?? null) : null,
    signature: signatureText,
    signatureHtml: signatureFormatted ? toHtml(signatureText) : null,
  });
  const snapshot = JSON.stringify([from?.id, to, cc, bcc, subject, body, files, keepQuote, chosenSignature]);
  // Stato dell'ultimo render, per chi legge dopo un'attesa: conferma dei destinatari al blur compresa.
  const latest = useRef({ outgoing, snapshot });
  latest.current = { outgoing, snapshot };

  const initial = useRef(snapshot);
  const saved = useRef(snapshot);
  /** Account in cui la bozza esiste già sul server. */
  const savedIn = useRef<string | null>(draft.draftId ? (draft.accountId ?? null) : null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [closeFailed, setCloseFailed] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // Le modifiche a un messaggio programmato restano fuori da Bozze: si applicano solo reinviandolo.
  const canSave = !draft.replaces && !!from;

  /** I salvataggi passano in fila: arrivano al server nell'ordine in cui sono partiti. */
  const persist = () => {
    const { outgoing: current, snapshot: snap } = latest.current;
    const out = current();
    const previous = savedIn.current;
    saving.current = saving.current
      .catch(() => {})
      .then(async () => {
        await api.saveDraft(out);
        savedIn.current = out.accountId;
        saved.current = snap;
        if (previous && previous !== out.accountId) await api.deleteDraft(previous, messageId.current).catch(() => {});
      });
    return saving.current;
  };

  useEffect(() => {
    if (!canSave || sending || snapshot === saved.current) return;
    const t = setTimeout(() => {
      persist().then(
        () => setDraftNote("Bozza salvata"),
        (e) => setDraftNote(`Bozza non salvata: ${errorText(e)}`),
      );
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, sending, canSave]);

  /** Il campo destinatari conferma l'ultimo indirizzo al blur: aspetta che lo stato si aggiorni. */
  const settleFields = async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await new Promise((r) => setTimeout(r, 0));
  };

  /** Chiudere non perde mai il testo: la bozza resta in Bozze. */
  const close = async () => {
    if (sending) return;
    await settleFields();
    const changed = canSave && latest.current.snapshot !== saved.current;
    if (changed) {
      try {
        await persist();
      } catch (e) {
        if (!closeFailed) {
          setCloseFailed(true);
          setError(`Bozza non salvata: ${errorText(e)}. Chiudi di nuovo per uscire senza salvarla.`);
          return;
        }
      }
    }
    if (savedIn.current) onDraftsChanged(changed);
    onClose();
  };

  const discard = async () => {
    await saving.current.catch(() => {});
    if (savedIn.current) {
      await api.deleteDraft(savedIn.current, messageId.current).catch((e) => setError(errorText(e)));
      onDraftsChanged(false);
    }
    onClose();
  };

  /** Invia subito oppure, con `at`, mette in coda per l'ora scelta. */
  const send = async (at?: number) => {
    if (sending || !from) return;
    setLater(false);
    await settleFields();
    setError(null);
    setSending(true);
    const out = latest.current.outgoing();
    // I destinatari possono essere cambiati con la conferma al blur: si ricontrollano ora.
    if (out.to.length === 0 || [...out.to, ...out.cc, ...out.bcc].some((v) => !EMAIL.test(v))) {
      setError("Controlla gli indirizzi dei destinatari");
      setSending(false);
      return;
    }
    try {
      if (at) {
        await api.scheduleMessage(out, at);
        await saving.current.catch(() => {});
        if (savedIn.current) {
          await api.deleteDraft(savedIn.current, messageId.current).catch(() => {});
          onDraftsChanged(false);
        }
        onScheduled(from, at);
      } else {
        // Mentre si può ancora annullare il messaggio resta in Bozze: uscendo dall'app non si perde.
        if (sendDelay > 0 && canSave) await persist().catch(() => {});
        else await saving.current.catch(() => {});
        onQueued(from, out, { savedIn: savedIn.current, replaces: draft.replaces });
      }
    } catch (e) {
      setError(errorText(e));
      setSending(false);
    }
  };

  // File trascinati sulla finestra Scrivi: li consegna il sistema, con il percorso.
  useEffect(() => {
    if (!inTauri) return;
    let off: (() => void) | undefined;
    let gone = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "drop") {
          const dropped = e.payload.paths;
          setFiles((list) => [...list, ...dropped.filter((f) => !list.includes(f))]);
          setDropping(false);
        } else {
          setDropping(e.payload.type !== "leave");
        }
      })
      .then((f) => {
        if (gone) f();
        else off = f;
      });
    return () => {
      gone = true;
      off?.();
    };
  }, []);

  const applyTemplate = (t: Template) => {
    setTemplatesOpen(false);
    setBody(body.trim() ? `${t.body}\n\n${body}` : t.body);
    if (!subject.trim()) setSubject(t.subject);
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    onTemplates([...templates.filter((t) => t.name !== name), { id: crypto.randomUUID(), name, subject, body }]);
    setTemplateName("");
  };

  const invalid = [...to, ...cc, ...bcc].some((v) => !EMAIL.test(v));
  const dirty = snapshot !== initial.current;
  const attach = async () => setFiles([...files, ...(await api.pickFiles()).filter((f) => !files.includes(f))]);

  return (
    <Modal label="Nuovo messaggio" onClose={close} dismissable={!dirty && !sending}>
      <div
        style={{ display: "contents" }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            send();
          }
        }}
      >
        <header className="window-head">
          <div className="window-head-title">
            <span className="window-title">{draft.inReplyTo ? "Risposta" : "Nuovo messaggio"}</span>
            <span className="window-meta">{formatted ? "Testo formattato" : "Testo semplice"}</span>
          </div>
          <CloseButton onClose={close} label={canSave ? "Chiudi e salva in Bozze" : "Chiudi e torna alla posta"} />
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
            <Recipients label="Destinatari" values={to} onChange={setTo} contacts={contacts} autoFocus={to.length === 0} />
            <span className="cc-toggles">
              {!showCc && <button type="button" onClick={() => setShowCc(true)}>Cc</button>}
              {!showBcc && <button type="button" onClick={() => setShowBcc(true)}>Ccn</button>}
            </span>
          </div>
          {showCc && (
            <div className="field-row">
              <span className="field-label">Cc</span>
              <Recipients label="Copia conoscenza" values={cc} onChange={setCc} contacts={contacts} />
            </div>
          )}
          {showBcc && (
            <div className="field-row">
              <span className="field-label">Ccn</span>
              <Recipients label="Copia conoscenza nascosta" values={bcc} onChange={setBcc} contacts={contacts} />
            </div>
          )}

          <label className="field-row last">
            <span className="field-label">Oggetto</span>
            <input className="subject-input" type="text" value={subject} placeholder="Oggetto" onChange={(e) => setSubject(e.target.value)} />
          </label>
        </div>

        <div className={dropping ? "compose-paper dropping" : "compose-paper"}>
          <div role="toolbar" aria-label="Formattazione e allegati" className="compose-toolbar">
            <FormatBar editor={editor} />
            <span className="toolbar-sep" />
            <button type="button" className="icon-btn" aria-label="Allega file" title={inTauri ? "Allega file" : "Disponibile nell’app"} onClick={attach} disabled={!inTauri}>
              <Icon name="clip" size={15} stroke={2} />
            </button>
            <span className="pop-anchor">
              <button type="button" className="icon-btn" aria-label="Modelli" title="Modelli" aria-expanded={templatesOpen} onClick={() => setTemplatesOpen(!templatesOpen)}>
                <Icon name="draft" size={15} stroke={2} />
              </button>
              {templatesOpen && (
                <Popover label="Modelli" onClose={() => setTemplatesOpen(false)}>
                  <div className="pop-title">Modelli</div>
                  <div className="pop-scroll scroll">
                    {templates.length === 0 && <div className="pop-empty">Nessun modello. Scrivi il messaggio e salvalo qui sotto.</div>}
                    {templates.map((t) => (
                      <div key={t.id} className="template-row">
                        <button type="button" className="pop-item" title={t.subject} onClick={() => applyTemplate(t)}>
                          <span className="suggestion-name">{t.name}</span>
                        </button>
                        <button type="button" className="icon-btn" aria-label={`Elimina il modello ${t.name}`} title="Elimina" onClick={() => onTemplates(templates.filter((x) => x.id !== t.id))}>
                          <Icon name="close" size={11} stroke={2.4} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <form className="pop-custom" onSubmit={(e) => (e.preventDefault(), saveTemplate())}>
                    <input type="text" aria-label="Nome del nuovo modello" placeholder="Salva questo testo come…" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                    <button type="submit" className="btn btn-soft btn-sm" disabled={!templateName.trim() || !body.trim()}>Salva</button>
                  </form>
                </Popover>
              )}
            </span>
            <span className="hint">{formatted ? "Inviato in HTML e testo semplice" : "Testo semplice"}</span>
          </div>
          <div className="compose-scroll scroll" onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}>
            <MailEditorView editor={editor} />
            {(signatureText.trim() || alternatives.length > 0) && (
              <div className="signature">
                {alternatives.length > 0 && (
                  <label className="signature-pick">
                    <span className="sr-only">Firma</span>
                    <select value={chosenSignature} onChange={(e) => setSignatureId(e.target.value)}>
                      <option value="default">Firma predefinita</option>
                      {alternatives.map((x) => (
                        <option key={x.id} value={x.id}>{x.name}</option>
                      ))}
                      <option value="none">Nessuna firma</option>
                    </select>
                  </label>
                )}
                {/* Anteprima fedele a ciò che parte: niente nome del mittente, formattazione resa. */}
                {signatureText.trim() &&
                  (signatureFormatted ? (
                    <span className="signature-html" dangerouslySetInnerHTML={{ __html: toHtml(signatureText) }} />
                  ) : (
                    <span>{signatureText.trim()}</span>
                  ))}
              </div>
            )}
            {draft.quote && keepQuote && (
              <div className="quote-chip">
                <span>Messaggio originale incluso</span>
                <button type="button" className="link-btn" onClick={() => setKeepQuote(false)}>Togli</button>
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
          ) : draftNote ? (
            <span className={draftNote === "Bozza salvata" ? "foot-note" : "foot-note error"} role="status">
              <Icon name={draftNote === "Bozza salvata" ? "check" : "alert"} size={13} stroke={2} />
              {draftNote}
            </span>
          ) : (
            from && (
              <span className="foot-note">
                <Icon name="lock" size={13} stroke={2} />
                {from.smtp.security === "tls" ? "TLS" : "STARTTLS"} verso {from.smtp.host}
              </span>
            )
          )}
          <div className="foot-actions">
            {discarding ? (
              <>
                <button type="button" className="btn btn-soft btn-sm" onClick={() => setDiscarding(false)}>
                  Tieni
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={discard}>
                  Elimina bozza
                </button>
              </>
            ) : (
              <button
                type="button"
                className="icon-btn"
                style={{ width: 40, height: 40 }}
                aria-label="Elimina bozza"
                title="Elimina bozza"
                disabled={sending}
                // Si chiede conferma solo se c'è qualcosa da perdere.
                onClick={() => (dirty || savedIn.current ? setDiscarding(true) : onClose())}
              >
                <Icon name="trash" size={17} stroke={1.7} />
              </button>
            )}
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
