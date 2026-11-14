import { useEffect, useRef, useState, type MouseEvent } from "react";
import { buildPrompt, conversationText, readable, type Turn } from "../aiprompt";
import { api, errorText } from "../api";
import { plural } from "../format";
import { Icon } from "../icons";
import { toHtml } from "../markdown";
import type { AiAgent, Message } from "../types";
import { CloseButton, Modal } from "./Modal";

interface Props {
  /** Conversazione da mandare, dal messaggio più vecchio. */
  thread: Message[];
  /** Ultimo agente usato, da riproporre. */
  lastAgent: string;
  onAgent: (id: string) => void;
  /** Apre Scrivi con la risposta come testo. */
  onUseAsReply: (text: string) => void;
  /** Link nella risposta: si aprono come quelli delle email. */
  onLink: (url: string, text: string) => void;
  onClose: () => void;
}

const SUGGESTIONS = ["Spiegami cosa vuole dire", "Cosa devo fare dopo?", "Riassumi la conversazione", "Prepara una bozza di risposta"];

/** Risposta dell'agente come HTML: i titoli markdown diventano grassetto, il resto lo fa `toHtml`. */
const answerHtml = (text: string) => toHtml(text.replace(/^#{1,6}\s+(.+)$/gm, "**$1**"));

/** «Chiedi all'AI»: domande su una conversazione a un agente AI installato sul computer. */
export function AskAi({ thread, lastAgent, onAgent, onUseAsReply, onLink, onClose }: Props) {
  const [agents, setAgents] = useState<AiAgent[] | null>(null);
  const [agent, setAgent] = useState(lastAgent);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withFiles, setWithFiles] = useState(true);
  const [copied, setCopied] = useState<number | null>(null);
  const request = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // Il testo della conversazione si prepara una volta sola: gli allegati vanno letti e convertiti.
  const texts = useRef(new Map<boolean, Promise<string>>());

  const files = thread.flatMap((m) => m.attachments.filter(readable));
  const subject = thread[0]?.subject.replace(/^((re|r|fwd?|i)\s*:\s*)+/i, "") || "(nessun oggetto)";

  useEffect(() => {
    api
      .listAiAgents()
      .then((list) => {
        setAgents(list);
        setAgent((cur) => (list.some((a) => a.id === cur) ? cur : (list[0]?.id ?? "")));
      })
      .catch((e) => {
        setAgents([]);
        setError(errorText(e));
      });
  }, []);

  // Chiudere la finestra ferma l'agente che sta ancora rispondendo.
  useEffect(
    () => () => {
      if (request.current) void api.cancelAi(request.current);
    },
    [],
  );

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [history.length, pending, error]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || pending || !agent) return;
    const id = crypto.randomUUID();
    request.current = id;
    setPending(q);
    setError(null);
    setQuestion("");
    onAgent(agent);
    try {
      const include = withFiles && files.length > 0;
      let conversation = texts.current.get(include);
      if (!conversation) {
        conversation = conversationText(thread, include);
        texts.current.set(include, conversation);
      }
      const answer = await api.askAi(id, agent, buildPrompt(await conversation, history, q));
      if (request.current !== id) return;
      setHistory((h) => [...h, { question: q, answer }]);
    } catch (e) {
      if (request.current !== id) return;
      setError(errorText(e));
      setQuestion(q);
    } finally {
      if (request.current === id) {
        request.current = null;
        setPending(null);
      }
    }
  };

  const cancel = () => {
    const id = request.current;
    request.current = null;
    setPending(null);
    if (id) void api.cancelAi(id);
  };

  const copy = (i: number, text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(i))
      .catch((e) => setError(errorText(e)));

  // I link nella risposta non devono aprirsi dentro la finestra dell'app.
  const onAnswerClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) onLink(href, a.textContent ?? href);
  };

  const current = agents?.find((a) => a.id === agent);

  return (
    <Modal label="Chiedi all’AI" onClose={onClose} short>
      <header className="window-head">
        <span className="window-title">Chiedi all’AI</span>
        <CloseButton onClose={onClose} />
      </header>

      <div className="ask-ai">
        <div className="ask-ai-context">
          <Icon name="mail" size={15} stroke={1.8} />
          <span className="ask-ai-subject">{subject}</span>
          <span className="ask-ai-count">{plural(thread.length, "messaggio", "messaggi")}</span>
        </div>

        <div className="ask-ai-log scroll" onClick={onAnswerClick}>
          {agents === null && <p className="ask-ai-note">Cerco gli agenti AI installati…</p>}
          {agents?.length === 0 && (
            <p className="ask-ai-note">
              Non ho trovato agenti AI installati. Missiva sa usare <strong>Claude Code</strong> (<code>claude</code>), <strong>Codex</strong> (<code>codex</code>) e{" "}
              <strong>Gemini CLI</strong> (<code>gemini</code>): installane uno, fai l’accesso dal terminale e riapri questa finestra.
            </p>
          )}
          {agents && agents.length > 0 && history.length === 0 && !pending && (
            <div className="ask-ai-start">
              <p className="ask-ai-note">
                La conversazione{files.length > 0 && withFiles ? " e il testo degli allegati" : ""} va a {current?.name ?? "l’agente"}, che risponde senza poter eseguire comandi né
                leggere i tuoi file.
              </p>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {history.map((t, i) => (
            <div key={i} className="ask-ai-turn">
              <div className="ask-ai-question">{t.question}</div>
              <div className="ask-ai-answer" dangerouslySetInnerHTML={{ __html: answerHtml(t.answer) }} />
              <div className="ask-ai-actions">
                <button type="button" className="link-btn" onClick={() => copy(i, t.answer)}>
                  {copied === i ? "Copiato" : "Copia"}
                </button>
                <button type="button" className="link-btn" onClick={() => onUseAsReply(t.answer)}>
                  Usa come risposta
                </button>
              </div>
            </div>
          ))}
          {pending && (
            <div className="ask-ai-turn">
              <div className="ask-ai-question">{pending}</div>
              <div className="ask-ai-wait">
                <Icon name="sync" size={15} className="spin" />
                {current?.name ?? "L’agente"} sta rispondendo…
                <button type="button" className="link-btn" onClick={cancel}>
                  Annulla
                </button>
              </div>
            </div>
          )}
          {error && <p className="link-error">{error}</p>}
          <div ref={bottom} />
        </div>

        <form className="ask-ai-form" onSubmit={(e) => (e.preventDefault(), void ask(question))}>
          <label className="sr-only" htmlFor="ask-ai-question">
            Domanda
          </label>
          <textarea
            id="ask-ai-question"
            className="input"
            rows={2}
            autoFocus
            placeholder={history.length ? "Fai un’altra domanda…" : "Es. «mi spieghi cosa vuole dire?» oppure «cosa devo fare dopo?»"}
            value={question}
            disabled={!agents?.length}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              // Invio chiede, Maiusc+Invio va a capo.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
          />
          <div className="ask-ai-bar">
            {agents && agents.length > 0 && (
              <label>
                <span className="sr-only">Agente AI</span>
                <select className="input sm" value={agent} disabled={!!pending} onChange={(e) => setAgent(e.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {files.length > 0 && (
              <label className="ask-ai-files">
                <input type="checkbox" checked={withFiles} disabled={!!pending} onChange={(e) => setWithFiles(e.target.checked)} />
                Includi il testo {files.length === 1 ? "dell’allegato" : `dei ${files.length} allegati`}
              </label>
            )}
            <button type="submit" className="btn btn-primary btn-sm" disabled={!question.trim() || !!pending || !agent}>
              <Icon name="send" size={14} />
              Chiedi
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
