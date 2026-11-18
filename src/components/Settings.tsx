import { useEffect, useRef, useState } from "react";
import { api, errorText, inTauri } from "../api";
import { monoOf, plural } from "../format";
import { Icon, type IconName } from "../icons";
import { notificationsAllowed, notifyTest } from "../notify";
import { SHORTCUTS } from "../shortcuts";
import { forgetTools, joinCommand, pairsText, parsePairs, parseServersJson, splitCommand, type McpAction } from "../mcp";
import { LABEL_COLORS, type Labels, type Rule } from "../store";
import { PRESETS, accentOf, inkFor, isHex, type Density, type Prefs, type Reader } from "../prefs";
import { version } from "../../package.json";
import type { Account, AccountPatch, Mailbox, McpServer } from "../types";
import { CloseButton, Modal } from "./Modal";

export type Section = "accounts" | "look" | "mail" | "rules" | "labels" | "notifications" | "tray" | "shortcuts" | "privacy" | "mcp";

const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: "accounts", label: "Account", icon: "user" },
  { id: "look", label: "Aspetto", icon: "palette" },
  { id: "mail", label: "Invio e posta", icon: "send" },
  { id: "rules", label: "Regole", icon: "filter" },
  { id: "labels", label: "Etichette", icon: "tag" },
  { id: "mcp", label: "Collegamenti MCP", icon: "plug" },
  { id: "notifications", label: "Notifiche", icon: "bell" },
  { id: "tray", label: "Area di notifica", icon: "tray" },
  { id: "shortcuts", label: "Scorciatoie", icon: "keys" },
  { id: "privacy", label: "Privacy e sicurezza", icon: "lock" },
];

const ACCOUNT_COLORS = ["#F2A65A", "#7AB0FF", "#C7B5FF", "#7EE0B5", "#FF8F7A", "#8FD3FF"];

interface Props {
  section: Section;
  accounts: Account[];
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
  onAccountChanged: (a: Account) => void;
  onAccountRemoved: (id: string) => void;
  onAddAccount: () => void;
  trayAvailable: boolean;
  labels: Labels;
  onLabels: (l: Labels) => void;
  rules: Rule[];
  onRules: (r: Rule[]) => void;
  /** Regola da completare, proposta dal menu di un messaggio. */
  ruleDraft?: Partial<Rule>;
  mailboxes: Record<string, Mailbox[]>;
  mcpActions: McpAction[];
  onMcpActions: (a: McpAction[]) => void;
  onClearCache: () => Promise<void>;
  onClose: () => void;
}

