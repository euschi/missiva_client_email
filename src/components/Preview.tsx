import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
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
/** Livelli di zoom: 1 è il documento adattato alla finestra. */
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
/** Attesa prima di ridisegnare il PDF: i passaggi rapidi di zoom non rifanno ogni volta tutte le pagine. */
const PDF_REDRAW_MS = 200;
/** Oltre questi pixel per pagina si rinuncia a un po' di nitidezza per non esaurire la memoria. */
const PDF_MAX_PIXELS = 24_000_000;

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
  onSave: (index: number) => void;
  onClose: () => void;
}

/** Visore a tutto schermo per immagini, PDF e testo; per gli altri formati propone l'app predefinita. */
export function Preview({ message, files, index, onIndex, onOpenExternal, onSave, onClose }: Props) {
  const pos = Math.max(0, files.findIndex((f) => f.index === index));
  const file = files[pos];
  const [state, setState] = useState<{ bytes: ArrayBuffer } | { error: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const [zoom, setZoom] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const canZoom = kindOf(file) !== "other";

  const zoomIn = () => setZoom((z) => ZOOM_STEPS.find((step) => step > z) ?? z);
  const zoomOut = () => setZoom((z) => [...ZOOM_STEPS].reverse().find((step) => step < z) ?? z);

  // Lo stesso punto del documento resta al centro della finestra.
  const shownZoom = useRef(zoom);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const ratio = zoom / shownZoom.current;
    shownZoom.current = zoom;
    if (!body || ratio === 1) return;
    body.scrollLeft = (body.scrollLeft + body.clientWidth / 2) * ratio - body.clientWidth / 2;
    body.scrollTop = (body.scrollTop + body.clientHeight / 2) * ratio - body.clientHeight / 2;
  }, [zoom]);

  // Ctrl + rotellina: il listener non è passivo, altrimenti non potrebbe fermare lo scorrimento.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !canZoom) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    };
    body.addEventListener("wheel", onWheel, { passive: false });
    return () => body.removeEventListener("wheel", onWheel);
  }, [canZoom]);

  useEffect(() => {
    setState(null);
    setZoom(1);
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
      else if (canZoom && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        zoomIn();
      } else if (canZoom && e.key === "-") {
        e.preventDefault();
        zoomOut();
      } else if (canZoom && e.key === "0") {
        e.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files, pos, onIndex, onClose, canZoom]);

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
            {canZoom && (
              <div className="viewer-zoom" role="group" aria-label="Zoom">
                <button type="button" className="icon-btn" aria-label="Riduci" title="Riduci (-)" disabled={zoom === ZOOM_STEPS[0]} onClick={zoomOut}>
                  <Icon name="minimize" size={15} stroke={2.2} />
                </button>
                <button type="button" className="viewer-zoom-value" title="Adatta alla finestra (0)" aria-label={`Zoom ${Math.round(zoom * 100)}%: adatta alla finestra`} onClick={() => setZoom(1)}>
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" className="icon-btn" aria-label="Ingrandisci" title="Ingrandisci (+)" disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={zoomIn}>
                  <Icon name="plus" size={15} stroke={2.2} />
                </button>
              </div>
            )}
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
            <button type="button" className="btn btn-soft btn-sm" onClick={() => onSave(file.index)}>
              <Icon name="download" size={14} />
              Salva con nome
            </button>
            <button type="button" className="btn btn-soft btn-sm" onClick={external} disabled={opening}>
              <Icon name="external" size={14} />
              {opening ? "Apro…" : "Apri con l'app predefinita"}
            </button>
            <CloseButton onClose={onClose} />
          </div>
        </div>
        <div ref={bodyRef} className="viewer-body scroll">
          {kindOf(file) === "other" ? (
            <Unavailable text="Anteprima non disponibile per questo tipo di file." />
          ) : !state ? (
            <Unavailable text="Carico l'anteprima…" busy />
          ) : "error" in state ? (
            <Unavailable text={`Anteprima non riuscita: ${state.error}`} />
          ) : (
            <Content file={file} bytes={state.bytes} zoom={zoom} bodyRef={bodyRef} />
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

function Content({ file, bytes, zoom, bodyRef }: { file: Attachment; bytes: ArrayBuffer; zoom: number; bodyRef: RefObject<HTMLDivElement | null> }) {
  const kind = kindOf(file);
  const [url, setUrl] = useState<string | null>(null);
  // Larghezza e altezza con cui l'immagine entra nella finestra: sono il 100%.
  const [fitted, setFitted] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (kind !== "image") return;
    const made = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [bytes, file.mime, kind]);

  if (kind === "image") {
    if (!url) return null;
    return (
      <img
        className="viewer-image"
        src={url}
        alt={file.name}
        style={fitted && zoom !== 1 ? { width: fitted.width * zoom, height: fitted.height * zoom, maxWidth: "none", maxHeight: "none", flex: "0 0 auto" } : undefined}
        onLoad={(e) => {
          const body = bodyRef.current;
          if (!body) return;
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          // Il riquadro ha 16px di margine per lato.
          const scale = Math.min((body.clientWidth - 32) / w, (body.clientHeight - 32) / h, 1);
          setFitted({ width: w * scale, height: h * scale });
        }}
      />
    );
  }
  if (kind === "pdf") return <PdfView bytes={bytes} zoom={zoom} />;
  const text = new TextDecoder().decode(bytes.slice(0, TEXT_LIMIT));
  return (
    <pre className="viewer-text" style={{ fontSize: 13 * zoom }}>
      {text}
      {bytes.byteLength > TEXT_LIMIT && "\n\n… (file troncato nell'anteprima)"}
    </pre>
  );
}

/** Pagina del PDF già disposta: la sua larghezza a misura di finestra è il 100%. */
interface PdfPage {
  page: { getViewport: (o: { scale: number }) => unknown; render: (o: never) => { promise: Promise<void> } };
  baseWidth: number;
  baseHeight: number;
  fit: number;
  canvas: HTMLCanvasElement;
}

/** Disegna la pagina in una tela nuova e la sostituisce solo a lavoro finito: niente pagine bianche. */
async function drawPage(p: PdfPage, zoom: number) {
  const scale = p.fit * zoom;
  const pixels = p.baseWidth * p.baseHeight * scale * scale;
  const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(PDF_MAX_PIXELS / pixels));
  const viewport = p.page.getViewport({ scale }) as { width: number; height: number };
  const canvas = document.createElement("canvas");
  canvas.className = "pdf-page";
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = p.canvas.style.width;
  canvas.setAttribute("aria-label", p.canvas.getAttribute("aria-label") ?? "");
  await p.page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] } as never).promise;
  return canvas;
}

