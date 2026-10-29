import { monoOf, providerLabel } from "../format";
import { Icon, type IconName } from "../icons";
import type { Account } from "../types";

export type View = "inbox" | "flagged" | "drafts" | "sent" | "archive" | "trash";

export const VIEWS: { id: View; label: string; icon: IconName }[] = [
  { id: "inbox", label: "Posta in arrivo", icon: "inbox" },
  { id: "flagged", label: "Contrassegnati", icon: "star" },
  { id: "drafts", label: "Bozze", icon: "draft" },
  { id: "sent", label: "Inviati", icon: "send" },
  { id: "archive", label: "Archivio", icon: "archive" },
  { id: "trash", label: "Cestino", icon: "trash" },
];

interface Props {
  accounts: Account[];
  view: View;
  onView: (v: View) => void;
  accountFilter: string;
  onAccountFilter: (id: string) => void;
  counts: Partial<Record<View, number>>;
  unreadByAccount: Record<string, number>;
  errors: Record<string, string>;
  onCompose: () => void;
  onAddAccount: () => void;
  onSettings: () => void;
}

const show = (n: number | undefined) => (n ? String(n) : "");

export function Sidebar(p: Props) {
  const totalUnread = Object.values(p.unreadByAccount).reduce((a, b) => a + b, 0);
  return (
    <nav aria-label="Caselle e account" className="sidebar scroll">
      <button type="button" className="btn btn-primary compose-btn" onClick={p.onCompose} disabled={p.accounts.length === 0}>
        <span>
          <Icon name="pen" size={17} stroke={2} />
          Scrivi
        </span>
        <kbd>C</kbd>
      </button>

      <div className="nav">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className="nav-item"
            aria-current={p.view === v.id}
            onClick={() => p.onView(v.id)}
          >
            <Icon name={v.icon} size={17} stroke={1.7} />
            <span className="label">{v.label}</span>
            <span className="count">{show(p.counts[v.id])}</span>
          </button>
        ))}
      </div>

      <div className="accounts">
        <div className="section-head">
          <span className="eyebrow">Account</span>
          <button type="button" className="icon-btn" aria-label="Aggiungi account" onClick={p.onAddAccount}>
            <Icon name="plus" size={15} stroke={2} />
          </button>
        </div>
        {p.accounts.length > 1 && (
          <button
            type="button"
            className="acct-row all"
            aria-current={p.accountFilter === "all"}
            onClick={() => p.onAccountFilter("all")}
          >
            <span className="stack" aria-hidden="true">
              {p.accounts.slice(0, 3).map((a) => (
                <span key={a.id} style={{ background: a.color }} />
              ))}
            </span>
            <span className="meta">
              <span className="name">Tutti gli account</span>
            </span>
            <span className="count">{show(totalUnread)}</span>
          </button>
        )}
        {p.accounts.map((a) => {
          const error = p.errors[a.id];
          return (
            <button
              key={a.id}
              type="button"
              className={error ? "acct-row error" : "acct-row"}
              aria-current={p.accountFilter === a.id}
              onClick={() => p.onAccountFilter(a.id)}
              title={error ? `Errore di sincronizzazione: ${error}` : a.email}
            >
              <span className="mono-tile" style={{ background: a.color }}>
                {monoOf(a.name)}
              </span>
              <span className="meta">
                <span className="name">{a.name}</span>
                <span className="sub">{error ? "Errore di sincronizzazione" : providerLabel(a.provider, a.imap.host)}</span>
              </span>
              <span className="count">{show(p.unreadByAccount[a.id])}</span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-foot">
        <button type="button" className="nav-item" onClick={p.onAddAccount}>
          <Icon name="plus" size={17} stroke={1.7} />
          Aggiungi account
        </button>
        <button type="button" className="nav-item" onClick={p.onSettings}>
          <Icon name="sliders" size={17} stroke={1.7} />
          Impostazioni
        </button>
      </div>
    </nav>
  );
}
