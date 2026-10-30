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

/// Riordina gli account secondo `ids`; quelli non elencati restano in fondo nell'ordine attuale.
#[tauri::command]
fn reorder_accounts(ids: Vec<String>) -> Result<Vec<Account>> {
    let mut all = accounts::load()?;
    all.sort_by_key(|a| ids.iter().position(|id| id == &a.id).unwrap_or(usize::MAX));
    accounts::save(&all)?;
    Ok(all)
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
        .flat_map(|a| mail::read_cache(&a.id, folder.key()))
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
        mail::write_cache(&acc.id, folder.key(), &m)?;
        Ok(m)
    }))
    .await?;
    Ok(msgs)
}

/// Sincronizza una cartella su tutti gli account (o su uno solo) in parallelo; gli errori restano per account.
#[tauri::command]
async fn sync_folder(folder: Folder, account: Option<String>) -> Result<SyncReport> {
    let all = accounts::load()?;
    let tasks: Vec<_> = all
        .into_iter()
        .filter(|acc| account.as_ref().is_none_or(|id| &acc.id == id))
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
                report.messages.extend(mail::read_cache(&account_id, folder.key()));
                report.errors.push(SyncError { account_id, message: e.to_string() });
            }
        }
    }
    Ok(report)
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageRef {
    account_id: String,
    folder: Folder,
    mailbox: String,
    uid: u32,
}

impl MessageRef {
    fn bucket(&self) -> String {
        mail::bucket(self.folder, &self.mailbox)
    }
}

/// Cartelle dell'account: dalla cache, oppure dal server con `refresh` (poi in cache).
#[tauri::command]
async fn mailboxes(account: String, refresh: bool) -> Result<Vec<imap_client::Mailbox>> {
    let path = mail::cache_path(&account, "folders")?;
    if !refresh {
        if let Ok(text) = std::fs::read_to_string(&path) {
            return Ok(serde_json::from_str(&text).unwrap_or_default());
        }
    }
    let acc = accounts::get(&account)?;
    let auth = auth_for(&acc).await?;
    let list = blocking(move || imap_client::list_mailboxes(&acc, &auth)).await?;
    std::fs::write(path, serde_json::to_string(&list)?)?;
    Ok(list)
}

#[tauri::command]
fn cached_mailbox(account: String, mailbox: String) -> Vec<Message> {
    mail::read_cache(&account, &mail::bucket(Folder::Other, &mailbox))
}

/// Sincronizza una cartella dell'utente; se il server non risponde restano i messaggi in cache.
#[tauri::command]
async fn sync_mailbox(account: String, mailbox: String) -> Result<SyncReport> {
    let bucket = mail::bucket(Folder::Other, &mailbox);
    let acc = accounts::get(&account)?;
    let result = async {
        let auth = auth_for(&acc).await?;
        let (acc, mailbox, bucket) = (acc.clone(), mailbox.clone(), bucket.clone());
        blocking(move || {
            let msgs = imap_client::fetch_mailbox(&acc, &auth, &mailbox)?;
            mail::write_cache(&acc.id, &bucket, &msgs)?;
            Ok(msgs)
        })
        .await
    }
    .await;
    Ok(match result {
        Ok(messages) => SyncReport { messages, errors: Vec::new() },
        Err(e) => SyncReport {
            messages: mail::read_cache(&account, &bucket),
            errors: vec![SyncError { account_id: account, message: e.to_string() }],
        },
    })
}

/// Messaggi raggruppati per account e casella: ogni gruppo usa una sola sessione IMAP.
fn by_mailbox(targets: Vec<MessageRef>) -> Vec<(MessageRef, Vec<u32>)> {
    let mut groups: Vec<(MessageRef, Vec<u32>)> = Vec::new();
    for t in targets {
        match groups.iter_mut().find(|(g, _)| g.account_id == t.account_id && g.mailbox == t.mailbox && g.folder == t.folder) {
            Some((_, uids)) => uids.push(t.uid),
            None => {
                let uid = t.uid;
                groups.push((t, vec![uid]));
            }
        }
    }
    groups
}

#[tauri::command]
async fn set_flags(target: MessageRef, seen: Option<bool>, flagged: Option<bool>) -> Result<()> {
    set_flags_many(vec![target], seen, flagged).await
}

