import { useEffect, useRef, useState } from "react";

// L'HTML del mittente gira in un iframe sandbox con origine opaca e una CSP propria: senza
// «Mostra immagini» non parte nessuna richiesta verso internet, e l'unico script ammesso è il nostro.
const FRAME_SCRIPT = new URL("mail-frame.js", new URL(import.meta.env.BASE_URL, location.href)).href;
const CSP_COMMON = `default-src 'none'; script-src ${FRAME_SCRIPT}; base-uri 'none'; form-action 'none'`;
const CSP_BLOCKED = `${CSP_COMMON}; img-src data: blob:; style-src 'unsafe-inline'; font-src data:`;
const CSP_REMOTE = `${CSP_COMMON}; img-src data: blob: https: http:; style-src 'unsafe-inline' https: http:; font-src data: https:`;

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
  `<style>${BASE_STYLE}</style><script src="${FRAME_SCRIPT}"></script></head><body>${lightOnly(html)}</body></html>`;

interface Props {
  html: string;
  remote: boolean;
  /** Clic su un link http(s). */
  onLink: (url: string) => void;
  /** Clic su un link mailto: apre la composizione verso quell'indirizzo. */
  onMailto: (address: string) => void;
}

/**
 * Messaggio HTML isolato. WebKitGTK non esegue i listener messi dal documento padre dentro un
 * iframe senza `allow-scripts`: clic e altezza arrivano quindi da public/mail-frame.js via postMessage.
 */
export function MailFrame({ html, remote, onLink, onMailto }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const handlers = useRef({ onLink, onMailto });
  handlers.current = { onLink, onMailto };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow || typeof e.data !== "object" || e.data === null) return;
      const { type, height: h, href } = e.data as { type?: unknown; height?: unknown; href?: unknown };
      if (type === "missiva-height" && typeof h === "number") setHeight(h);
      else if (type === "missiva-link" && typeof href === "string") {
        if (/^https?:/i.test(href)) handlers.current.onLink(href);
        else if (/^mailto:/i.test(href)) handlers.current.onMailto(mailtoAddress(href));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      className="mail-frame"
      title="Contenuto del messaggio"
      sandbox="allow-scripts"
      srcDoc={documentFor(html, remote)}
      style={{ height }}
    />
  );
}

/** Indirizzo di un link mailto:, tollerando le codifiche percentuali errate. */
function mailtoAddress(href: string) {
  const raw = href.slice(7).split("?")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
