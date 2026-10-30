import { useEffect, useRef, useState } from "react";
import { api } from "../api";

// L'HTML del mittente gira in un iframe senza script (sandbox) con una CSP propria:
// senza «Mostra immagini» non parte nessuna richiesta verso internet.
const CSP_BLOCKED = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";
const CSP_REMOTE = "default-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline' https: http:; font-src data: https:";

// Colori e font di base su <html>: un body con bgcolor/text o stili propri li sostituisce.
const BASE_STYLE =
  "html{color-scheme:light;background:#fff;color:#1d1d1f;font:15px/1.6 system-ui,sans-serif}" +
  "body{margin:0;padding:16px 20px;overflow-wrap:anywhere}" +
  "img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}";

/**
 * Il riquadro è sempre chiaro: le regole «modalità scura» del mittente (testo bianco
 * pensato per uno sfondo scuro) renderebbero il testo invisibile, quindi non devono scattare.
 */
const lightOnly = (html: string) => html.replace(/prefers-color-scheme\s*:\s*dark/gi, "prefers-color-scheme: missiva-light");

const documentFor = (html: string, remote: boolean) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="${remote ? CSP_REMOTE : CSP_BLOCKED}">` +
  `<style>${BASE_STYLE}</style></head><body>${lightOnly(html)}</body></html>`;

interface Props {
  html: string;
  remote: boolean;
  /** Clic su un link mailto: apre la composizione verso quell'indirizzo. */
  onMailto: (address: string) => void;
}

/** Messaggio HTML isolato: si adatta in altezza al contenuto, i link si aprono nel browser di sistema. */
export function MailFrame({ html, remote, onMailto }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const cleanup = useRef<() => void>(() => {});
  const mailto = useRef(onMailto);
  mailto.current = onMailto;

  useEffect(() => () => cleanup.current(), []);

  const onLoad = () => {
    cleanup.current();
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    const measure = () => setHeight(Math.ceil(doc.documentElement.scrollHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(doc.documentElement);
    // Le immagini cambiano l'altezza man mano che arrivano.
    doc.addEventListener("load", measure, true);
    const timers = [300, 1200].map((ms) => window.setTimeout(measure, ms));
    const onClick = (e: MouseEvent) => {
      // Il target appartiene al documento dell'iframe: niente instanceof Element.
      const link = (e.target as { closest?: (s: string) => HTMLAnchorElement | null } | null)?.closest?.("a[href]");
      if (!link) return;
      e.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (/^https?:/i.test(href)) api.openLink(href).catch(() => {});
      else if (/^mailto:/i.test(href)) mailto.current(decodeURIComponent(href.slice(7).split("?")[0]));
    };
    doc.addEventListener("click", onClick);
    cleanup.current = () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
      doc.removeEventListener("load", measure, true);
      doc.removeEventListener("click", onClick);
    };
  };

  return (
    <iframe
      ref={ref}
      className="mail-frame"
      title="Contenuto del messaggio"
      sandbox="allow-same-origin"
      srcDoc={documentFor(html, remote)}
      style={{ height }}
      onLoad={onLoad}
    />
  );
}