/** PDF disegnato pagina per pagina con pdf.js, caricato solo quando serve. */
function PdfView({ bytes, zoom }: { bytes: ArrayBuffer; zoom: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const pages = useRef<PdfPage[]>([]);
  const zoomNow = useRef(zoom);
  zoomNow.current = zoom;

  useEffect(() => {
    let cancelled = false;
    let destroy = () => {};
    pages.current = [];
    (async () => {
      const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      // pdf.js trasferisce il buffer al worker: gli si passa una copia.
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
      destroy = () => void task.destroy();
      const doc = await task.promise;
      const el = box.current;
      const body = el?.parentElement;
      if (!el || !body) return;
      const width = body.clientWidth - 64;
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const fit = Math.min(width / base.width, 2);
        const placeholder = document.createElement("canvas");
        placeholder.className = "pdf-page";
        placeholder.style.width = `${Math.floor(base.width * fit * zoomNow.current)}px`;
        placeholder.setAttribute("aria-label", `Pagina ${n} di ${doc.numPages}`);
        const entry: PdfPage = { page: page as unknown as PdfPage["page"], baseWidth: base.width, baseHeight: base.height, fit, canvas: placeholder };
        const drawn = await drawPage(entry, zoomNow.current);
        if (cancelled) return;
        drawn.style.width = `${Math.floor(base.width * fit * zoomNow.current)}px`;
        entry.canvas = drawn;
        el.appendChild(drawn);
        pages.current.push(entry);
      }
    })().catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
      destroy();
      pages.current = [];
      box.current?.replaceChildren();
    };
  }, [bytes]);

  // Subito la misura nuova (un attimo sfocata), così lo scorrimento resta allineato.
  useLayoutEffect(() => {
    for (const p of pages.current) p.canvas.style.width = `${Math.floor(p.baseWidth * p.fit * zoom)}px`;
  }, [zoom]);

  // Poi la nitidezza: prima le pagine più vicine a quella che si sta guardando.
  const drawnZoom = useRef(zoom);
  useEffect(() => {
    if (drawnZoom.current === zoom) return;
    let stale = false;
    const t = setTimeout(async () => {
      drawnZoom.current = zoom;
      const middle = window.innerHeight / 2;
      const distance = (p: PdfPage) => {
        const r = p.canvas.getBoundingClientRect();
        return Math.abs((r.top + r.bottom) / 2 - middle);
      };
      for (const p of [...pages.current].sort((a, b) => distance(a) - distance(b))) {
        if (stale) return;
        // Un PDF chiuso a metà ridisegno interrompe il lavoro: non è un errore da mostrare.
        const drawn = await drawPage(p, zoom).catch(() => null);
        if (stale || !drawn || !p.canvas.isConnected) continue;
        drawn.style.width = p.canvas.style.width;
        p.canvas.replaceWith(drawn);
        p.canvas = drawn;
      }
    }, PDF_REDRAW_MS);
    return () => {
      stale = true;
      clearTimeout(t);
      // Un ridisegno lasciato a metà va rifatto anche se si torna a questo livello.
      drawnZoom.current = Number.NaN;
    };
  }, [zoom]);

  if (error) return <Unavailable text={`PDF non leggibile: ${error}`} />;
  return <div ref={box} className="pdf-pages" />;
}