export function Settings(p: Props) {
  const [section, setSection] = useState<Section>(p.section);
  return (
    <Modal label="Impostazioni" onClose={p.onClose}>
      <header className="window-head">
        <span className="window-title">Impostazioni</span>
        <CloseButton onClose={p.onClose} />
      </header>
      <div className="split">
        <nav aria-label="Sezioni impostazioni" className="settings-nav">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="nav-item" aria-current={section === s.id} onClick={() => setSection(s.id)}>
              <Icon name={s.icon} size={16} stroke={1.7} />
              {s.label}
            </button>
          ))}
          <span className="settings-version">Missiva {version}</span>
        </nav>
        <section className="settings-main scroll">
          {section === "accounts" && <Accounts {...p} />}
          {section === "look" && <Look prefs={p.prefs} onPrefs={p.onPrefs} />}
          {section === "mail" && <MailSection prefs={p.prefs} onPrefs={p.onPrefs} />}
          {section === "rules" && <RulesSection rules={p.rules} onRules={p.onRules} labels={p.labels} accounts={p.accounts} mailboxes={p.mailboxes} draft={p.ruleDraft} />}
          {section === "labels" && <LabelsSection labels={p.labels} onLabels={p.onLabels} />}
          {section === "mcp" && <McpSection actions={p.mcpActions} onActions={p.onMcpActions} />}
          {section === "notifications" && <Notifications prefs={p.prefs} onPrefs={p.onPrefs} />}
          {section === "tray" && <Tray prefs={p.prefs} onPrefs={p.onPrefs} available={p.trayAvailable} />}
          {section === "shortcuts" && <Shortcuts />}
          {section === "privacy" && <Privacy prefs={p.prefs} onPrefs={p.onPrefs} onClearCache={p.onClearCache} />}
        </section>
      </div>
    </Modal>
  );
}

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="stack-10">
      <span className="setting-title">{label}</span>
      <div role="radiogroup" aria-label={label} className="segmented">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={o.id === value} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Look({ prefs, onPrefs }: { prefs: Prefs; onPrefs: (p: Prefs) => void }) {
  const [hexText, setHexText] = useState(prefs.customHex);
  const accent = accentOf(prefs);
  const custom = prefs.accentId === "custom";
  const setHex = (raw: string) => {
    let v = raw.trim();
    if (v && v[0] !== "#") v = `#${v}`;
    setHexText(v);
    if (isHex(v)) onPrefs({ ...prefs, accentId: "custom", customHex: v });
  };

  return (
    <>
      <div className="settings-head">
        <h1>Aspetto</h1>
        <p>Le modifiche si applicano subito.</p>
      </div>
      <div className="settings-grid">
        <div className="stack-22">
          <fieldset className="setting">
            <legend>
              <span className="setting-title">Colore dell’app</span>
              <span className="setting-desc">Usato per Scrivi, messaggi non letti, invio e stato di sincronizzazione.</span>
            </legend>
            <div role="radiogroup" aria-label="Colore dell’app" className="presets">
              {PRESETS.map((c) => {
                const on = prefs.accentId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="preset"
                    style={on ? { boxShadow: `inset 0 0 0 1.5px ${c.hex}` } : undefined}
                    onClick={() => onPrefs({ ...prefs, accentId: c.id })}
                  >
                    <span className="swatch" style={{ background: c.hex, color: inkFor(c.hex) }}>
                      {on && <Icon name="check" size={13} stroke={3} />}
                    </span>
                    <span className="label">{c.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="custom-color" style={custom ? { background: "var(--fill-strong)", boxShadow: `inset 0 0 0 1.5px ${accent}` } : undefined}>
              <span>Personalizzato</span>
              <label>
                <span className="sr-only">Scegli un colore</span>
                <input type="color" value={isHex(hexText) ? hexText : prefs.customHex} onChange={(e) => setHex(e.target.value)} />
              </label>
              <label>
                <span className="sr-only">Codice esadecimale</span>
                <input type="text" value={hexText} maxLength={7} onChange={(e) => setHex(e.target.value)} />
              </label>
            </div>
            {custom && inkFor(accent) === "#FFFFFF" && (
              <span className="warn-text">Colore molto scuro: il testo sui pulsanti diventa bianco per restare leggibile.</span>
            )}
          </fieldset>

          <Segmented<Reader>
            label="Pannello di lettura"
            options={[{ id: "paper", label: "Carta" }, { id: "ink", label: "Inchiostro" }]}
            value={prefs.reader}
            onChange={(reader) => onPrefs({ ...prefs, reader })}
          />
          <Segmented<Density>
            label="Densità dell’elenco"
            options={[{ id: "comfortable", label: "Comoda" }, { id: "compact", label: "Compatta" }]}
            value={prefs.density}
            onChange={(density) => onPrefs({ ...prefs, density })}
          />
        </div>

        <aside aria-label="Anteprima" className="stack-10">
          <span className="eyebrow">Anteprima</span>
          <div className="preview">
            <span className="preview-compose">
              Scrivi
              <span>C</span>
            </span>
            <span className="preview-sync">
              <span className="dot" />
              Sincronizzato · adesso
            </span>
            <div className="preview-rows">
              <span className="preview-row on">
                <span className="top">
                  <span className="unread-dot" />
                  <span className="who">Giulia Ferri</span>
                  <span className="when">09:42</span>
                </span>
                <span className="what">Architettura del nuovo gateway</span>
              </span>
              <span className="preview-row">
                <span className="top">
                  <span className="who">Chiara Russo</span>
                  <span className="when">08:03</span>
                </span>
                <span className="what">Sabato sera da noi?</span>
              </span>
            </div>
            <div className="preview-paper">
              <span className="title">Note per giovedì</span>
              <span className="bar" style={{ width: "90%" }} />
              <span className="bar" style={{ width: "70%" }} />
              <span className="send-mini" aria-hidden="true">
                <Icon name="send" size={13} stroke={2} />
              </span>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function Accounts({ accounts, onAccountChanged, onAccountRemoved, onAddAccount }: Props) {
  return (
    <>
      <div className="settings-head">
        <h1>Account</h1>
        <p>Nome, firma e colore di ogni casella. Le credenziali restano nel portachiavi di sistema.</p>
      </div>
      {accounts.length === 0 && <p className="lead">Nessun account configurato.</p>}
      {accounts.map((a) => (
        <AccountCard key={a.id} account={a} onChanged={onAccountChanged} onRemoved={onAccountRemoved} />
      ))}
      <button type="button" className="btn btn-soft" style={{ alignSelf: "flex-start" }} onClick={onAddAccount}>
        <Icon name="plus" size={15} stroke={2} />
        Aggiungi account
      </button>
    </>
  );
}

type AccountFields = Omit<AccountPatch, "id">;
type SignatureList = NonNullable<Account["signatures"]>;

/** Attesa dopo l'ultimo tasto prima di salvare una firma. */
const SIGNATURE_SAVE_MS = 600;

function AccountCard({ account: a, onChanged, onRemoved }: { account: Account; onChanged: (a: Account) => void; onRemoved: (id: string) => void }) {
  const [name, setName] = useState(a.name);
  const [displayName, setDisplayName] = useState(a.displayName);
  const [signature, setSignature] = useState(a.signature);
  const [signatures, setSignatures] = useState<SignatureList>(a.signatures ?? []);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le firme si salvano mentre si scrive: le modifiche in sospeso si uniscono in una sola
  // richiesta e i salvataggi partono in fila, così uno vecchio non sovrascrive uno nuovo.
  const signaturesRef = useRef(signatures);
  const pending = useRef<AccountFields>({});
  const timer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const save = async (patch: AccountFields) => {
    try {
      setError(null);
      onChanged(await api.updateAccount({ id: a.id, ...patch }));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const enqueue = (patch: AccountFields) => {
    queue.current = queue.current.then(() => saveRef.current(patch));
  };

  const flush = () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    enqueue(patch);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  // Chiudere le impostazioni senza uscire dal campo non perde quel che si è scritto.
  useEffect(() => () => flushRef.current(), []);

  const saveSoon = (patch: AccountFields) => {
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SIGNATURE_SAVE_MS);
  };

  const editSignature = (text: string) => {
    setSignature(text);
    saveSoon({ signature: text });
  };

  /** Cambia l'elenco partendo sempre dall'ultima versione, non da quella del render. */
  const editSignatures = (change: (list: SignatureList) => SignatureList, now = false) => {
    const next = change(signaturesRef.current);
    signaturesRef.current = next;
    setSignatures(next);
    saveSoon({ signatures: next });
    if (now) flush();
  };

  const remove = async () => {
    try {
      window.clearTimeout(timer.current);
      pending.current = {};
      await api.removeAccount(a.id);
      onRemoved(a.id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="acct-card">
      <div className="acct-card-head">
        <span className="mono-tile" style={{ background: a.color }}>{monoOf(a.name)}</span>
        <span className="meta">
          <span className="name">{a.name}</span>
          <span className="sub">{a.email}</span>
        </span>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>Nome nella barra laterale</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => (name.trim() ? name !== a.name && enqueue({ name }) : setName(a.name))}
          />
        </label>
        <label className="field">
          <span>Nome del mittente</span>
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => (displayName.trim() ? displayName !== a.displayName && enqueue({ displayName }) : setDisplayName(a.displayName))}
          />
        </label>
      </div>
      <label className="field">
        <span>Firma</span>
        <textarea className="input" rows={2} value={signature} onChange={(e) => editSignature(e.target.value)} onBlur={flush} />
      </label>
      <Signatures list={signatures} onEdit={editSignatures} onBlur={flush} />
      {error && <div className="status error" role="alert"><span>{error}</span></div>}
      <div className="acct-card-foot">
        <div role="radiogroup" aria-label={`Colore di ${a.name}`} className="color-dots">
          {ACCOUNT_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={a.color === c} aria-label={c} style={{ background: c }} onClick={() => enqueue({ color: c })} />
          ))}
        </div>
        {confirm ? (
          <div className="foot-actions">
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setConfirm(false)}>Annulla</button>
            <button type="button" className="btn btn-danger btn-sm" onClick={remove}>Rimuovi definitivamente</button>
          </div>
        ) : (
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={14} />
            Rimuovi account
          </button>
        )}
      </div>
    </div>
  );
}

/** Primo nome libero tra "Firma 2", "Firma 3"…: la predefinita è la numero 1. */
function freeSignatureName(list: SignatureList, except?: string): string {
  const used = new Set(list.filter((x) => x.id !== except).map((x) => x.name.trim().toLowerCase()));
  let n = 2;
  while (used.has(`firma ${n}`)) n++;
  return `Firma ${n}`;
}

/** Firme alternative di un account, tra cui scegliere nella finestra Scrivi. */
function Signatures({ list, onEdit, onBlur }: { list: SignatureList; onEdit: (change: (list: SignatureList) => SignatureList, now?: boolean) => void; onBlur: () => void }) {
  const set = (id: string, field: "name" | "text", value: string) => onEdit((l) => l.map((y) => (y.id === id ? { ...y, [field]: value } : y)));
  return (
    <div className="stack-10">
      {list.map((x) => (
        <div key={x.id} className="signature-edit">
          <input
            className="input"
            aria-label="Nome della firma"
            value={x.name}
            onChange={(e) => set(x.id, "name", e.target.value)}
            onBlur={() =>
              x.name.trim()
                ? onBlur()
                : onEdit((l) => l.map((y) => (y.id === x.id ? { ...y, name: freeSignatureName(l, x.id) } : y)), true)
            }
          />
          <textarea className="input" rows={2} aria-label={`Testo della firma ${x.name}`} value={x.text} onChange={(e) => set(x.id, "text", e.target.value)} onBlur={onBlur} />
          <button type="button" className="icon-btn" aria-label={`Elimina la firma ${x.name}`} title="Elimina" onClick={() => onEdit((l) => l.filter((y) => y.id !== x.id), true)}>
            <Icon name="trash" size={15} stroke={1.8} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-soft btn-sm"
        style={{ alignSelf: "flex-start" }}
        onClick={() => onEdit((l) => [...l, { id: crypto.randomUUID(), name: freeSignatureName(l), text: "" }], true)}
      >
        <Icon name="plus" size={14} stroke={2} />
        Aggiungi un'altra firma
      </button>
    </div>
  );
}

function Head({ title, text }: { title: string; text: string }) {
  return (
    <div className="settings-head">
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}

/** Riga con titolo, descrizione e interruttore. */
function Toggle({ title, desc, checked, disabled, onChange }: { title: string; desc?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={disabled ? "setting-row disabled" : "setting-row"}>
      <span className="setting-text">
        <span className="setting-title">{title}</span>
        {desc && <span className="setting-desc">{desc}</span>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

type PrefsProps = { prefs: Prefs; onPrefs: (p: Prefs) => void };

function Notifications({ prefs, onPrefs }: PrefsProps) {
  const [status, setStatus] = useState<string | null>(null);
  const enable = async (notify: boolean) => {
    onPrefs({ ...prefs, notify });
    if (notify && inTauri && !(await notificationsAllowed(true))) {
      setStatus("Il sistema non consente le notifiche a Missiva: abilitale dalle impostazioni del desktop.");
    }
  };
  const test = async () => setStatus((await notifyTest(prefs.notifyPreview)) ? "Notifica di prova inviata." : "Notifiche non disponibili: controlla le impostazioni del desktop.");
  return (
    <>
      <Head title="Notifiche" text="Avvisi del desktop quando arriva posta nuova in uno qualsiasi degli account." />
      <div className="settings-list">
        <Toggle title="Notifiche per i nuovi messaggi" desc="Solo per i messaggi non letti arrivati in Posta in arrivo." checked={prefs.notify} onChange={enable} />
        <Toggle
          title="Mostra mittente e oggetto"
          desc="Se disattivato la notifica dice solo quanti messaggi sono arrivati: utile quando condividi lo schermo."
          checked={prefs.notifyPreview}
          disabled={!prefs.notify}
          onChange={(notifyPreview) => onPrefs({ ...prefs, notifyPreview })}
        />
      </div>
      <div className="foot-actions">
        <button type="button" className="btn btn-soft btn-sm" onClick={test} disabled={!prefs.notify || !inTauri}>
          <Icon name="bell" size={14} />
          Invia notifica di prova
        </button>
        {status && <span className="setting-desc" role="status">{status}</span>}
      </div>
    </>
  );
}

function Tray({ prefs, onPrefs, available }: PrefsProps & { available: boolean }) {
  return (
    <>
      <Head title="Area di notifica" text="L’icona di Missiva nel pannello mostra i non letti e tiene la posta sincronizzata anche a finestra chiusa." />
      <div role="status" className={available ? "status ok" : "status info"}>
        <Icon name={available ? "check" : "alert"} size={16} stroke={2.2} />
        <span>
          {available
            ? "Icona attiva. Dal suo menu puoi riaprire la finestra, sincronizzare o uscire."
            : "Icona non disponibile su questo desktop (serve il supporto AppIndicator, su GNOME tramite l’estensione AppIndicator)."}
        </span>
      </div>
      <div className="settings-list">
        <Toggle
          title="Chiudendo la finestra, resta nell’area di notifica"
          desc="Missiva continua a sincronizzare e a notificare. Per uscire usa «Esci» nel menu dell’icona."
          checked={prefs.closeToTray && available}
          disabled={!available}
          onChange={(closeToTray) => onPrefs({ ...prefs, closeToTray })}
        />
      </div>
    </>
  );
}

function Shortcuts() {
  return (
    <>
      <Head title="Scorciatoie" text="Le lettere singole funzionano quando non stai scrivendo in un campo di testo." />
      {SHORTCUTS.map((g) => (
        <div key={g.group} className="stack-10">
          <span className="eyebrow">{g.group}</span>
          <div className="settings-list">
            {g.items.map((i) => (
              <div key={i.label} className="setting-row">
                <span className="setting-text">{i.label}</span>
                <span className="keys">
                  {i.keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function Privacy({ prefs, onPrefs, onClearCache }: PrefsProps & { onClearCache: () => Promise<void> }) {
  const [clearing, setClearing] = useState<"idle" | "busy" | "done">("idle");
  const clear = async () => {
    setClearing("busy");
    await onClearCache().catch(() => {});
    setClearing("done");
  };
  return (
    <>
      <Head title="Privacy e sicurezza" text="Cosa resta sul computer e cosa viene caricato quando apri un messaggio." />
      <div className="settings-list">
        <Toggle
          title="Segna come letto quando apri un messaggio"
          desc="Se disattivato, il messaggio resta non letto finché non lo segni tu (anche sul server)."
          checked={prefs.markReadOnOpen}
          onChange={(markReadOnOpen) => onPrefs({ ...prefs, markReadOnOpen })}
        />
        <Toggle
          title="Carica le immagini remote"
          desc="Se disattivato, immagini e stili da internet restano bloccati finché non premi «Mostra» nel messaggio: i pixel di tracciamento non sanno quando apri la posta."
          checked={prefs.remoteImages}
          onChange={(remoteImages) => onPrefs({ ...prefs, remoteImages })}
        />
      </div>
      <div className="settings-list">
        <div className="setting-row">
          <Icon name="shield" size={18} />
          <span className="setting-text">
            <span className="setting-title">Messaggi HTML isolati</span>
            <span className="setting-desc">L’HTML dei messaggi gira senza script e i link si aprono nel browser di sistema.</span>
          </span>
        </div>
        <div className="setting-row">
          <Icon name="lock" size={18} />
          <span className="setting-text">
            <span className="setting-title">Credenziali nel portachiavi</span>
            <span className="setting-desc">Password e token sono nel Secret Service di sistema; le connessioni a IMAP e SMTP usano sempre TLS o STARTTLS.</span>
          </span>
        </div>
      </div>
      <div className="stack-10">
        <span className="setting-title">Cache locale</span>
        <span className="setting-desc">I messaggi scaricati restano in ~/.cache/missiva per aprirli subito all’avvio. Svuotarla non tocca la posta sui server.</span>
        <div className="foot-actions">
          <button type="button" className="btn btn-soft btn-sm" onClick={clear} disabled={clearing === "busy"}>
            <Icon name="trash" size={14} />
            {clearing === "busy" ? "Svuoto e risincronizzo…" : "Svuota la cache dei messaggi"}
          </button>
          {clearing === "done" && <span className="setting-desc" role="status">Cache svuotata.</span>}
        </div>
      </div>
    </>
  );
}

function LabelsSection({ labels, onLabels }: { labels: Labels; onLabels: (l: Labels) => void }) {
  const count = (id: string) => Object.values(labels.byMessage).filter((ids) => ids.includes(id)).length;
  const patch = (id: string, change: { name?: string; color?: string }) =>
    onLabels({ ...labels, defs: labels.defs.map((l) => (l.id === id ? { ...l, ...change } : l)) });
  const remove = (id: string) =>
    onLabels({
      defs: labels.defs.filter((l) => l.id !== id),
      byMessage: Object.fromEntries(
        Object.entries(labels.byMessage)
          .map(([k, ids]) => [k, ids.filter((x) => x !== id)] as const)
          .filter(([, ids]) => ids.length > 0),
      ),
    });
  return (
    <>
      <Head title="Etichette" text="Valgono per tutti gli account e si applicano dal pannello di lettura con L. Sugli account Gmail si sincronizzano con le etichette omonime; sugli altri restano su questo computer." />
      {labels.defs.length === 0 ? (
        <p className="setting-desc">Nessuna etichetta. Apri un messaggio e usa il pulsante Etichetta per crearne una.</p>
      ) : (
        <div className="settings-list">
          {labels.defs.map((l) => {
            const next = LABEL_COLORS[(LABEL_COLORS.indexOf(l.color) + 1) % LABEL_COLORS.length];
            return (
              <div key={l.id} className="setting-row">
                <button type="button" className="swatch-btn" style={{ background: l.color }} aria-label={`Cambia colore di ${l.name}`} title="Cambia colore" onClick={() => patch(l.id, { color: next })} />
                <label className="setting-text">
                  <span className="sr-only">Nome dell’etichetta</span>
                  <input
                    className="inline-input"
                    type="text"
                    defaultValue={l.name}
                    maxLength={40}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== l.name) patch(l.id, { name });
                      else e.target.value = l.name;
                    }}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  />
                </label>
                <span className="setting-desc">{plural(count(l.id), "messaggio", "messaggi")}</span>
                <button type="button" className="icon-btn" aria-label={`Elimina ${l.name}`} title="Elimina etichetta" onClick={() => remove(l.id)}>
                  <Icon name="trash" size={15} stroke={1.8} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function MailSection({ prefs, onPrefs }: PrefsProps) {
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.isDefaultMailClient().then(setIsDefault, () => setIsDefault(false));
  }, []);
  const makeDefault = async () => {
    try {
      setError(null);
      await api.setDefaultMailClient();
      setIsDefault(await api.isDefaultMailClient());
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <>
      <Head title="Invio e posta" text="Come partono i messaggi e chi apre i link alle email." />
      <Segmented<string>
        label="Tempo per annullare un invio"
        options={[
          { id: "0", label: "Subito" },
          { id: "6", label: "6 secondi" },
          { id: "10", label: "10 secondi" },
          { id: "30", label: "30 secondi" },
        ]}
        value={String(prefs.sendDelay)}
        onChange={(v) => onPrefs({ ...prefs, sendDelay: Number(v) })}
      />
      <div className="stack-10">
        <span className="setting-title">Client di posta predefinito</span>
        <span className="setting-desc">I link alle email (mailto:) del browser e delle altre app aprono la finestra Scrivi di Missiva.</span>
        <div className="foot-actions">
          {isDefault ? (
            <span className="setting-desc" role="status">Missiva è il client predefinito.</span>
          ) : (
            <button type="button" className="btn btn-soft btn-sm" onClick={makeDefault} disabled={!inTauri}>
              <Icon name="mail" size={14} />
              Usa Missiva come predefinito
            </button>
          )}
          {error && <span className="setting-desc" role="alert">{error}</span>}
        </div>
      </div>
    </>
  );
}

const RULE_FIELDS: { id: Rule["field"]; label: string }[] = [
  { id: "from", label: "Il mittente" },
  { id: "to", label: "Il destinatario" },
  { id: "subject", label: "L'oggetto" },
];

const RULE_ACTIONS: { id: Rule["action"]; label: string }[] = [
  { id: "read", label: "Segna come letto" },
  { id: "star", label: "Contrassegna" },
  { id: "label", label: "Applica un'etichetta" },
  { id: "archive", label: "Archivia" },
  { id: "move", label: "Sposta in una cartella" },
  { id: "spam", label: "Segnala come spam" },
  { id: "trash", label: "Sposta nel cestino" },
];

function ruleText(r: Rule, labels: Labels, accounts: Account[]) {
  const field = RULE_FIELDS.find((f) => f.id === r.field)?.label ?? "";
  const action = r.action === "label" ? `applica «${labels.defs.find((l) => l.id === r.labelId)?.name ?? "?"}»` : r.action === "move" ? `sposta in «${r.boxLabel}»` : RULE_ACTIONS.find((a) => a.id === r.action)?.label.toLowerCase();
  const scope = r.accountId ? ` · solo ${accounts.find((a) => a.id === r.accountId)?.name ?? "?"}` : "";
  return `${field} contiene «${r.contains}»: ${action}${scope}`;
}

function RulesSection({ rules, onRules, labels, accounts, mailboxes, draft }: { rules: Rule[]; onRules: (r: Rule[]) => void; labels: Labels; accounts: Account[]; mailboxes: Record<string, Mailbox[]>; draft?: Partial<Rule> }) {
  const [field, setField] = useState<Rule["field"]>(draft?.field ?? "from");
  const [contains, setContains] = useState(draft?.contains ?? "");
  const [action, setAction] = useState<Rule["action"]>("archive");
  const [accountId, setAccountId] = useState(draft?.accountId ?? "");
  const [labelId, setLabelId] = useState("");
  const [boxPath, setBoxPath] = useState("");
  const boxes = (mailboxes[accountId] ?? []).filter((b) => b.selectable && !b.special);
  const incomplete = !contains.trim() || (action === "label" && !labelId) || (action === "move" && (!accountId || !boxPath));
  const add = () => {
    const box = boxes.find((b) => b.path === boxPath);
    onRules([
      ...rules,
      {
        id: crypto.randomUUID(),
        field,
        contains: contains.trim(),
        action,
        accountId: accountId || null,
        ...(action === "label" ? { labelId } : {}),
        ...(action === "move" && box ? { boxPath: box.path, boxLabel: box.label } : {}),
      },
    ]);
    setContains("");
  };
  return (
    <>
      <Head title="Regole" text="Valgono per i nuovi messaggi in arrivo mentre Missiva è aperta, anche solo nell'area di notifica. I messaggi già arrivati non cambiano." />
      {rules.length > 0 && (
        <div className="settings-list">
          {rules.map((r) => (
            <div key={r.id} className="setting-row">
              <span className="setting-text">{ruleText(r, labels, accounts)}</span>
              <button type="button" className="icon-btn" aria-label="Elimina la regola" title="Elimina" onClick={() => onRules(rules.filter((x) => x.id !== r.id))}>
                <Icon name="trash" size={15} stroke={1.8} />
              </button>
            </div>
          ))}
        </div>
      )}
      <form className="rule-form" onSubmit={(e) => (e.preventDefault(), !incomplete && add())}>
        <span className="setting-title">Nuova regola</span>
        <div className="grid-2">
          <label className="field">
            <span>Se</span>
            <select className="input" value={field} onChange={(e) => setField(e.target.value as Rule["field"])}>
              {RULE_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Contiene</span>
            <input className="input" value={contains} placeholder="es. newsletter@sito.it" onChange={(e) => setContains(e.target.value)} />
          </label>
          <label className="field">
            <span>Allora</span>
            <select className="input" value={action} onChange={(e) => setAction(e.target.value as Rule["action"])}>
              {RULE_ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Su quale account</span>
            <select className="input" value={accountId} onChange={(e) => (setAccountId(e.target.value), setBoxPath(""))}>
              <option value="">Tutti</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          {action === "label" && (
            <label className="field">
              <span>Etichetta</span>
              <select className="input" value={labelId} onChange={(e) => setLabelId(e.target.value)}>
                <option value="">Scegli…</option>
                {labels.defs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
          {action === "move" && (
            <label className="field">
              <span>Cartella{accountId ? "" : " (scegli prima un account)"}</span>
              <select className="input" value={boxPath} disabled={!accountId} onChange={(e) => setBoxPath(e.target.value)}>
                <option value="">Scegli…</option>
                {boxes.map((b) => <option key={b.path} value={b.path}>{b.label}</option>)}
              </select>
            </label>
          )}
        </div>
        <div>
          <button type="submit" className="btn btn-soft btn-sm" disabled={incomplete}>
            <Icon name="plus" size={14} stroke={2} />
            Aggiungi regola
          </button>
        </div>
      </form>
    </>
  );
}

interface ServerDraft {
  id: string;
  name: string;
  transport: McpServer["transport"];
  /** Programma e argomenti in una riga, come nel terminale. */
  commandLine: string;
  url: string;
  envText: string;
  headersText: string;
}

const NEW_SERVER: ServerDraft = { id: "", name: "", transport: "stdio", commandLine: "", url: "", envText: "", headersText: "" };

const toDraft = (s: McpServer): ServerDraft => ({
  id: s.id,
  name: s.name,
  transport: s.transport,
  commandLine: s.command ? joinCommand([s.command, ...s.args]) : "",
  url: s.url,
  envText: pairsText(s.env, "="),
  headersText: pairsText(s.headers, ": "),
});

function fromDraft(d: ServerDraft): McpServer {
  const [command = "", ...args] = splitCommand(d.commandLine);
  const stdio = d.transport === "stdio";
  return {
    id: d.id,
    name: d.name.trim(),
    transport: d.transport,
    command: stdio ? command : "",
    args: stdio ? args : [],
    url: stdio ? "" : d.url.trim(),
    env: stdio ? parsePairs(d.envText, "=") : {},
    headers: stdio ? {} : parsePairs(d.headersText, ":"),
  };
}

/** Esito della prova di un collegamento: numero di strumenti o errore. */
type Check = { busy: true } | { busy: false; ok: boolean; text: string };

function McpSection({ actions, onActions }: { actions: McpAction[]; onActions: (a: McpAction[]) => void }) {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importText, setImportText] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const reload = () =>
    api
      .mcpServers()
      .then(setServers)
      .catch((e) => (setServers([]), setError(errorText(e))));
  useEffect(() => void reload(), []);

  /** Prova il collegamento chiedendo l'elenco degli strumenti. */
  const check = async (id: string) => {
    setChecks((c) => ({ ...c, [id]: { busy: true } }));
    forgetTools(id);
    try {
      const tools = await api.mcpListTools(crypto.randomUUID(), id);
      setChecks((c) => ({ ...c, [id]: { busy: false, ok: true, text: plural(tools.length, "strumento", "strumenti") } }));
    } catch (e) {
      setChecks((c) => ({ ...c, [id]: { busy: false, ok: false, text: errorText(e) } }));
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.mcpSaveServer(fromDraft(draft));
      setDraft(null);
      await reload();
      void check(saved.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    try {
      await api.mcpRemoveServer(id);
      forgetTools(id);
      onActions(actions.filter((a) => a.serverId !== id));
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const importJson = async () => {
    if (importText === null) return;
    setError(null);
    try {
      const found = parseServersJson(importText);
      const saved: McpServer[] = [];
      for (const s of found) saved.push(await api.mcpSaveServer(s));
      setImportText(null);
      await reload();
      saved.forEach((s) => void check(s.id));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const describe = (s: McpServer) => (s.transport === "http" ? s.url : joinCommand([s.command, ...s.args]));
  const serverName = (id: string) => servers?.find((s) => s.id === id)?.name ?? "collegamento eliminato";
  const set = (patch: Partial<ServerDraft>) => draft && setDraft({ ...draft, ...patch });

  return (
    <>
      <Head
        title="Collegamenti MCP"
        text="Server Model Context Protocol da usare sulle email: dal menu «Altre azioni» di un messaggio scegli uno strumento, riempi i campi con i dati dell’email ed eseguilo. Variabili e header restano nel portachiavi di sistema."
      />
      {servers && servers.length > 0 && (
        <div className="settings-list">
          {servers.map((s) => {
            const c = checks[s.id];
            const related = actions.filter((a) => a.serverId === s.id).length;
            return (
              <div key={s.id} className="setting-row mcp-server-row">
                <Icon name={s.transport === "http" ? "link" : "plug"} size={16} stroke={1.8} />
                <span className="setting-text">
                  <span className="mcp-server-name">{s.name}</span>
                  <span className="mcp-server-detail">{describe(s)}</span>
                  {c && (c.busy ? <span className="mcp-server-detail">Provo il collegamento…</span> : <span className={c.ok ? "mcp-server-ok" : "link-error mcp-error"}>{c.text}</span>)}
                </span>
                {confirmDelete === s.id ? (
                  <>
                    <button type="button" className="btn btn-soft btn-sm" onClick={() => setConfirmDelete(null)}>
                      Annulla
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(s.id)}>
                      Elimina{related ? ` (e ${plural(related, "azione", "azioni")})` : ""}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="link-btn" disabled={c?.busy} onClick={() => check(s.id)}>
                      Prova
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Modifica ${s.name}`} title="Modifica" onClick={() => (setError(null), setDraft(toDraft(s)))}>
                      <Icon name="pen" size={15} stroke={1.8} />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Elimina ${s.name}`} title="Elimina" onClick={() => setConfirmDelete(s.id)}>
                      <Icon name="trash" size={15} stroke={1.8} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {servers?.length === 0 && !draft && <p className="setting-desc">Nessun collegamento ancora.</p>}

      {draft ? (
        <form className="rule-form" onSubmit={(e) => (e.preventDefault(), void save())}>
          <span className="setting-title">{draft.id ? "Modifica collegamento" : "Nuovo collegamento"}</span>
          <div className="grid-2">
            <label className="field">
              <span>Nome</span>
              <input className="input" value={draft.name} autoFocus placeholder="es. Task, Notion, Calendario" onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="field">
              <span>Tipo</span>
              <select className="input" value={draft.transport} onChange={(e) => set({ transport: e.target.value as McpServer["transport"] })}>
                <option value="stdio">Programma locale (stdio)</option>
                <option value="http">Server remoto (URL)</option>
              </select>
            </label>
          </div>
          {draft.transport === "stdio" ? (
            <>
              <label className="field">
                <span>Comando</span>
                <input className="input mono" value={draft.commandLine} placeholder="npx -y @modelcontextprotocol/server-filesystem /home/io/Documenti" onChange={(e) => set({ commandLine: e.target.value })} />
              </label>
              <label className="field">
                <span>Variabili d’ambiente (una per riga, NOME=valore)</span>
                <textarea className="input mono" rows={3} value={draft.envText} placeholder="API_KEY=…" onChange={(e) => set({ envText: e.target.value })} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>URL</span>
                <input className="input mono" value={draft.url} placeholder="https://esempio.it/mcp" onChange={(e) => set({ url: e.target.value })} />
              </label>
              <label className="field">
                <span>Header (uno per riga, Nome: valore)</span>
                <textarea className="input mono" rows={3} value={draft.headersText} placeholder="Authorization: Bearer …" onChange={(e) => set({ headersText: e.target.value })} />
              </label>
            </>
          )}
          {error && <p className="link-error">{error}</p>}
          <div className="mcp-form-actions">
            <button type="button" className="btn btn-soft btn-sm" onClick={() => (setDraft(null), setError(null))}>
              Annulla
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !draft.name.trim() || (draft.transport === "stdio" ? !draft.commandLine.trim() : !draft.url.trim())}>
              {saving ? "Salvo…" : "Salva e prova"}
            </button>
          </div>
        </form>
      ) : importText !== null ? (
        <form className="rule-form" onSubmit={(e) => (e.preventDefault(), void importJson())}>
          <span className="setting-title">Importa da JSON</span>
          <label className="field">
            <span>Incolla la configurazione di Claude Desktop, Cursor o VS Code (con «mcpServers» o «servers»)</span>
            <textarea className="input mono" rows={8} autoFocus value={importText} placeholder={'{\n  "mcpServers": {\n    "nome": { "command": "npx", "args": ["-y", "pacchetto"] }\n  }\n}'} onChange={(e) => setImportText(e.target.value)} />
          </label>
          {error && <p className="link-error">{error}</p>}
          <div className="mcp-form-actions">
            <button type="button" className="btn btn-soft btn-sm" onClick={() => (setImportText(null), setError(null))}>
              Annulla
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!importText.trim()}>
              Importa
            </button>
          </div>
        </form>
      ) : (
        <div className="mcp-form-actions start">
          <button type="button" className="btn btn-soft btn-sm" onClick={() => (setError(null), setDraft(NEW_SERVER))}>
            <Icon name="plus" size={14} stroke={2} />
            Aggiungi collegamento
          </button>
          <button type="button" className="link-btn" onClick={() => (setError(null), setImportText(""))}>
            Importa da JSON…
          </button>
          {error && <p className="link-error">{error}</p>}
        </div>
      )}

      <div className="stack-10 mcp-actions-block">
        <span className="setting-title">Azioni rapide</span>
        <span className="setting-desc">Le salvi dalla finestra «Azioni MCP» di un messaggio: compaiono nel menu «Altre azioni» e nel menu del tasto destro, e partono con un clic.</span>
        {actions.length > 0 && (
          <div className="settings-list">
            {actions.map((a) => (
              <div key={a.id} className="setting-row">
                <span className="setting-text">
                  <span className="mcp-server-name">{a.name}</span>
                  <span className="mcp-server-detail">
                    {serverName(a.serverId)} · {a.tool}
                  </span>
                </span>
                <button type="button" className="icon-btn" aria-label={`Elimina l’azione ${a.name}`} title="Elimina" onClick={() => onActions(actions.filter((x) => x.id !== a.id))}>
                  <Icon name="trash" size={15} stroke={1.8} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
