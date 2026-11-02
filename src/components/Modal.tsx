import { useEffect, type ReactNode } from "react";
import { Icon } from "../icons";

interface Props {
  label: string;
  onClose: () => void;
  short?: boolean;
  /** Finestra piccola, alta quanto il contenuto. */
  small?: boolean;
  /** Se falso, Esc e il clic sullo sfondo non chiudono (es. bozza con testo). */
  dismissable?: boolean;
  children: ReactNode;
}

/** Finestra secondaria (Scrivi, Aggiungi account, Impostazioni) sopra la finestra principale. */
export function Modal({ label, onClose, short, small, dismissable = true, children }: Props) {
  useEffect(() => {
    if (!dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dismissable]);

  return (
    <div className="overlay" onMouseDown={(e) => dismissable && e.target === e.currentTarget && onClose()}>
      <div className={small ? "window small" : short ? "window short" : "window"} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClose, label = "Chiudi" }: { onClose: () => void; label?: string }) {
  return (
    <button type="button" className="icon-btn round filled" aria-label={label} onClick={onClose}>
      <Icon name="close" size={13} stroke={2} />
    </button>
  );
}

interface ConfirmProps {
  title: string;
  text: string;
  action: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** Conferma di un'azione che non si può annullare. */
export function Confirm({ title, text, action, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal label={title} onClose={onClose} small>
      <header className="window-head">
        <span className="window-title">{title}</span>
        <CloseButton onClose={onClose} />
      </header>
      <div className="confirm-body">
        <p>{text}</p>
        <div className="confirm-actions">
          <button type="button" className="btn btn-soft btn-sm" autoFocus onClick={onClose}>
            Annulla
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm}>
            {action}
          </button>
        </div>
      </div>
    </Modal>
  );
}
