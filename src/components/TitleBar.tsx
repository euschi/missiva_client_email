import type { RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "../api";
import { plural } from "../format";
import { Icon } from "../icons";

interface Props {
  accountCount: number;
  query: string;
  onQuery: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  syncing: boolean;
  syncLabel: string;
  syncError: boolean;
  onSync: () => void;
}

const win = () => (inTauri ? getCurrentWindow() : null);

/** Barra del titolo disegnata dall'app (CSD): trascinabile, con ricerca e controlli finestra. */
export function TitleBar({ accountCount, query, onQuery, searchRef, syncing, syncLabel, syncError, onSync }: Props) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-side" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <span className="brand-name">Missiva</span>
          <span className="brand-meta">{plural(accountCount, "account", "account")}</span>
        </div>
      </div>

      <label className="search">
        <Icon name="search" />
        <input
          ref={searchRef}
          type="search"
          aria-label="Cerca in tutti gli account"
          placeholder="Cerca in tutti gli account — persone, oggetti, testo"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (onQuery(""), e.currentTarget.blur())}
        />
        <span className="search-keys">
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
        </span>
      </label>

      <div className="titlebar-side end" data-tauri-drag-region>
        <div className="sync">
          <button
            type="button"
            className={syncing ? "icon-btn busy" : "icon-btn"}
            onClick={onSync}
            disabled={syncing}
            aria-label="Sincronizza ora tutti gli account"
            title="Sincronizza ora tutti gli account · F5"
          >
            <Icon name="sync" size={15} stroke={1.9} className={syncing ? "spin" : undefined} />
          </button>
          <span role="status" className={syncError ? "sync-label error" : "sync-label"}>
            <span className="dot" />
            {syncLabel}
          </span>
        </div>
        <button type="button" className="icon-btn round" aria-label="Riduci a icona" onClick={() => win()?.minimize()}>
          <Icon name="minimize" size={14} stroke={2} />
        </button>
        <button type="button" className="icon-btn round" aria-label="Massimizza" onClick={() => win()?.toggleMaximize()}>
          <Icon name="maximize" size={13} stroke={2} />
        </button>
        <button type="button" className="icon-btn round filled" aria-label="Chiudi" onClick={() => win()?.close()}>
          <Icon name="close" size={13} stroke={2} />
        </button>
      </div>
    </header>
  );
}
