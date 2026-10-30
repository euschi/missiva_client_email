import { useEffect, useRef, useState, type ReactNode } from "react";
import { longTime } from "../format";
import { Icon } from "../icons";
import { LABEL_COLORS, type Label } from "../store";
import { localInput, presets, unix } from "../when";

interface PopoverProps {
  label: string;
  onClose: () => void;
  /** "up" si apre sopra l'ancora, "end" si allinea al bordo destro. */
  placement?: ("up" | "end")[];
  children: ReactNode;
}

/** Menu a comparsa ancorato al genitore (che deve avere position: relative). */
export function Popover({ label, onClose, placement = [], children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // Il clic sull'ancora lo gestisce già il pulsante che apre e chiude.
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={["popover", ...placement].join(" ")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

/** Scelte rapide di data e ora più una data a piacere. */
export function WhenPicker({ title, onPick }: { title: string; onPick: (at: number) => void }) {
  const [custom, setCustom] = useState(false);
  const min = new Date(Date.now() + 60_000);
  const [value, setValue] = useState(localInput(new Date(Date.now() + 3_600_000)));
  const picked = new Date(value);
  const valid = !Number.isNaN(picked.getTime()) && picked > min;
  return (
    <>
      <span className="pop-title">{title}</span>
      {presets().map((p) => (
        <button key={p.label} type="button" className="pop-item" onClick={() => onPick(unix(p.at))}>
          <span>{p.label}</span>
          <span className="pop-hint">{longTime(unix(p.at))}</span>
        </button>
      ))}
      {custom ? (
        <form
          className="pop-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onPick(unix(picked));
          }}
        >
          <label className="sr-only" htmlFor="when-custom">Data e ora</label>
          <input id="when-custom" type="datetime-local" value={value} min={localInput(min)} onChange={(e) => setValue(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!valid}>
            Conferma
          </button>
        </form>
      ) : (
        <button type="button" className="pop-item" onClick={() => setCustom(true)}>
          <span>Scegli data e ora…</span>
          <Icon name="calendar" size={15} stroke={1.8} />
        </button>
      )}
    </>
  );
}

interface LabelPickerProps {
  labels: Label[];
  selected: string[];
  onToggle: (id: string) => void;
  onCreate: (name: string) => void;
}

export function LabelPicker({ labels, selected, onToggle, onCreate }: LabelPickerProps) {
  const [name, setName] = useState("");
  const existing = labels.find((l) => l.name.toLowerCase() === name.trim().toLowerCase());
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    if (existing) {
      if (!selected.includes(existing.id)) onToggle(existing.id);
    } else onCreate(n);
    setName("");
  };
  return (
    <>
      <span className="pop-title">Etichette</span>
      <form className="pop-custom" onSubmit={(e) => (e.preventDefault(), submit())}>
        <label className="sr-only" htmlFor="label-new">Nuova etichetta</label>
        <input id="label-new" type="text" placeholder="Nuova etichetta…" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-soft btn-sm" disabled={!name.trim()}>
          {existing ? "Applica" : "Crea"}
        </button>
      </form>
      {labels.length === 0 && <span className="pop-empty">Nessuna etichetta: scrivi un nome e premi Invio.</span>}
      {labels.map((l) => {
        const on = selected.includes(l.id);
        return (
          <button key={l.id} type="button" role="menuitemcheckbox" aria-checked={on} className="pop-item" onClick={() => onToggle(l.id)}>
            <span className="label-name">
              <i className="label-dot" style={{ background: l.color }} />
              {l.name}
            </span>
            {on && <Icon name="check" size={15} stroke={2.2} className="option-check" />}
          </button>
        );
      })}
    </>
  );
}

export const nextLabelColor = (labels: Label[]) => LABEL_COLORS[labels.length % LABEL_COLORS.length];

/** Etichette di un messaggio, compatte (elenco) o piene (pannello di lettura). */
export function LabelChips({ labels, small }: { labels: Label[]; small?: boolean }) {
  if (labels.length === 0) return null;
  return (
    <span className={small ? "label-chips small" : "label-chips"}>
      {labels.map((l) => (
        <span key={l.id} className="label-chip" style={{ ["--label" as string]: l.color }}>
          <i className="label-dot" />
          {l.name}
        </span>
      ))}
    </span>
  );
}
