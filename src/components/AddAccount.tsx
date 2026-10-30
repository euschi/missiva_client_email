import { useRef, useState } from "react";
import { api, errorText } from "../api";
import { Icon } from "../icons";
import type { Account, Provider, Security, Server } from "../types";
import { CloseButton, Modal } from "./Modal";

interface Props {
  onClose: () => void;
  onAdded: (a: Account) => void;
}

const PROVIDERS: { id: Provider; name: string; sub: string; mono: string; bg: string; ink: string }[] = [
  { id: "google", name: "Google", sub: "Gmail e Google Workspace", mono: "G", bg: "#F4F1EA", ink: "#17171A" },
  { id: "microsoft", name: "Microsoft", sub: "Outlook.com, Microsoft 365, Exchange Online", mono: "M", bg: "#7AB0FF", ink: "#0E1A2E" },
  { id: "imap", name: "Altro · IMAP / SMTP", sub: "Qualsiasi server di posta standard", mono: "", bg: "#C7B5FF", ink: "#1E1636" },
];

const OAUTH = {
  google: { title: "Accedi con Google", brand: "Google", host: "accounts.google.com" },
  microsoft: { title: "Accedi con Microsoft", brand: "Microsoft", host: "login.microsoftonline.com" },
};

const PERIODS = [
  { days: 90, label: "90 giorni" },
  { days: 30, label: "30 giorni" },
  { days: 365, label: "12 mesi" },
  { days: 36500, label: "Tutto" },
];

function PeriodSelect({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <label className="inline-select">
      Scarica i messaggi degli ultimi
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {PERIODS.map((p) => (
          <option key={p.days} value={p.days}>{p.label}</option>
        ))}
      </select>
    </label>
  );
}

