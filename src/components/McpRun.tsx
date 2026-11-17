import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { Icon } from "../icons";
import { buildArgs, cachedTools, cacheTools, emailValues, fieldsOf, PLACEHOLDERS, resultView, suggestion, usedPlaceholders, type Field, type McpAction } from "../mcp";
import type { McpServer, McpTool, Message } from "../types";
import { CloseButton, Modal } from "./Modal";

interface Props {
  message: Message;
  /** Conversazione del messaggio, dal più vecchio: serve al segnaposto {{conversazione}}. */
  thread: Message[];
  actions: McpAction[];
  onActions: (actions: McpAction[]) => void;
  /** Azione rapida da eseguire subito all'apertura. */
  initial?: McpAction;
  onUseAsReply: (text: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** Ultimo server scelto, riproposto alla prossima apertura. */
let lastServer = "";

type Result = ReturnType<typeof resultView>;

/** Esegue uno strumento di un server MCP sul messaggio aperto. */
export function McpRun({ message, thread, actions, onActions, initial, onUseAsReply, onOpenSettings, onClose }: Props) {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [serverId, setServerId] = useState(initial?.serverId ?? "");
  const [tools, setTools] = useState<McpTool[] | null>(initial ? (cachedTools(initial.serverId) ?? [{ name: initial.tool, inputSchema: initial.schema }]) : null);
  /** Elenco con il solo strumento dell'azione rapida, finché non si caricano gli altri. */
  const [partial, setPartial] = useState(!!initial && !cachedTools(initial.serverId));
  const [toolName, setToolName] = useState(initial?.tool ?? "");
  const [templates, setTemplates] = useState<Record<string, string>>(initial?.args ?? {});
  const [busy, setBusy] = useState<"tools" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const request = useRef<string | null>(null);
  const focused = useRef<{ key: string; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const tool = tools?.find((t) => t.name === toolName);
  const schema = tool?.inputSchema ?? (initial?.tool === toolName ? initial.schema : undefined);
  const fields = fieldsOf(schema);
  const server = servers?.find((s) => s.id === serverId);

  /** Avvia un'operazione annullabile, fermando quella in corso; restituisce il suo id. */
  const begin = (kind: "tools" | "run") => {
    if (request.current) void api.mcpCancel(request.current);
    const id = crypto.randomUUID();
    request.current = id;
    setBusy(kind);
    setError(null);
    return id;
  };
  const end = (id: string) => {
    if (request.current !== id) return;
    request.current = null;
    setBusy(null);
  };

  const pickTools = (list: McpTool[]) => {
    setTools(list);
    setPartial(false);
    setToolName((cur) => (list.some((t) => t.name === cur) ? cur : ""));
  };

  const loadTools = async (id: string, force = false) => {
    const cached = cachedTools(id);
    if (cached && !force) return pickTools(cached);
    const req = begin("tools");
    try {
      const list = await api.mcpListTools(req, id);
      cacheTools(id, list);
      if (request.current === req) pickTools(list);
    } catch (e) {
      if (request.current === req) {
        setTools([]);
        setError(errorText(e));
      }
    } finally {
      end(req);
    }
  };

  async function run(sId: string, tName: string, fs: Field[], tpl: Record<string, string>) {
    setResult(null);
    setError(null);
    setCopied(false);
    let args: Record<string, unknown>;
    try {
      const values = await emailValues(message, thread, usedPlaceholders(Object.values(tpl)));
      const built = buildArgs(fs, tpl, values);
      if (built.problems.length) return setError(built.problems.join(" · "));
      args = built.args;
    } catch (e) {
      return setError(errorText(e));
    }
    const req = begin("run");
    try {
      const r = await api.mcpCallTool(req, sId, tName, args);
      if (request.current === req) setResult(resultView(r));
    } catch (e) {
      if (request.current === req) setError(errorText(e));
    } finally {
      end(req);
    }
  }

  useEffect(() => {
    api
      .mcpServers()
      .then((list) => {
        setServers(list);
        if (initial) return;
        const first = list.find((s) => s.id === lastServer) ?? list[0];
        if (first) {
          setServerId(first.id);
          void loadTools(first.id);
        }
      })
      .catch((e) => {
        setServers([]);
        setError(errorText(e));
      });
    if (initial) void run(initial.serverId, initial.tool, fieldsOf(initial.schema), initial.args);
    // Chiudere la finestra ferma l'operazione in corso (e il server locale).
    return () => {
      if (request.current) void api.mcpCancel(request.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [result, error]);

  const chooseServer = (id: string) => {
    setServerId(id);
    lastServer = id;
    setTools(null);
    setToolName("");
    setResult(null);
    if (id) void loadTools(id);
  };

  const chooseTool = (name: string) => {
    setToolName(name);
    setResult(null);
    setError(null);
    const t = tools?.find((x) => x.name === name);
    const next: Record<string, string> = {};
    for (const f of fieldsOf(t?.inputSchema)) next[f.key] = suggestion(f, t?.inputSchema);
    setTemplates(next);
    setSaveName(null);
  };

  const cancel = () => {
    const id = request.current;
    request.current = null;
    setBusy(null);
    if (id) void api.mcpCancel(id);
  };

  /** Inserisce un segnaposto nel campo dove era il cursore (o nel primo campo di testo). */
  const insert = (key: string) => {
    const fallback = fields.find((f) => f.type === "string" || f.type === "json");
    const target = focused.current ?? (fallback ? { key: fallback.key, el: null } : null);
    if (!target) return;
    const token = `{{${key}}}`;
    const cur = templates[target.key] ?? "";
    const el = target.el;
    const start = el?.selectionStart ?? cur.length;
    const stop = el?.selectionEnd ?? cur.length;
    setTemplates({ ...templates, [target.key]: cur.slice(0, start) + token + cur.slice(stop) });
    if (el)
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
  };

  const save = () => {
    const name = saveName?.trim();
    if (!name || !toolName || !schema) return;
    const old = actions.find((a) => a.name.toLowerCase() === name.toLowerCase());
    const action: McpAction = { id: old?.id ?? crypto.randomUUID(), name, serverId, tool: toolName, schema, args: templates };
    onActions(old ? actions.map((a) => (a.id === old.id ? action : a)) : [...actions, action]);
    setSaveName(null);
  };

  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch((e) => setError(errorText(e)));

  const subject = message.subject || "(nessun oggetto)";
  const canRun = !!serverId && !!tool && !busy;
  const hasServers = (servers?.length ?? 0) > 0 || !!initial;

  return (
    <Modal label="Azioni MCP" onClose={onClose} short>
      <header className="window-head">
        <span className="window-title">{initial ? initial.name : "Azioni MCP"}</span>
        <CloseButton onClose={onClose} />
      </header>

      <div className="ask-ai mcp-run">
        <div className="ask-ai-context">
          <Icon name="mail" size={15} stroke={1.8} />
          <span className="ask-ai-subject">{subject}</span>
          <span className="ask-ai-count">{message.fromEmail}</span>
        </div>

        <div className="ask-ai-log scroll">
          {servers === null && !initial && <p className="ask-ai-note">Carico i collegamenti…</p>}
          {servers?.length === 0 && !initial && (
            <div className="ask-ai-start">
              <p className="ask-ai-note">
                Non hai ancora collegamenti MCP. Aggiungi un server (un programma locale come <code>npx -y …</code> o un URL remoto) e potrai usarne gli strumenti su ogni email.
              </p>
              <div>
                <button type="button" className="btn btn-soft btn-sm" onClick={onOpenSettings}>
                  <Icon name="plug" size={14} stroke={1.8} />
                  Aggiungi un collegamento
                </button>
              </div>
            </div>
          )}

          {hasServers && (
            <>
              <div className="grid-2">
                <label className="field">
                  <span>Collegamento</span>
                  <select className="input" value={serverId} disabled={busy === "run"} onChange={(e) => chooseServer(e.target.value)}>
                    {!serverId && <option value="">Scegli…</option>}
                    {servers === null && initial && <option value={initial.serverId}>…</option>}
                    {servers?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Strumento</span>
                  <select className="input" value={toolName} disabled={!tools?.length || busy === "run"} onChange={(e) => chooseTool(e.target.value)}>
                    {!toolName && <option value="">{busy === "tools" ? "Carico…" : tools?.length === 0 ? "Nessuno strumento" : "Scegli…"}</option>}
                    {tools?.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.title || t.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mcp-links">
                {busy === "tools" ? (
                  <span className="ask-ai-wait">
                    <Icon name="sync" size={14} className="spin" />
                    Mi collego a {server?.name ?? "il server"}…
                    <button type="button" className="link-btn" onClick={cancel}>
                      Annulla
                    </button>
                  </span>
                ) : (
                  serverId &&
                  busy !== "run" && (
                    <button type="button" className="link-btn" onClick={() => loadTools(serverId, true)}>
                      {partial ? "Mostra tutti gli strumenti" : "Ricarica gli strumenti"}
                    </button>
                  )
                )}
              </div>

              {tool?.description && <p className="ask-ai-note mcp-desc">{tool.description}</p>}

              {tool && fields.length === 0 && <p className="ask-ai-note">Questo strumento non ha argomenti.</p>}
              {tool && fields.length > 0 && (
                <div className="mcp-fields">
                  {fields.map((f) => (
                    <FieldInput
                      key={f.key}
                      field={f}
                      value={templates[f.key] ?? ""}
                      disabled={busy === "run"}
                      onChange={(v) => setTemplates((t) => ({ ...t, [f.key]: v }))}
                      onFocus={(el) => (focused.current = { key: f.key, el })}
                    />
                  ))}
                  <div className="mcp-placeholders">
                    <span>Inserisci dall’email:</span>
                    <div className="chips">
                      {PLACEHOLDERS.map((p) => (
                        <button key={p.key} type="button" className="chip" title={p.label} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p.key)}>
                          {`{{${p.key}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {busy === "run" && (
            <div className="ask-ai-wait">
              <Icon name="sync" size={15} className="spin" />
              Eseguo {tool?.title || toolName} su {server?.name ?? "il server"}…
              <button type="button" className="link-btn" onClick={cancel}>
                Annulla
              </button>
            </div>
          )}
          {result && (
            <div className="ask-ai-turn">
              <div className={result.isError ? "mcp-result error" : "mcp-result"}>
                {result.isError && <strong>Lo strumento ha risposto con un errore</strong>}
                {result.text}
                {result.images.map((src, i) => (
                  <img key={i} src={src} alt="" />
                ))}
              </div>
              {result.text && (
                <div className="ask-ai-actions">
                  <button type="button" className="link-btn" onClick={() => copy(result.text)}>
                    {copied ? "Copiato" : "Copia"}
                  </button>
                  {!result.isError && (
                    <button type="button" className="link-btn" onClick={() => onUseAsReply(result.text)}>
                      Usa come risposta
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {error && <p className="link-error mcp-error">{error}</p>}
          <div ref={bottom} />
        </div>

        {hasServers && (
          <form className="ask-ai-form" onSubmit={(e) => (e.preventDefault(), canRun && void run(serverId, toolName, fields, templates))}>
            <div className="ask-ai-bar">
              {saveName === null ? (
                <button type="button" className="link-btn mcp-save" disabled={!tool} onClick={() => setSaveName(initial?.tool === toolName ? initial.name : tool?.title || tool?.name || "")}>
                  <Icon name="star" size={14} stroke={1.8} />
                  Salva come azione rapida
                </button>
              ) : (
                <span className="mcp-save-row">
                  <input
                    className="input sm"
                    autoFocus
                    aria-label="Nome dell’azione rapida"
                    placeholder="Nome dell’azione"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        save();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setSaveName(null);
                      }
                    }}
                  />
                  <button type="button" className="btn btn-soft btn-sm" disabled={!saveName.trim()} onClick={save}>
                    Salva
                  </button>
                </span>
              )}
              <button type="submit" className="btn btn-primary btn-sm" disabled={!canRun}>
                <Icon name="plug" size={14} stroke={1.8} />
                Esegui
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

function FieldInput({ field: f, value, disabled, onChange, onFocus }: { field: Field; value: string; disabled: boolean; onChange: (v: string) => void; onFocus: (el: HTMLInputElement | HTMLTextAreaElement) => void }) {
  const id = `mcp-field-${f.key}`;
  const hint = f.type === "json" ? "JSON" : f.type === "number" || f.type === "integer" ? "numero" : "";
  return (
    <div className="field">
      <label htmlFor={id} className="mcp-label">
        {f.label}
        {f.required && (
          <span className="mcp-required" title="Obbligatorio">
            {" "}
            *
          </span>
        )}
        {hint && <span className="mcp-hint">{hint}</span>}
      </label>
      {f.type === "enum" ? (
        <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">{f.required ? "Scegli…" : "(nessuno)"}</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : f.type === "boolean" ? (
        <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">(non indicato)</option>
          <option value="true">Sì</option>
          <option value="false">No</option>
        </select>
      ) : f.multiline ? (
        <textarea id={id} className={f.type === "json" ? "input mono" : "input"} rows={3} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} onFocus={(e) => onFocus(e.currentTarget)} />
      ) : (
        <input id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} onFocus={(e) => onFocus(e.currentTarget)} />
      )}
      {f.description && <small className="mcp-field-desc">{f.description}</small>}
    </div>
  );
}
