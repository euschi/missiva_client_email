import { useState } from "react";
import { api, errorText } from "../api";
import { monoOf } from "../format";
import { Icon, type IconName } from "../icons";
import { PRESETS, accentOf, inkFor, isHex, type Density, type Prefs, type Reader } from "../prefs";
import type { Account, AccountPatch } from "../types";
import { CloseButton, Modal } from "./Modal";

export type Section = "accounts" | "look";

const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: "accounts", label: "Account", icon: "user" },
  { id: "look", label: "Aspetto", icon: "palette" },
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
          {section === "look" ? <Look prefs={p.prefs} onPrefs={p.onPrefs} /> : <Accounts {...p} />}
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