function ServerCard({ title, proto, value, onChange, firstRef }: { title: string; proto: string; value: Server; onChange: (s: Server) => void; firstRef?: React.Ref<HTMLInputElement> }) {
  return (
    <fieldset className="server-card">
      <legend>
        <span>{title}</span>
        <span>{proto}</span>
      </legend>
      <label className="field">
        <span>Server</span>
        <input ref={firstRef} className="input sm mono" type="text" value={value.host} onChange={(e) => onChange({ ...value, host: e.target.value.trim() })} required />
      </label>
      <div className="port-row">
        <label className="field">
          <span>Porta</span>
          <input className="input sm mono" type="text" inputMode="numeric" value={value.port || ""} onChange={(e) => onChange({ ...value, port: Number(e.target.value.replace(/\D/g, "")) })} required />
        </label>
        <label className="field">
          <span>Sicurezza</span>
          <select className="input sm" value={value.security} onChange={(e) => onChange({ ...value, security: e.target.value as Security })}>
            <option value="tls">SSL/TLS</option>
            <option value="starttls">STARTTLS</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}

export function AddAccount({ onClose, onAdded }: Props) {
  const [prov, setProv] = useState<Provider>("google");
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [imap, setImap] = useState<Server>({ host: "", port: 993, security: "tls" });
  const [smtp, setSmtp] = useState<Server>({ host: "", port: 465, security: "tls" });
  const [lookup, setLookup] = useState<{ domain: string; found: boolean } | "loading" | null>(null);
  const hostRef = useRef<HTMLInputElement>(null);

  const pick = (p: Provider) => {
    setProv(p);
    setError(null);
  };

  const detect = async () => {
    const domain = email.split("@")[1]?.trim();
    if (!domain || (lookup !== null && lookup !== "loading" && lookup.domain === domain)) return;
    setLookup("loading");
    const g = await api.autoconfig(email.trim());
    setImap(g.imap);
    setSmtp(g.smtp);
    setLookup({ domain, found: g.found });
  };

  const run = async (task: () => Promise<Account>) => {
    setBusy(true);
    setError(null);
    try {
      onAdded(await task());
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const oauth = prov !== "imap" ? OAUTH[prov] : null;

  return (
    <Modal label="Aggiungi account" onClose={onClose} short>
      <header className="window-head">
        <span className="window-title italic">Missiva</span>
        <CloseButton onClose={onClose} />
      </header>

      <div className="split">
        <aside className="split-side scroll">
          <div className="stack-10">
            <h1 className="display-title">Aggiungi<br />un account</h1>
            <p className="lead">Missiva riunisce tutte le caselle in un’unica posta in arrivo. Invio, firme e cartelle restano separati per ogni account.</p>
          </div>

          <div role="radiogroup" aria-label="Provider" className="providers">
            {PROVIDERS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={prov === p.id} className="provider" onClick={() => pick(p.id)} disabled={busy}>
                <span className="provider-tile" style={{ background: p.bg, color: p.ink }}>
                  {p.mono || <Icon name="server" size={18} />}
                </span>
                <span className="meta">
                  <span className="name">{p.name}</span>
                  <span className="sub">{p.sub}</span>
                </span>
                <span className="radio" />
              </button>
            ))}
          </div>

          <div className="keyring-note">
            <Icon name="lock" size={15} />
            <span>Password e token restano nel portachiavi di sistema (Secret Service: GNOME Keyring o KWallet), mai in chiaro su disco.</span>
          </div>
        </aside>

        <section className="split-main scroll">
          {oauth ? (
            <div className="oauth">
              <span className="shield">
                <Icon name="shield" size={24} stroke={1.7} />
              </span>
              <div className="stack-10">
                <h2 className="h2">{oauth.title}</h2>
                <p className="lead" style={{ fontSize: 14, lineHeight: 1.6 }}>
                  Si apre il browser per l’accesso sicuro (OAuth 2.0). Missiva non vede mai la tua password: riceve un token che puoi revocare in qualsiasi momento dalle impostazioni del tuo account {oauth.brand}.
                </p>
              </div>
              <fieldset className="setting" style={{ gap: 8 }}>
                <legend className="eyebrow" style={{ paddingBottom: 8 }}>Cosa sincronizzare</legend>
                <label className="scope">
                  <input type="checkbox" checked readOnly disabled />
                  <span className="label">Posta e cartelle</span>
                  <span className="note">IMAP + SMTP</span>
                </label>
                <PeriodSelect value={days} onChange={setDays} />
              </fieldset>
              {error && <div className="status error" role="alert"><span>{error}</span></div>}
              <div className="stack-10">
                <button type="button" className="btn btn-primary" style={{ alignSelf: "flex-start", height: 46 }} disabled={busy} onClick={() => run(() => api.addOauthAccount(prov, days))}>
                  {busy ? "In attesa del browser…" : "Continua nel browser"}
                  <Icon name="external" size={15} stroke={2} />
                </button>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-6)" }}>Si aprirà {oauth.host} nel browser predefinito</span>
              </div>
            </div>
          ) : (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => api.addImapAccount({ email: email.trim(), password, imap, smtp, syncDays: days }));
              }}
            >
              <div className="stack-6">
                <h2 className="h2 sm">Server IMAP e SMTP</h2>
                <p className="lead">Per domini propri, Fastmail, iCloud, provider italiani e qualsiasi server standard.</p>
              </div>

              <div className="grid-2">
                <label className="field">
                  <span>Indirizzo email</span>
                  <input className="input mono" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={detect} autoComplete="email" required autoFocus />
                </label>
                <label className="field">
                  <span>Password o password per app</span>
                  <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                </label>
              </div>

              {lookup === "loading" && (
                <div role="status" className="status info">
                  <Icon name="sync" size={16} className="spin" />
                  <span>Cerco la configurazione dei server…</span>
                </div>
              )}
              {lookup && lookup !== "loading" && (
                <div role="status" className={lookup.found ? "status ok" : "status info"}>
                  <Icon name={lookup.found ? "check" : "alert"} size={16} stroke={2.2} />
                  <span>
                    {lookup.found ? "Configurazione trovata automaticamente per " : "Nessuna configurazione nota per "}
                    <span className="mono">{lookup.domain}</span>
                    {lookup.found ? "" : ": controlla i server qui sotto"}
                  </span>
                  <button type="button" className="link-btn" onClick={() => hostRef.current?.focus()}>Modifica a mano</button>
                </div>
              )}

              <div className="grid-2">
                <ServerCard title="In arrivo" proto="IMAP" value={imap} onChange={setImap} firstRef={hostRef} />
                <ServerCard title="In uscita" proto="SMTP" value={smtp} onChange={setSmtp} />
              </div>

              {error && <div className="status error" role="alert"><span>{error}</span></div>}

              <div className="form-foot">
                <PeriodSelect value={days} onChange={setDays} />
                <div className="foot-actions">
                  <button type="button" className="btn btn-soft" onClick={onClose}>Annulla</button>
                  <button type="submit" className="btn btn-primary" disabled={busy || !email || !password || !imap.host || !smtp.host}>
                    {busy ? "Verifica in corso…" : "Connetti account"}
                    <Icon name="arrow" size={15} stroke={2.2} />
                  </button>
                </div>
              </div>
            </form>
          )}
        </section>
      </div>
    </Modal>
  );
}
