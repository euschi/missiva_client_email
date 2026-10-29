mod accounts;
mod autoconfig;
mod error;
mod imap_client;
mod mail;
mod oauth;
mod secrets;
mod smtp;

use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn_blocking;
use tauri::AppHandle;
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

#[tauri::command]
async fn send_message(outgoing: smtp::Outgoing) -> Result<()> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            open_attachment,
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di Missiva");
}
