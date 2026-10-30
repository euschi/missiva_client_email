import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { fileSize } from "../format";
import { Icon } from "../icons";
import type { Attachment, Message } from "../types";
import { CloseButton } from "./Modal";

type Kind = "image" | "pdf" | "text" | "other";

const kindOf = (f: Attachment): Kind =>
  f.mime.startsWith("image/") ? "image" : f.mime === "application/pdf" ? "pdf" : /^text\/|\/json$|\/xml$/.test(f.mime) ? "text" : "other";

/** Oltre questa dimensione il testo si mostra troncato. */
const TEXT_LIMIT = 200_000;
/** Le miniature si caricano solo per immagini non troppo grandi. */
const THUMB_LIMIT = 8_000_000;

export const canPreview = (f: Attachment) => kindOf(f) !== "other";
export const isImage = (f: Attachment) => kindOf(f) === "image";

/** Miniatura di un'immagine allegata, caricata quando serve. */
export function Thumb({ message, file }: { message: Message; file: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file.size > THUMB_LIMIT) return;
    let gone = false;
    let made: string | null = null;
    api
      .attachmentBytes(message, file.index)
      .then((bytes) => {
        if (gone) return;
        made = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [message, file]);
  return url ? <img className="attach-thumb" src={url} alt="" /> : <span className="file-tile">{file.kind}</span>;
}

interface Props {
  message: Message;
  /** Allegati sfogliabili con ← e →. */
  files: Attachment[];
  index: number;
  onIndex: (index: number) => void;
  onOpenExternal: (index: number) => Promise<void>;
  onClose: () => void;
}

/** Visore a tutto schermo per immagini, PDF e testo; per gli altri formati propone l'app predefinita. */
export function Preview({ message, files, index, onIndex, onOpenExternal, onClose }: Props) {
  const pos = Math.max(0, files.findIndex((f) => f.index === index));
  const file = files[pos];
  const [state, setState] = useState<{ bytes: ArrayBuffer } | { error: string } | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    setState(null);
    if (kindOf(file) === "other") return;
    let gone = false;
    api
      .attachmentBytes(message, file.index)
      .then((bytes) => !gone && setState({ bytes }))
      .catch((e) => !gone && setState({ error: errorText(e) }));
    return () => {
      gone = true;
    };
  }, [message, file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && pos > 0) onIndex(files[pos - 1].index);
      else if (e.key === "ArrowRight" && pos < files.length - 1) onIndex(files[pos + 1].index);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files, pos, onIndex, onClose]);

  const external = async () => {
    setOpening(true);
    await onOpenExternal(file.index);
    setOpening(false);
  };

  return (
    <div className="overlay viewer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="viewer" role="dialog" aria-modal="true" aria-label={`Anteprima di ${file.name}`}>
        <div className="window-head">
          <div className="window-head-title">
            <span className="viewer-name">{file.name}</span>
            <span className="window-meta">
              {fileSize(file.size)}
              {files.length > 1 && ` · ${pos + 1} di ${files.length}`}
            </span>
          </div>
          <div className="viewer-actions">
            {files.length > 1 && (
              <>
                <button type="button" className="icon-btn" aria-label="Allegato precedente" disabled={pos === 0} onClick={() => onIndex(files[pos - 1].index)}>
                  <Icon name="chevron" size={16} stroke={2} className="rot-90" />
                </button>
                <button type="button" className="icon-btn" aria-label="Allegato successivo" disabled={pos === files.length - 1} onClick={() => onIndex(files[pos + 1].index)}>
                  <Icon name="chevron" size={16} stroke={2} className="rot-270" />
                </button>
              </>
            )}
            <button type="button" className="btn btn-soft btn-sm" onClick={external} disabled={opening}>
              <Icon name="external" size={14} />
              {opening ? "Apro…" : "Apri con l'app predefinita"}
            </button>
            <CloseButton onClose={onClose} />
          </div>
        </div>
        <div className="viewer-body scroll">
          {kindOf(file) === "other" ? (
            <Unavailable text="Anteprima non disponibile per questo tipo di file." />
          ) : !state ? (
            <Unavailable text="Carico l'anteprima…" busy />
          ) : "error" in state ? (
            <Unavailable text={`Anteprima non riuscita: ${state.error}`} />
          ) : (
            <Content file={file} bytes={state.bytes} />
          )}
        </div>
      </div>
    </div>
  );
}

function Unavailable({ text, busy }: { text: string; busy?: boolean }) {
  return (
    <div className="viewer-empty">
      <Icon name={busy ? "sync" : "clip"} size={22} className={busy ? "spin" : undefined} />
      <span>{text}</span>
    </div>
  );
}

function Content({ file, bytes }: { file: Attachment; bytes: ArrayBuffer }) {
  const kind = kindOf(file);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== "image") return;
    const made = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [bytes, file.mime, kind]);

  if (kind === "image") return url ? <img className="viewer-image" src={url} alt={file.name} /> : null;
  if (kind === "pdf") return <PdfView bytes={bytes} />;
  const text = new TextDecoder().decode(bytes.slice(0, TEXT_LIMIT));
  return (
    <pre className="viewer-text">
      {text}
      {bytes.byteLength > TEXT_LIMIT && "\n\n… (file troncato nell'anteprima)"}
    </pre>
  );
}

/** PDF disegnato pagina per pagina con pdf.js, caricato solo quando serve. */
function PdfView({ bytes }: { bytes: ArrayBuffer }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let destroy = () => {};
    (async () => {
      const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      // pdf.js trasferisce il buffer al worker: gli si passa una copia.
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
      destroy = () => void task.destroy();
      const doc = await task.promise;
      const el = box.current;
      if (!el) return;
      const width = el.clientWidth - 32;
      const ratio = window.devicePixelRatio || 1;
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(width / base.width, 2) });
        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page";
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.setAttribute("aria-label", `Pagina ${n} di ${doc.numPages}`);
        el.appendChild(canvas);
        await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
      }
    })().catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
      destroy();
      box.current?.replaceChildren();
    };
  }, [bytes]);

  if (error) return <Unavailable text={`PDF non leggibile: ${error}`} />;
  return <div ref={box} className="pdf-pages" />;
}
