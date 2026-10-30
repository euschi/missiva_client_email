mod accounts;
mod autoconfig;
mod error;
mod imap_client;
mod mail;
mod oauth;
mod outbox;
mod secrets;
mod smtp;
mod tray;

use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

use accounts::{Account, Provider, Server};
use error::{msg, Result};
use imap_client::Auth;
use mail::{Folder, Message};
use secrets::Secret;

/// Esegue lavoro IMAP/SMTP bloccante fuori dal runtime async.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    spawn_blocking(f).await.map_err(|e| msg(format!("Operazione interrotta: {e}")))?
}

async fn auth_for(acc: &Account) -> Result<Auth> {
    match acc.provider {
        Provider::Imap => match secrets::load(&acc.id)? {
            Secret::Password { password } => Ok(Auth::Password(password)),
            Secret::Oauth { .. } => Err(msg("Credenziali dell'account non valide")),
        },
        _ => Ok(Auth::Token(oauth::access_token(acc).await?)),
    }
}

#[tauri::command]
fn list_accounts() -> Result<Vec<Account>> {
    accounts::load()
}

#[tauri::command]
async fn autoconfig(email: String) -> autoconfig::Guess {
    autoconfig::lookup(&email).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapInput {
    email: String,
    password: String,
    imap: Server,
    smtp: Server,
    sync_days: u32,
}

fn new_account(provider: Provider, email: String, display_name: Option<String>, imap: Server, smtp: Server, sync_days: u32) -> Result<Account> {
    let existing = accounts::load()?;
    if existing.iter().any(|a| a.email.eq_ignore_ascii_case(&email)) {
        return Err(msg(format!("{email} è già configurato")));
    }
    Ok(Account {
        id: uuid::Uuid::new_v4().to_string(),
        name: accounts::default_name(provider, &email),
        display_name: display_name.unwrap_or_else(|| email.split('@').next().unwrap_or(&email).to_string()),
        username: email.clone(),
        email,
        provider,
        color: accounts::next_color(&existing),
        imap,
        smtp,
        sync_days,
        signature: String::new(),
    })
}

fn persist(acc: Account, secret: &Secret) -> Result<Account> {
    secrets::store(&acc.id, secret)?;
    let mut all = accounts::load()?;
    all.push(acc.clone());
    accounts::save(&all)?;
    Ok(acc)
}

#[tauri::command]
async fn add_imap_account(input: ImapInput) -> Result<Account> {
    let email = input.email.trim().to_string();
    let acc = new_account(Provider::Imap, email, None, input.imap, input.smtp, input.sync_days)?;
    let auth = Auth::Password(input.password.clone());
    // Verifica le credenziali prima di salvare.
    let probe = acc.clone();
    blocking(move || imap_client::connect(&probe, &auth).map(|mut s| { let _ = s.logout(); })).await?;
    persist(acc, &Secret::Password { password: input.password })
}

#[tauri::command]
async fn add_oauth_account(handle: AppHandle, provider: Provider, sync_days: u32) -> Result<Account> {
    let authz = oauth::authorize(&handle, provider).await?;
    let (imap, smtp) = match provider {
        Provider::Google => ("imap.gmail.com", "smtp.gmail.com"),
        Provider::Microsoft => ("outlook.office365.com", "smtp.office365.com"),
        Provider::Imap => return Err(msg("Provider non valido")),
    };
    let acc = new_account(
        provider,
        authz.email,
        authz.name,
        Server { host: imap.into(), port: 993, security: accounts::Security::Tls },
        Server { host: smtp.into(), port: 587, security: accounts::Security::Starttls },
        sync_days,
    )?;
    persist(acc, &authz.secret)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountPatch {
    id: String,
    name: Option<String>,
    display_name: Option<String>,
    color: Option<String>,
    signature: Option<String>,
}

#[tauri::command]
fn update_account(patch: AccountPatch) -> Result<Account> {
    let mut all = accounts::load()?;
    let acc = all.iter_mut().find(|a| a.id == patch.id).ok_or_else(|| msg("Account non trovato"))?;
    if let Some(v) = patch.name.filter(|v| !v.trim().is_empty()) {
        acc.name = v.trim().to_string();
    }
    if let Some(v) = patch.display_name.filter(|v| !v.trim().is_empty()) {
        acc.display_name = v.trim().to_string();
    }
    if let Some(v) = patch.color {
        acc.color = v;
    }
    if let Some(v) = patch.signature {
        acc.signature = v;
    }
    let updated = acc.clone();
    accounts::save(&all)?;
    Ok(updated)
}

#[tauri::command]
fn remove_account(id: String) -> Result<()> {
    let mut all = accounts::load()?;
    all.retain(|a| a.id != id);
    accounts::save(&all)?;
    secrets::delete(&id)?;
    mail::clear_cache(&id);
    Ok(())
}

#[tauri::command]
fn cached_messages(folder: Folder) -> Result<Vec<Message>> {
    Ok(accounts::load()?
        .iter()
        .flat_map(|a| mail::read_cache(&a.id, folder))
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncError {
    account_id: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncReport {
    messages: Vec<Message>,
    errors: Vec<SyncError>,
}

async fn sync_account(acc: Account, folder: Folder) -> Result<Vec<Message>> {
    let auth = auth_for(&acc).await?;
    let msgs = blocking(move || imap_client::fetch_folder(&acc, &auth, folder).and_then(|m| {
        mail::write_cache(&acc.id, folder, &m)?;
        Ok(m)
    }))
    .await?;
    Ok(msgs)
}

/// Sincronizza una cartella su tutti gli account in parallelo; gli errori restano per account.
#[tauri::command]
async fn sync_folder(folder: Folder) -> Result<SyncReport> {
    let all = accounts::load()?;
    let tasks: Vec<_> = all
        .into_iter()
        .map(|acc| {
            let id = acc.id.clone();
            (id, tauri::async_runtime::spawn(sync_account(acc, folder)))
        })
        .collect();
    let mut report = SyncReport { messages: Vec::new(), errors: Vec::new() };
    for (account_id, task) in tasks {
        let result = task.await.map_err(|e| msg(e.to_string())).and_then(|r| r);
        match result {
            Ok(m) => report.messages.extend(m),
            Err(e) => {
                report.messages.extend(mail::read_cache(&account_id, folder));
                report.errors.push(SyncError { account_id, message: e.to_string() });
            }
        }
    }
    Ok(report)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageRef {
    account_id: String,
    folder: Folder,
    mailbox: String,
    uid: u32,
}

#[tauri::command]
async fn set_flags(target: MessageRef, seen: Option<bool>, flagged: Option<bool>) -> Result<()> {
    let acc = accounts::get(&target.account_id)?;
    let auth = auth_for(&acc).await?;
    blocking(move || {
        if let Some(on) = seen {
            imap_client::set_flag(&acc, &auth, &target.mailbox, target.uid, "\\Seen", on)?;
        }
        if let Some(on) = flagged {
            imap_client::set_flag(&acc, &auth, &target.mailbox, target.uid, "\\Flagged", on)?;
        }
        mail::update_cache(&acc.id, target.folder, |msgs| {
            if let Some(m) = msgs.iter_mut().find(|m| m.uid == target.uid) {
                if let Some(on) = seen {
                    m.unread = !on;
                }
                if let Some(on) = flagged {
                    m.flagged = on;
                }
            }
        })
    })
    .await
}

#[tauri::command]
async fn move_message(target: MessageRef, to: Folder) -> Result<()> {
    let acc = accounts::get(&target.account_id)?;
    let auth = auth_for(&acc).await?;
    blocking(move || {
        imap_client::move_to(&acc, &auth, &target.mailbox, target.uid, to)?;
        mail::update_cache(&acc.id, target.folder, |msgs| msgs.retain(|m| m.uid != target.uid))
    })
    .await
}

async fn deliver(outgoing: smtp::Outgoing) -> Result<()> {
    if outgoing.to.is_empty() {
        return Err(msg("Aggiungi almeno un destinatario"));
    }
    let acc = accounts::get(&outgoing.account_id)?;
    let auth = auth_for(&acc).await?;
    blocking(move || {
        let message = smtp::build(&acc, &outgoing)?;
        smtp::send(&acc, &auth, &message)?;
        // Gmail e Microsoft 365 salvano già la copia in Inviati.
        if acc.provider == Provider::Imap {
            imap_client::append_sent(&acc, &auth, &message.formatted())?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
async fn send_message(outgoing: smtp::Outgoing) -> Result<()> {
    deliver(outgoing).await
}

#[tauri::command]
fn schedule_message(outgoing: smtp::Outgoing, at: i64) -> Result<outbox::Scheduled> {
    if outgoing.to.is_empty() {
        return Err(msg("Aggiungi almeno un destinatario"));
    }
    accounts::get(&outgoing.account_id)?;
    let item = outbox::Scheduled { id: uuid::Uuid::new_v4().to_string(), at, outgoing, attempts: 0, error: None };
    let saved = item.clone();
    outbox::update(|all| all.push(item))?;
    Ok(saved)
}

#[tauri::command]
fn list_scheduled() -> Result<Vec<outbox::Scheduled>> {
    outbox::load()
}

#[tauri::command]
fn cancel_scheduled(id: String) -> Result<()> {
    outbox::update(|all| all.retain(|s| s.id != id))
}

/// Invia subito un messaggio programmato (anche dopo un errore) e restituisce l'esito.
#[tauri::command]
async fn send_scheduled_now(handle: AppHandle, id: String) -> Result<()> {
    let now = chrono::Utc::now().timestamp();
    let found = outbox::update(|all| {
        all.iter_mut().find(|s| s.id == id).map(|s| {
            s.at = now;
            s.attempts = 0;
            s.error = None;
        })
    })?;
    if found.is_none() {
        return Err(msg("Il messaggio programmato non esiste più"));
    }
    match flush_outbox(&handle).await.into_iter().find(|(sid, _)| *sid == id) {
        Some((_, Some(e))) => Err(msg(e)),
        _ => Ok(()),
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutboxEvent {
    id: String,
    subject: String,
    error: Option<String>,
}

// Il ciclo in background e "Invia ora" non devono spedire lo stesso messaggio due volte.
static FLUSHING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Spedisce i messaggi programmati scaduti. Per ognuno restituisce l'errore finale, se c'è.
async fn flush_outbox(handle: &AppHandle) -> Vec<(String, Option<String>)> {
    let _g = FLUSHING.lock().await;
    let now = chrono::Utc::now().timestamp();
    let due: Vec<_> = match outbox::load() {
        Ok(all) => all.into_iter().filter(|s| s.at <= now && s.error.is_none()).collect(),
        Err(_) => return Vec::new(),
    };
    let mut results = Vec::new();
    for s in due {
        let error = deliver(s.outgoing.clone()).await.err().map(|e| e.to_string());
        // Dopo un errore riprova tra un minuto, fino a MAX_ATTEMPTS.
        let final_error = outbox::update(|all| {
            let Some(pos) = all.iter().position(|x| x.id == s.id) else { return None };
            match &error {
                None => {
                    all.remove(pos);
                    None
                }
                Some(e) => {
                    let x = &mut all[pos];
                    x.attempts += 1;
                    x.at = now + 60;
                    (x.attempts >= outbox::MAX_ATTEMPTS).then(|| {
                        x.error = Some(e.clone());
                        e.clone()
                    })
                }
            }
        })
        .ok()
        .flatten();
        if error.is_none() || final_error.is_some() {
            let _ = handle.emit("outbox-changed", OutboxEvent { id: s.id.clone(), subject: s.outgoing.subject.clone(), error: final_error.clone() });
        }
        results.push((s.id, error));
    }
    results
}

/// File JSON condivisi con il frontend (posticipi ed etichette) in ~/.config/missiva/.
const STORES: [&str; 2] = ["snoozed", "labels"];

fn store_path(name: &str) -> Result<std::path::PathBuf> {
    if !STORES.contains(&name) {
        return Err(msg("Archivio sconosciuto"));
    }
    accounts::config_file(&format!("{name}.json"))
}

#[tauri::command]
fn read_store(name: String) -> Result<serde_json::Value> {
    let path = store_path(&name)?;
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
}

#[tauri::command]
fn write_store(name: String, value: serde_json::Value) -> Result<()> {
    let path = store_path(&name)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&value)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

#[tauri::command]
async fn open_attachment(handle: AppHandle, target: MessageRef, index: usize) -> Result<String> {
    let acc = accounts::get(&target.account_id)?;
    let auth = auth_for(&acc).await?;
    let path = blocking(move || {
        let raw = imap_client::fetch_raw(&acc, &auth, &target.mailbox, target.uid)?;
        let (name, bytes) = mail::attachment(&raw, index)?;
        let dir = dirs::download_dir()
            .or_else(dirs::home_dir)
            .ok_or_else(|| msg("Cartella Scaricati non trovata"))?;
        // Il nome arriva dal mittente: tieni solo l'ultimo componente del percorso.
        let safe = std::path::Path::new(&name)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "allegato".into());
        let path = dir.join(safe);
        std::fs::write(&path, bytes)?;
        Ok(path)
    })
    .await?;
    handle
        .opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| msg(format!("Allegato salvato ma non apribile: {e}")))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn clear_cache() -> Result<()> {
    for a in accounts::load()? {
        mail::clear_cache(&a.id);
    }
    Ok(())
}

#[tauri::command]
fn tray_available(handle: AppHandle) -> bool {
    tray::available(&handle)
}

#[tauri::command]
fn set_tray_unread(handle: AppHandle, count: usize) {
    tray::set_unread(&handle, count);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(tray::TrayState(std::sync::atomic::AtomicBool::new(false)))
        .setup(|app| {
            // L'app funziona anche senza area di notifica: in quel caso chiudere la finestra la chiude davvero.
            if let Err(e) = tray::setup(app) {
                eprintln!("Area di notifica non disponibile: {e}");
            }
            // Invio dei messaggi programmati, anche con la finestra nascosta.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    flush_outbox(&handle).await;
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            autoconfig,
            add_imap_account,
            add_oauth_account,
            update_account,
            remove_account,
            cached_messages,
            sync_folder,
            set_flags,
            move_message,
            send_message,
            schedule_message,
            list_scheduled,
            cancel_scheduled,
            send_scheduled_now,
            read_store,
            write_store,
            open_attachment,
            clear_cache,
            tray_available,
            set_tray_unread,
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di Missiva");
}
