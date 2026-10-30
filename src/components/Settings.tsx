import { useState } from "react";
import { api, errorText, inTauri } from "../api";
import { monoOf, plural } from "../format";
import { Icon, type IconName } from "../icons";
import { notificationsAllowed, notifyTest } from "../notify";
import { SHORTCUTS } from "../shortcuts";
import { LABEL_COLORS, type Labels } from "../store";
import { PRESETS, accentOf, inkFor, isHex, type Density, type Prefs, type Reader } from "../prefs";
import type { Account, AccountPatch } from "../types";
import { CloseButton, Modal } from "./Modal";

export type Section = "accounts" | "look" | "labels" | "notifications" | "tray" | "shortcuts" | "privacy";

const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: "accounts", label: "Account", icon: "user" },
  { id: "look", label: "Aspetto", icon: "palette" },
  { id: "labels", label: "Etichette", icon: "tag" },
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
        </nav>
        <section className="settings-main scroll">
          {section === "accounts" && <Accounts {...p} />}
          {section === "look" && <Look prefs={p.prefs} onPrefs={p.onPrefs} />}
          {section === "labels" && <LabelsSection labels={p.labels} onLabels={p.onLabels} />}
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

function AccountCard({ account: a, onChanged, onRemoved }: { account: Account; onChanged: (a: Account) => void; onRemoved: (id: string) => void }) {
  const [name, setName] = useState(a.name);
  const [displayName, setDisplayName] = useState(a.displayName);
  const [signature, setSignature] = useState(a.signature);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Omit<AccountPatch, "id">) => {
    try {
      setError(null);
      onChanged(await api.updateAccount({ id: a.id, ...patch }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const remove = async () => {
    try {
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
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== a.name && save({ name })} />
        </label>
        <label className="field">
          <span>Nome del mittente</span>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} onBlur={() => displayName !== a.displayName && save({ displayName })} />
        </label>
      </div>
      <label className="field">
        <span>Firma</span>
        <textarea className="input" rows={2} value={signature} onChange={(e) => setSignature(e.target.value)} onBlur={() => signature !== a.signature && save({ signature })} />
      </label>
      {error && <div className="status error" role="alert"><span>{error}</span></div>}
      <div className="acct-card-foot">
        <div role="radiogroup" aria-label={`Colore di ${a.name}`} className="color-dots">
          {ACCOUNT_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={a.color === c} aria-label={c} style={{ background: c }} onClick={() => save({ color: c })} />
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
      </div>
      <div className="settings-list">
        <div className="setting-row">
          <Icon name="shield" size={18} />
          <span className="setting-text">
            <span className="setting-title">Nessun contenuto remoto</span>
            <span className="setting-desc">I messaggi si leggono come testo: immagini remote e pixel di tracciamento non vengono mai scaricati.</span>
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
      <Head title="Etichette" text="Le etichette restano su questo computer e valgono per tutti gli account. Si applicano dal pannello di lettura con L." />
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
