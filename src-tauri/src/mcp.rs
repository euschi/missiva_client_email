//! Collegamenti MCP (Model Context Protocol): server configurati dall'utente, di cui Missiva elenca
//! gli strumenti e li esegue sulle email.
//!
//! Due trasporti: un programma locale che parla JSON-RPC su stdin/stdout, oppure un URL remoto
//! «Streamable HTTP». Ogni operazione apre una sessione, la usa e la chiude: niente processi che
//! restano accesi in background.
//!
//! La configurazione sta in `~/.config/missiva/mcp.json`; variabili d'ambiente e header (spesso
//! chiavi di accesso) stanno nel portachiavi di sistema.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Notify;

use crate::error::{msg, Result};

/// Versione del protocollo proposta al server; se ne supporta un'altra la indica nella risposta.
const PROTOCOL: &str = "2025-06-18";
/// Avvio e handshake: `npx`/`uvx` al primo avvio scaricano il pacchetto, serve margine.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(90);
const CALL_TIMEOUT: Duration = Duration::from_secs(180);
/// Messaggi d'errore del server (stderr) tenuti per spiegare un fallimento.
const MAX_STDERR: u64 = 64 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Stdio,
    Http,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub transport: Transport,
    /// Solo stdio: programma e argomenti.
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Solo http.
    #[serde(default)]
    pub url: String,
    /// Segreti: nel file restano vuoti, i valori veri sono nel portachiavi.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Secrets {
    #[serde(default)]
    env: BTreeMap<String, String>,
    #[serde(default)]
    headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default = "empty_schema")]
    pub input_schema: Value,
}

fn empty_schema() -> Value {
    json!({ "type": "object", "properties": {} })
}

// ---------------------------------------------------------------------------------------------
// Configurazione

fn secret_key(id: &str) -> String {
    format!("mcp:{id}")
}

fn read_file() -> Result<Vec<Server>> {
    let path = crate::accounts::config_file("mcp.json")?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
}

fn write_file(servers: &[Server]) -> Result<()> {
    let path = crate::accounts::config_file("mcp.json")?;
    let public: Vec<Server> = servers.iter().map(|s| Server { env: BTreeMap::new(), headers: BTreeMap::new(), ..s.clone() }).collect();
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&public)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn with_secrets(mut s: Server) -> Server {
    // Senza segreti salvati (o portachiavi bloccato) il server resta utilizzabile, solo senza chiavi.
    if let Ok(raw) = crate::secrets::load_raw(&secret_key(&s.id)) {
        if let Ok(secrets) = serde_json::from_str::<Secrets>(&raw) {
            s.env = secrets.env;
            s.headers = secrets.headers;
        }
    }
    s
}

/// Server configurati, con i loro segreti.
pub fn list() -> Result<Vec<Server>> {
    Ok(read_file()?.into_iter().map(with_secrets).collect())
}

pub fn get(id: &str) -> Result<Server> {
    read_file()?.into_iter().find(|s| s.id == id).map(with_secrets).ok_or_else(|| msg("Collegamento MCP non trovato"))
}

