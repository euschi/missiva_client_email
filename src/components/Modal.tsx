import { useEffect, type ReactNode } from "react";
import { Icon } from "../icons";

interface Props {
  label: string;
  onClose: () => void;
  short?: boolean;
  /** Se falso, Esc e il clic sullo sfondo non chiudono (es. bozza con testo). */
  dismissable?: boolean;
  children: ReactNode;
}

/** Finestra secondaria (Scrivi, Aggiungi account, Impostazioni) sopra la finestra principale. */
export function Modal({ label, onClose, short, dismissable = true, children }: Props) {
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
      <div className={short ? "window short" : "window"} role="dialog" aria-modal="true" aria-label={label}>
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
