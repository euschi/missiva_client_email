import { useState } from "react";
import { api, errorText } from "../api";
import { Icon } from "../icons";
import type { Browser } from "../types";
import { CloseButton, Modal } from "./Modal";

interface Props {
  url: string;
  browsers: Browser[];
  onClose: () => void;
}

/** Il browser predefinito non ha aperto il link: si sceglie tra quelli installati o si copia l'indirizzo. */
export function LinkChooser({ url, browsers, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const open = (b: Browser) =>
    api
      .openLinkWith(b.id, url)
      .then(onClose)
      .catch((e) => setError(errorText(e)));

  const copy = () =>
    navigator.clipboard
      .writeText(url)
      .then(() => setCopied(true))
      .catch((e) => setError(errorText(e)));

  return (
    <Modal label="Apri il link" onClose={onClose} small>
      <header className="window-head">
        <span className="window-title">Con cosa apro il link?</span>
        <CloseButton onClose={onClose} />
      </header>
      <div className="link-chooser scroll">
        <p>Il browser predefinito non ha aperto questo indirizzo:</p>
        <code className="link-url">{url}</code>
        {browsers.length > 0 ? (
          <div className="link-browsers">
            {browsers.map((b) => (
              <button key={b.id} type="button" className="pop-item" onClick={() => open(b)}>
                {b.name}
                <Icon name="external" size={14} />
              </button>
            ))}
          </div>
        ) : (
          <p>Non ho trovato browser installati.</p>
        )}
        {error && <p className="link-error">{error}</p>}
        <div>
          <button type="button" className="btn btn-soft btn-sm" onClick={copy}>
            <Icon name={copied ? "check" : "link"} size={14} />
            {copied ? "Link copiato" : "Copia il link"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