/// Segna come letti/non letti o contrassegna più messaggi, anche di account diversi.
#[tauri::command]
async fn set_flags_many(targets: Vec<MessageRef>, seen: Option<bool>, flagged: Option<bool>) -> Result<()> {
    for (target, uids) in by_mailbox(targets) {
        let acc = accounts::get(&target.account_id)?;
        let auth = auth_for(&acc).await?;
        blocking(move || {
            if let Some(on) = seen {
                imap_client::set_flag(&acc, &auth, &target.mailbox, &uids, "\\Seen", on)?;
            }
            if let Some(on) = flagged {
                imap_client::set_flag(&acc, &auth, &target.mailbox, &uids, "\\Flagged", on)?;
            }
            mail::update_cache(&acc.id, &target.bucket(), |msgs| {
                for m in msgs.iter_mut().filter(|m| uids.contains(&m.uid)) {
                    if let Some(on) = seen {
                        m.unread = !on;
                    }
                    if let Some(on) = flagged {
                        m.flagged = on;
                    }
                }
            })
        })
        .await?;
    }
    Ok(())
}

#[tauri::command]
async fn move_message(target: MessageRef, to: Folder) -> Result<()> {
    move_messages(vec![target], to).await
}

/// Sposta più messaggi in Archivio o Cestino: una sessione per casella.
#[tauri::command]
async fn move_messages(targets: Vec<MessageRef>, to: Folder) -> Result<()> {
    for (target, uids) in by_mailbox(targets) {
        let acc = accounts::get(&target.account_id)?;
        let auth = auth_for(&acc).await?;
        blocking(move || {
            imap_client::move_to(&acc, &auth, &target.mailbox, &uids, to)?;
            mail::update_cache(&acc.id, &target.bucket(), |msgs| msgs.retain(|m| !uids.contains(&m.uid)))
        })
        .await?;
    }
    Ok(())
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
const STORES: [&str; 3] = ["snoozed", "labels", "trusted"];

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

/// Messaggio completo: dalla cache su disco, altrimenti dal server (poi resta in cache).
async fn raw_message(target: MessageRef) -> Result<Vec<u8>> {
    if let Some(bytes) = mail::read_raw(&target.account_id, &target.bucket(), target.uid) {
        return Ok(bytes);
    }
    let acc = accounts::get(&target.account_id)?;
    let auth = auth_for(&acc).await?;
    blocking(move || {
        let bytes = imap_client::fetch_raw(&acc, &auth, &target.mailbox, target.uid)?;
        let _ = mail::store_raw(&acc.id, &target.bucket(), target.uid, &bytes);
        Ok(bytes)
    })
    .await
}

/// HTML del messaggio, se ne ha uno; altrimenti `None` e si mostra il testo.
#[tauri::command]
async fn message_html(target: MessageRef) -> Result<Option<mail::HtmlView>> {
    let raw = raw_message(target).await?;
    blocking(move || mail::html_view(&raw)).await
}

/// Contenuto di un allegato in binario, per l'anteprima.
#[tauri::command]
async fn attachment_bytes(target: MessageRef, index: usize) -> Result<tauri::ipc::Response> {
    let raw = raw_message(target).await?;
    let (_, bytes) = blocking(move || mail::attachment(&raw, index)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn open_attachment(handle: AppHandle, target: MessageRef, index: usize) -> Result<String> {
    let raw = raw_message(target).await?;
    let path = blocking(move || {
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
        // Deve essere il primo plugin: un secondo avvio (menu applicazioni, clic su una notifica)
        // riporta in primo piano la finestra già aperta invece di creare un'altra istanza.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
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
            reorder_accounts,
            cached_messages,
            sync_folder,
            set_flags,
            move_message,
            move_messages,
            set_flags_many,
            send_message,
            schedule_message,
            list_scheduled,
            cancel_scheduled,
            send_scheduled_now,
            read_store,
            write_store,
            open_attachment,
            message_html,
            mailboxes,
            cached_mailbox,
            sync_mailbox,
            attachment_bytes,
            clear_cache,
            tray_available,
            set_tray_unread,
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di Missiva");
}