fn validate(s: &Server) -> Result<()> {
    if s.name.trim().is_empty() {
        return Err(msg("Dai un nome al collegamento"));
    }
    match s.transport {
        Transport::Stdio if s.command.trim().is_empty() => Err(msg("Indica il comando che avvia il server")),
        Transport::Http => {
            let url = url::Url::parse(s.url.trim()).map_err(|_| msg("URL del server non valido"))?;
            if !matches!(url.scheme(), "http" | "https") {
                return Err(msg("L'URL del server deve iniziare con https://"));
            }
            for name in s.headers.keys() {
                HeaderName::from_bytes(name.as_bytes()).map_err(|_| msg(format!("Nome di header non valido: {name}")))?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

/// Aggiunge o aggiorna un server (stesso `id`), e lo restituisce.
pub fn save(mut server: Server) -> Result<Server> {
    if server.id.is_empty() {
        server.id = uuid::Uuid::new_v4().to_string();
    }
    server.name = server.name.trim().to_string();
    server.command = server.command.trim().to_string();
    server.url = server.url.trim().to_string();
    validate(&server)?;
    let secrets = Secrets { env: server.env.clone(), headers: server.headers.clone() };
    let key = secret_key(&server.id);
    if secrets.env.is_empty() && secrets.headers.is_empty() {
        crate::secrets::delete(&key)?;
    } else {
        crate::secrets::store_raw(&key, &serde_json::to_string(&secrets)?)?;
    }
    let mut all = read_file()?;
    match all.iter_mut().find(|s| s.id == server.id) {
        Some(old) => *old = server.clone(),
        None => all.push(server.clone()),
    }
    write_file(&all)?;
    Ok(server)
}

pub fn remove(id: &str) -> Result<()> {
    let mut all = read_file()?;
    all.retain(|s| s.id != id);
    write_file(&all)?;
    crate::secrets::delete(&secret_key(id))
}

// ---------------------------------------------------------------------------------------------
// Richieste annullabili

fn running() -> &'static Mutex<HashMap<String, Arc<Notify>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<Notify>>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

struct Running(String);

impl Drop for Running {
    fn drop(&mut self) {
        running().lock().unwrap().remove(&self.0);
    }
}

pub fn cancel(request: &str) {
    if let Some(n) = running().lock().unwrap().get(request) {
        n.notify_one();
    }
}

/// Esegue `work`, interrompendolo se arriva `cancel(request)`. Interrompere chiude la sessione
/// (il processo locale viene terminato quando la sessione è rilasciata).
async fn cancellable<T>(request: &str, work: impl std::future::Future<Output = Result<T>>) -> Result<T> {
    let stop = Arc::new(Notify::new());
    running().lock().unwrap().insert(request.to_string(), stop.clone());
    let _running = Running(request.to_string());
    tokio::select! {
        r = work => r,
        _ = stop.notified() => Err(msg("Operazione annullata")),
    }
}

// ---------------------------------------------------------------------------------------------
// Sessione

enum Conn {
    Stdio(StdioConn),
    Http(HttpConn),
}

pub struct Session {
    conn: Conn,
    next_id: u64,
    name: String,
}

/// Errore JSON-RPC in testo leggibile.
fn rpc_error(name: &str, err: &Value) -> crate::error::Error {
    let text = err.get("message").and_then(Value::as_str).unwrap_or("errore sconosciuto");
    msg(format!("{name}: {text}"))
}

/// Risposta a una richiesta che il server fa a noi: solo `ping` è supportato.
fn answer_server_request(req: &Value) -> Option<Value> {
    let id = req.get("id")?.clone();
    req.get("method")?;
    Some(if req["method"] == "ping" {
        json!({ "jsonrpc": "2.0", "id": id, "result": {} })
    } else {
        json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Metodo non supportato da Missiva" } })
    })
}

impl Session {
    pub async fn open(server: &Server) -> Result<Session> {
        let conn = match server.transport {
            Transport::Stdio => Conn::Stdio(StdioConn::spawn(server)?),
            Transport::Http => Conn::Http(HttpConn::new(server)?),
        };
        let mut s = Session { conn, next_id: 1, name: server.name.clone() };
        let init = tokio::time::timeout(CONNECT_TIMEOUT, s.handshake()).await;
        match init {
            Ok(Ok(())) => Ok(s),
            Ok(Err(e)) => Err(s.explain(e).await),
            Err(_) => Err(s.explain(msg(format!("{} non ha risposto entro {} secondi", server.name, CONNECT_TIMEOUT.as_secs()))).await),
        }
    }

    async fn handshake(&mut self) -> Result<()> {
        let result = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL,
                    "capabilities": {},
                    "clientInfo": { "name": "missiva", "title": "Missiva", "version": env!("CARGO_PKG_VERSION") },
                }),
            )
            .await?;
        if let (Conn::Http(h), Some(v)) = (&mut self.conn, result.get("protocolVersion").and_then(Value::as_str)) {
            h.protocol = Some(v.to_string());
        }
        self.notify("notifications/initialized").await
    }

    /// Per un server locale che si ferma, l'ultima riga di stderr dice di solito il perché.
    async fn explain(&mut self, e: crate::error::Error) -> crate::error::Error {
        if let Conn::Stdio(c) = &mut self.conn {
            let why = c.stderr_tail().await;
            if !why.is_empty() {
                return msg(format!("{e}\n{why}"));
            }
        }
        e
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let body = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let reply = match &mut self.conn {
            Conn::Stdio(c) => c.request(&body, id).await?,
            Conn::Http(c) => c.request(&body, id).await?,
        };
        if let Some(err) = reply.get("error") {
            return Err(rpc_error(&self.name, err));
        }
        Ok(reply.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn notify(&mut self, method: &str) -> Result<()> {
        let body = json!({ "jsonrpc": "2.0", "method": method });
        match &mut self.conn {
            Conn::Stdio(c) => c.send(&body).await,
            Conn::Http(c) => c.post(&body, None).await.map(|_| ()),
        }
    }

    /// Tutti gli strumenti del server, seguendo la paginazione.
    pub async fn tools(&mut self) -> Result<Vec<Tool>> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let page = tokio::time::timeout(CALL_TIMEOUT, self.request("tools/list", params)).await.map_err(|_| msg("Elenco degli strumenti non ricevuto in tempo"))??;
            for t in page.get("tools").and_then(Value::as_array).into_iter().flatten() {
                if let Ok(mut tool) = serde_json::from_value::<Tool>(t.clone()) {
                    if tool.title.is_none() {
                        tool.title = t.pointer("/annotations/title").and_then(Value::as_str).map(str::to_string);
                    }
                    tools.push(tool);
                }
            }
            cursor = page.get("nextCursor").and_then(Value::as_str).filter(|c| !c.is_empty()).map(str::to_string);
            if cursor.is_none() || tools.len() > 2000 {
                return Ok(tools);
            }
        }
    }

    pub async fn call(&mut self, tool: &str, args: Value) -> Result<Value> {
        let reply = tokio::time::timeout(CALL_TIMEOUT, self.request("tools/call", json!({ "name": tool, "arguments": args }))).await;
        match reply {
            Ok(r) => r,
            Err(_) => Err(msg(format!("{} non ha risposto entro {} minuti", self.name, CALL_TIMEOUT.as_secs() / 60))),
        }
    }

    pub async fn close(self) {
        match self.conn {
            Conn::Stdio(c) => c.close().await,
            Conn::Http(c) => c.close().await,
        }
    }
}

/// Strumenti esposti dal server `id`.
pub async fn list_tools(request: &str, id: &str) -> Result<Vec<Tool>> {
    let server = get(id)?;
    cancellable(request, async {
        let mut s = Session::open(&server).await?;
        let tools = s.tools().await;
        s.close().await;
        tools
    })
    .await
}

/// Esegue lo strumento `tool` del server `id` e restituisce il risultato MCP così com'è
/// (`content`, `structuredContent`, `isError`).
pub async fn call_tool(request: &str, id: &str, tool: &str, args: Value) -> Result<Value> {
    let server = get(id)?;
    cancellable(request, async {
        let mut s = Session::open(&server).await?;
        let result = s.call(tool, args).await;
        s.close().await;
        result
    })
    .await
}

// ---------------------------------------------------------------------------------------------
// Trasporto stdio

struct StdioConn {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Lines<BufReader<ChildStdout>>,
    stderr: Option<tokio::task::JoinHandle<String>>,
}

/// Programma da avviare: un percorso, oppure un nome cercato nelle cartelle dei programmi (anche
/// quelle che mancano dal PATH quando Missiva parte dal menu, come per gli agenti AI).
fn resolve(command: &str, dirs: &[PathBuf]) -> Result<PathBuf> {
    if command.contains('/') {
        let p = PathBuf::from(command);
        return if p.exists() { Ok(p) } else { Err(msg(format!("Programma non trovato: {command}"))) };
    }
    crate::ai::find_in(dirs, command).ok_or_else(|| msg(format!("Comando «{command}» non trovato sul computer")))
}

impl StdioConn {
    fn spawn(server: &Server) -> Result<StdioConn> {
        let dirs = crate::ai::search_dirs();
        let program = resolve(&server.command, &dirs)?;
        let mut cmd = tokio::process::Command::from(crate::browsers::system_command(&program));
        // Script Node/Python cercano l'interprete nel PATH: la cartella del programma va in testa.
        let mut path: Vec<PathBuf> = program.parent().map(Path::to_path_buf).into_iter().collect();
        path.extend(dirs);
        if let Ok(joined) = std::env::join_paths(path) {
            cmd.env("PATH", joined);
        }
        if let Some(home) = dirs::home_dir() {
            cmd.current_dir(home);
        }
        cmd.args(&server.args).envs(&server.env).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let mut child = cmd.spawn().map_err(|e| msg(format!("{} non si avvia: {e}", server.name)))?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or_else(|| msg("stdout del server non disponibile"))?;
        let stderr = child.stderr.take().map(|s| {
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let _ = s.take(MAX_STDERR).read_to_end(&mut buf).await;
                String::from_utf8_lossy(&buf).into_owned()
            })
        });
        Ok(StdioConn { child, stdin, lines: BufReader::new(stdout).lines(), stderr })
    }

    async fn send(&mut self, body: &Value) -> Result<()> {
        let stdin = self.stdin.as_mut().ok_or_else(|| msg("Il server MCP si è chiuso"))?;
        let mut line = serde_json::to_vec(body)?;
        line.push(b'\n');
        stdin.write_all(&line).await?;
        stdin.flush().await?;
        Ok(())
    }

    async fn request(&mut self, body: &Value, id: u64) -> Result<Value> {
        self.send(body).await?;
        loop {
            let Some(line) = self.lines.next_line().await? else {
                return Err(msg("Il server MCP si è chiuso prima di rispondere"));
            };
            // Alcuni server scrivono log su stdout: le righe che non sono JSON si ignorano.
            let Ok(message) = serde_json::from_str::<Value>(line.trim()) else { continue };
            if message.get("method").is_some() {
                if let Some(answer) = answer_server_request(&message) {
                    self.send(&answer).await?;
                }
                continue;
            }
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                return Ok(message);
            }
        }
    }

    /// Ultime righe di stderr, se il processo è già finito (altrimenti non aspetta).
    async fn stderr_tail(&mut self) -> String {
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            return String::new();
        }
        let Some(handle) = self.stderr.take() else { return String::new() };
        let text = tokio::time::timeout(Duration::from_secs(2), handle).await.ok().and_then(|r| r.ok()).unwrap_or_default();
        crate::ai::tail(&text, 4)
    }

    async fn close(mut self) {
        // Chiudere stdin è il modo previsto per chiedere al server di uscire; poi si insiste.
        drop(self.stdin.take());
        if tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await.is_err() {
            let _ = self.child.kill().await;
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Trasporto Streamable HTTP

struct HttpConn {
    client: reqwest::Client,
    url: String,
    headers: HeaderMap,
    session: Option<String>,
    protocol: Option<String>,
}

const SESSION_HEADER: &str = "mcp-session-id";
const PROTOCOL_HEADER: &str = "mcp-protocol-version";

/// Messaggi JSON completi in un buffer SSE; restituisce anche quanto del buffer è stato consumato.
fn sse_messages(buf: &str) -> (Vec<Value>, usize) {
    let mut out = Vec::new();
    let mut used = 0;
    let next_end = |s: &str| {
        let lf = s.find("\n\n").map(|i| (i, 2));
        let crlf = s.find("\r\n\r\n").map(|i| (i, 4));
        match (lf, crlf) {
            (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
            (a, b) => a.or(b),
        }
    };
    while let Some((end, sep)) = next_end(&buf[used..]) {
        let event = &buf[used..used + end];
        used += end + sep;
        let data: Vec<&str> = event.lines().filter_map(|l| l.strip_prefix("data:")).map(|d| d.strip_prefix(' ').unwrap_or(d)).collect();
        if let Ok(v) = serde_json::from_str::<Value>(&data.join("\n")) {
            out.push(v);
        }
    }
    (out, used)
}

/// Il messaggio con `id` tra quelli ricevuti (singoli o in un batch).
fn find_reply(messages: Vec<Value>, id: u64) -> Option<Value> {
    messages
        .into_iter()
        .flat_map(|m| if let Value::Array(a) = m { a } else { vec![m] })
        .find(|m| m.get("id").and_then(Value::as_u64) == Some(id) && m.get("method").is_none())
}

impl HttpConn {
    fn new(server: &Server) -> Result<HttpConn> {
        let mut headers = HeaderMap::new();
        for (k, v) in &server.headers {
            let name = HeaderName::from_bytes(k.trim().as_bytes()).map_err(|_| msg(format!("Nome di header non valido: {k}")))?;
            let value = HeaderValue::from_str(v.trim()).map_err(|_| msg(format!("Valore dell'header {k} non valido")))?;
            headers.insert(name, value);
        }
        let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).build()?;
        Ok(HttpConn { client, url: server.url.clone(), headers, session: None, protocol: None })
    }

    fn builder(&self, method: reqwest::Method) -> reqwest::RequestBuilder {
        let mut b = self.client.request(method, &self.url).headers(self.headers.clone());
        if let Some(s) = &self.session {
            b = b.header(SESSION_HEADER, s);
        }
        if let Some(p) = &self.protocol {
            b = b.header(PROTOCOL_HEADER, p);
        }
        b
    }

    /// Manda un messaggio; con `id` attende e restituisce la risposta corrispondente.
    async fn post(&mut self, body: &Value, id: Option<u64>) -> Result<Option<Value>> {
        let mut res = self
            .builder(reqwest::Method::POST)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream")
            .json(body)
            .send()
            .await?;
        let status = res.status();
        if let Some(s) = res.headers().get(SESSION_HEADER).and_then(|v| v.to_str().ok()) {
            self.session = Some(s.to_string());
        }
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(msg(format!(
                "Il server ha rifiutato l'accesso ({status}). Se richiede un token, aggiungilo negli header del collegamento (es. Authorization: Bearer …)."
            )));
        }
        if !status.is_success() {
            let text = res.text().await.unwrap_or_default();
            let text: String = text.trim().chars().take(300).collect();
            return Err(msg(if text.is_empty() { format!("Il server ha risposto {status}") } else { format!("Il server ha risposto {status}: {text}") }));
        }
        let Some(id) = id else { return Ok(None) };
        let is_sse = res.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|t| t.starts_with("text/event-stream"));
        if !is_sse {
            let v: Value = serde_json::from_str(&res.text().await?).map_err(|_| msg("Risposta del server MCP non valida"))?;
            return find_reply(vec![v], id).map(Some).ok_or_else(|| msg("Il server MCP non ha risposto alla richiesta"));
        }
        // Flusso SSE: si legge finché arriva la risposta, senza aspettare la chiusura.
        let mut buf = String::new();
        let mut pending = Vec::new();
        while let Some(chunk) = res.chunk().await? {
            pending.extend_from_slice(&chunk);
            // Un carattere UTF-8 può essere spezzato tra due blocchi: si converte solo la parte valida.
            let valid = match std::str::from_utf8(&pending) {
                Ok(_) => pending.len(),
                Err(e) => e.valid_up_to(),
            };
            buf.push_str(std::str::from_utf8(&pending[..valid]).unwrap_or_default());
            pending.drain(..valid);
            let (messages, used) = sse_messages(&buf);
            buf.drain(..used);
            if let Some(reply) = find_reply(messages, id) {
                return Ok(Some(reply));
            }
        }
        let (messages, _) = sse_messages(&(buf + "\n\n"));
        find_reply(messages, id).map(Some).ok_or_else(|| msg("Il server MCP ha chiuso la connessione senza rispondere"))
    }

    async fn request(&mut self, body: &Value, id: u64) -> Result<Value> {
        self.post(body, Some(id)).await?.ok_or_else(|| msg("Il server MCP non ha risposto"))
    }

    async fn close(self) {
        if self.session.is_some() {
            let _ = tokio::time::timeout(Duration::from_secs(5), self.builder(reqwest::Method::DELETE).send()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eventi_sse() {
        let buf = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n: commento\n\ndata: {\"id\":2,\ndata: \"result\":5}\n\ndata: incompleto";
        let (msgs, used) = sse_messages(buf);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[1]["result"], 5);
        assert_eq!(&buf[used..], "data: incompleto");
        let (crlf, _) = sse_messages("data: {\"id\":3}\r\n\r\n");
        assert_eq!(crlf[0]["id"], 3);
    }

    #[test]
    fn risposta_giusta() {
        let msgs = vec![json!({"jsonrpc":"2.0","method":"notifications/progress"}), json!([{"id":1,"result":1},{"id":2,"result":2}])];
        assert_eq!(find_reply(msgs, 2).unwrap()["result"], 2);
        // Una richiesta del server con lo stesso id non è la risposta.
        assert!(find_reply(vec![json!({"id":1,"method":"ping"})], 1).is_none());
    }

    #[test]
    fn richieste_del_server() {
        assert_eq!(answer_server_request(&json!({"id":7,"method":"ping"})).unwrap()["result"], json!({}));
        assert_eq!(answer_server_request(&json!({"id":"x","method":"roots/list"})).unwrap()["error"]["code"], -32601);
        assert!(answer_server_request(&json!({"method":"notifications/x"})).is_none());
    }

    #[test]
    fn validazione() {
        let base = Server { id: "x".into(), name: "Prova".into(), transport: Transport::Http, command: String::new(), args: vec![], url: "https://esempio.it/mcp".into(), env: BTreeMap::new(), headers: BTreeMap::new() };
        assert!(validate(&base).is_ok());
        assert!(validate(&Server { url: "ftp://x".into(), ..base.clone() }).is_err());
        assert!(validate(&Server { headers: BTreeMap::from([("a b".into(), "c".into())]), ..base.clone() }).is_err());
        assert!(validate(&Server { transport: Transport::Stdio, ..base.clone() }).is_err());
        assert!(validate(&Server { name: " ".into(), ..base }).is_err());
    }

    fn stdio(name: &str, command: &str, args: &[&str], env: &[(&str, &str)]) -> Server {
        Server {
            id: "t".into(),
            name: name.into(),
            transport: Transport::Stdio,
            command: command.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            url: String::new(),
            env: env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            headers: BTreeMap::new(),
        }
    }

    /// Server MCP finto in shell: risposte fisse agli id 1 (initialize) e 2.
    #[tokio::test]
    async fn server_locale() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("missiva-mcp-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("finto-mcp");
        std::fs::write(
            &script,
            r#"#!/bin/sh
read -r init
echo "log non JSON"
echo '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"finto","version":"1"}}}'
read -r initialized
read -r req
case "$req" in
  *tools/list*) echo '{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"eco","description":"Ripete","inputSchema":{"type":"object","properties":{"testo":{"type":"string"}}},"annotations":{"title":"Eco"}}]}}' ;;
  *tools/call*) echo '{"jsonrpc":"2.0","method":"ping","id":"s1"}'; read -r pong; echo "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"$MCP_SALUTO\"}]}}" ;;
esac
read -r fine
"#,
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let server = stdio("Finto", &script.to_string_lossy(), &[], &[("MCP_SALUTO", "ciao")]);

        let mut s = Session::open(&server).await.unwrap();
        let tools = s.tools().await.unwrap();
        s.close().await;
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].title.as_deref(), Some("Eco"));
        assert_eq!(tools[0].input_schema["properties"]["testo"]["type"], "string");

        let mut s = Session::open(&server).await.unwrap();
        let result = s.call("eco", json!({"testo": "x"})).await.unwrap();
        s.close().await;
        assert_eq!(result["content"][0]["text"], "ciao");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn server_che_non_parte() {
        let server = stdio("Rotto", "/bin/sh", &["-c", "echo 'chiave mancante' >&2; exit 1"], &[]);
        let err = Session::open(&server).await.err().unwrap().to_string();
        assert!(err.contains("chiave mancante"), "{err}");
        let missing = stdio("Assente", "programma-che-non-esiste-xyz", &[], &[]);
        assert!(Session::open(&missing).await.err().unwrap().to_string().contains("non trovato"));
    }

    #[tokio::test]
    async fn annullamento() {
        let work = cancellable("r1", async {
            tokio::time::sleep(Duration::from_secs(30)).await;
            Ok(())
        });
        let stop = async {
            tokio::time::sleep(Duration::from_millis(50)).await;
            cancel("r1");
        };
        let (r, _) = tokio::join!(work, stop);
        assert!(r.is_err());
        assert!(running().lock().unwrap().get("r1").is_none());
    }

    /// Prova con un server vero: `MCP_TEST_CMD="npx -y pacchetto"` oppure `MCP_TEST_URL=https://…`,
    /// poi `cargo test -- --ignored server_reale --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn server_reale() {
        let server = match (std::env::var("MCP_TEST_URL"), std::env::var("MCP_TEST_CMD")) {
            (Ok(url), _) => Server { transport: Transport::Http, url, ..stdio("Vero", "x", &[], &[]) },
            (_, Ok(cmd)) => {
                let parts: Vec<&str> = cmd.split_whitespace().collect();
                stdio("Vero", parts[0], &parts[1..], &[])
            }
            _ => panic!("imposta MCP_TEST_URL o MCP_TEST_CMD"),
        };
        let mut s = Session::open(&server).await.unwrap();
        let tools = s.tools().await.unwrap();
        println!("{} strumenti: {:?}", tools.len(), tools.iter().map(|t| &t.name).collect::<Vec<_>>());
        if tools.iter().any(|t| t.name == "echo") {
            let r = s.call("echo", json!({ "message": "ciao da Missiva" })).await.unwrap();
            println!("echo → {r}");
        }
        s.close().await;
    }
}
