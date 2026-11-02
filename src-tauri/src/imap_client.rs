//! Operazioni IMAP sincrone: da chiamare dentro `spawn_blocking`.

use std::net::TcpStream;

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;
use imap::types::{Fetch, Flag, Name, NameAttribute};
use serde::{Deserialize, Serialize};
use native_tls::TlsStream;

use crate::accounts::{Account, Provider, Security};
use crate::error::{msg, Result};
use crate::mail::{self, Folder, Message, Raw};

type Session = imap::Session<TlsStream<TcpStream>>;

/// Massimo di messaggi scaricati per cartella a ogni sincronizzazione.
const FETCH_LIMIT: usize = 60;
/// Messaggi aggiunti da «Carica messaggi più vecchi».
const OLDER_LIMIT: usize = 50;
/// Risultati massimi della ricerca sul server, per cartella e per account.
const SEARCH_PER_BOX: usize = 30;
const SEARCH_LIMIT: usize = 100;
/// Messaggi letti per ogni etichetta di Gmail.
const LABEL_LIMIT: usize = 500;
const FETCH_ITEMS: &str = "(UID FLAGS INTERNALDATE BODY.PEEK[])";

#[derive(Clone)]
pub enum Auth {
    Password(String),
    Token(String),
}

struct XOAuth2<'a> {
    user: &'a str,
    token: &'a str,
}

impl imap::Authenticator for XOAuth2<'_> {
    type Response = String;
    fn process(&self, _challenge: &[u8]) -> String {
        format!("user={}\x01auth=Bearer {}\x01\x01", self.user, self.token)
    }
}

pub fn connect(acc: &Account, auth: &Auth) -> Result<Session> {
    let tls = native_tls::TlsConnector::builder().build()?;
    let addr = (acc.imap.host.as_str(), acc.imap.port);
    let client = match acc.imap.security {
        Security::Tls => imap::connect(addr, &acc.imap.host, &tls)?,
        Security::Starttls => imap::connect_starttls(addr, &acc.imap.host, &tls)?,
    };
    let session = match auth {
        Auth::Password(p) => client.login(&acc.username, p).map_err(|(e, _)| e)?,
        Auth::Token(t) => client
            .authenticate("XOAUTH2", &XOAuth2 { user: &acc.username, token: t })
            .map_err(|(e, _)| e)?,
    };
    Ok(session)
}

fn has_attr(n: &Name, attr: &str) -> bool {
    n.attributes().iter().any(|a| match a {
        NameAttribute::Custom(c) => c.eq_ignore_ascii_case(attr),
        NameAttribute::NoSelect => attr.eq_ignore_ascii_case("\\Noselect"),
        _ => false,
    })
}

/// Casella di una cartella speciale nell'elenco LIST: prima per attributo SPECIAL-USE, poi per nome comune.
fn find_special(list: &[Name], folder: Folder) -> Option<String> {
    let (special, names): (&str, &[&str]) = match folder {
        Folder::Inbox => return Some("INBOX".into()),
        Folder::Other => return None,
        Folder::Drafts => ("\\Drafts", &["Drafts", "Bozze", "Draft"]),
        Folder::Sent => ("\\Sent", &["Sent", "Sent Items", "Sent Messages", "Sent Mail", "Inviati", "Posta inviata"]),
        Folder::Archive => ("\\Archive", &["Archive", "Archivio", "All Mail"]),
        Folder::Trash => ("\\Trash", &["Trash", "Deleted Items", "Deleted Messages", "Cestino", "Bin"]),
    };
    if let Some(n) = list.iter().find(|n| has_attr(n, special)) {
        return Some(n.name().to_string());
    }
    list.iter()
        .find(|n| names.iter().any(|x| leaf(n).eq_ignore_ascii_case(x)))
        .map(|n| n.name().to_string())
}

fn leaf<'a>(n: &'a Name) -> &'a str {
    let delim = n.delimiter().unwrap_or("/");
    n.name().rsplit(delim).next().unwrap_or(n.name())
}

/// Trova la casella IMAP di una cartella speciale.
pub fn resolve(session: &mut Session, folder: Folder) -> Result<Option<String>> {
    let list = session.list(Some(""), Some("*"))?;
    Ok(find_special(&list, folder))
}

/// Cartella sul server, così come la elenca LIST.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mailbox {
    /// Nome IMAP esatto (UTF-7 modificato), da usare con SELECT.
    pub path: String,
    /// Nome leggibile dell'ultima parte del percorso.
    pub name: String,
    /// Percorso leggibile completo, con " / " tra i livelli.
    pub label: String,
    pub delimiter: String,
    /// Cartella speciale che Missiva gestisce già (posta in arrivo, inviati…).
    pub special: Option<Folder>,
    /// Falso per i soli contenitori (es. «[Gmail]»): hanno sottocartelle ma niente messaggi.
    pub selectable: bool,
}

/// Tutte le cartelle dell'account, speciali comprese, con le sottocartelle.
pub fn list_mailboxes(acc: &Account, auth: &Auth) -> Result<Vec<Mailbox>> {
    let mut s = connect(acc, auth)?;
    let list = s.list(Some(""), Some("*"))?;
    let _ = s.logout();
    let specials: Vec<(Folder, String)> = [Folder::Inbox, Folder::Drafts, Folder::Sent, Folder::Archive, Folder::Trash]
        .into_iter()
        .filter_map(|f| find_special(&list, f).map(|path| (f, path)))
        .collect();
    let out = list
        .iter()
        .filter(|n| !has_attr(n, "\\NonExistent"))
        .map(|n| {
            let delimiter = n.delimiter().unwrap_or("/").to_string();
            let label = n.name().split(delimiter.as_str()).map(decode_utf7).collect::<Vec<_>>().join(" / ");
            let special = specials
                .iter()
                .find(|(_, path)| path == n.name() || (path == "INBOX" && n.name().eq_ignore_ascii_case("INBOX")))
                .map(|(f, _)| *f);
            Mailbox {
                path: n.name().to_string(),
                name: decode_utf7(leaf(n)),
                label,
                delimiter,
                special,
                selectable: !has_attr(n, "\\Noselect"),
            }
        })
        .collect();
    Ok(out)
}

/// Decodifica i nomi IMAP in UTF-7 modificato (RFC 3501): «Posta &AOg-» → «Posta è».
pub fn decode_utf7(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('-') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let chunk = &after[..end];
        if chunk.is_empty() {
            out.push('&');
        } else {
            let units: Option<Vec<u16>> = STANDARD_NO_PAD
                .decode(chunk.replace(',', "/"))
                .ok()
                .filter(|b| b.len() % 2 == 0)
                .map(|b| b.chunks(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect());
            match units.and_then(|u| String::from_utf16(&u).ok()) {
                Some(text) => out.push_str(&text),
                None => out.push_str(&rest[start..start + end + 2]),
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

pub fn fetch_folder(acc: &Account, auth: &Auth, folder: Folder) -> Result<Vec<Message>> {
    let mut s = connect(acc, auth)?;
    let Some(mailbox) = resolve(&mut s, folder)? else {
        let _ = s.logout();
        return Ok(Vec::new());
    };
    fetch_in(acc, s, folder, &mailbox)
}

/// Scarica una cartella creata dall'utente.
pub fn fetch_mailbox(acc: &Account, auth: &Auth, mailbox: &str) -> Result<Vec<Message>> {
    let s = connect(acc, auth)?;
    fetch_in(acc, s, Folder::Other, mailbox)
}

fn parse_fetch(acc: &Account, folder: Folder, mailbox: &str, f: &Fetch) -> Option<Message> {
    let flags = f.flags();
    mail::parse(Raw {
        account_id: &acc.id,
        folder,
        mailbox,
        uid: f.uid?,
        unread: !flags.contains(&Flag::Seen),
        flagged: flags.contains(&Flag::Flagged),
        internal_date: f.internal_date().map(|d| d.timestamp()),
        bytes: f.body()?,
    })
}

/// Scarica i messaggi indicati dalla casella già selezionata, dal più recente.
fn fetch_uids(s: &mut Session, acc: &Account, folder: Folder, mailbox: &str, uids: &[u32]) -> Result<Vec<Message>> {
    if uids.is_empty() {
        return Ok(Vec::new());
    }
    let fetches = s.uid_fetch(uid_set(uids), FETCH_ITEMS)?;
    let mut out: Vec<Message> = fetches.iter().filter_map(|f| parse_fetch(acc, folder, mailbox, f)).collect();
    out.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(out)
}

/// Gli ultimi `limit` UID di un risultato di SEARCH, in ordine crescente.
fn newest(found: impl IntoIterator<Item = u32>, limit: usize) -> Vec<u32> {
    let mut uids: Vec<u32> = found.into_iter().collect();
    uids.sort_unstable();
    uids.split_off(uids.len().saturating_sub(limit))
}

/// Messaggi più vecchi di `before_uid`, oltre la finestra della sincronizzazione.
pub fn fetch_older(acc: &Account, auth: &Auth, folder: Folder, mailbox: &str, before_uid: u32) -> Result<Vec<Message>> {
    if before_uid <= 1 {
        return Ok(Vec::new());
    }
    let mut s = connect(acc, auth)?;
    s.select(mailbox)?;
    let uids = newest(s.uid_search(format!("UID 1:{}", before_uid - 1))?, OLDER_LIMIT);
    let out = fetch_uids(&mut s, acc, folder, mailbox, &uids)?;
    let _ = s.logout();
    Ok(out)
}

/// Stringa tra virgolette per i comandi IMAP: niente a capo, che chiuderebbero il comando.
fn quoted(text: &str) -> String {
    let clean: String = text.chars().filter(|c| !c.is_control()).collect();
    format!("\"{}\"", clean.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Ricerca sul server, già scomposta dal frontend in parole e filtri.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchQuery {
    pub words: Vec<String>,
    pub from: Vec<String>,
    pub to: Vec<String>,
    pub subject: Vec<String>,
    /// Date nel formato AAAA-MM-GG.
    pub after: Option<String>,
    pub before: Option<String>,
    pub unread: bool,
    pub flagged: bool,
    pub attachment: bool,
}

fn imap_date(value: &Option<String>) -> Option<String> {
    let day = chrono::NaiveDate::parse_from_str(value.as_deref()?, "%Y-%m-%d").ok()?;
    Some(day.format("%d-%b-%Y").to_string())
}

/// Criterio di SEARCH: tutte le condizioni devono valere. `None` se non c'è nulla da cercare.
fn search_criteria(q: &SearchQuery) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for (key, values) in [("TEXT", &q.words), ("FROM", &q.from), ("TO", &q.to), ("SUBJECT", &q.subject)] {
        parts.extend(values.iter().filter(|v| !v.trim().is_empty()).map(|v| format!("{key} {}", quoted(v))));
    }
    if let Some(d) = imap_date(&q.after) {
        // SENT*: la data del messaggio, quella che si vede nell'elenco, non l'arrivo sul server.
        parts.push(format!("SENTSINCE {d}"));
    }
    if let Some(d) = imap_date(&q.before) {
        parts.push(format!("SENTBEFORE {d}"));
    }
    if q.unread {
        parts.push("UNSEEN".into());
    }
    if q.flagged {
        parts.push("FLAGGED".into());
    }
    if parts.is_empty() {
        // Gli allegati non hanno un criterio IMAP: si filtra dopo sui messaggi più recenti.
        return q.attachment.then(|| "ALL".to_string());
    }
    let text = parts.join(" ");
    Some(if text.is_ascii() { text } else { format!("CHARSET UTF-8 {text}") })
}

/// Dove cercare: arrivo, inviati, archivio e cartelle dell'utente; niente cestino, bozze e spam.
fn search_targets(mut boxes: Vec<Mailbox>) -> Vec<Mailbox> {
    let rank = |b: &Mailbox| match b.special {
        Some(Folder::Inbox) => 0,
        Some(Folder::Sent) => 1,
        Some(Folder::Archive) => 3,
        _ => 2,
    };
    boxes.retain(|b| {
        let junk = ["spam", "junk", "posta indesiderata"].iter().any(|n| b.name.to_lowercase().contains(n));
        b.selectable && !junk && !matches!(b.special, Some(Folder::Trash | Folder::Drafts))
    });
    // L'archivio per ultimo: su Gmail «Tutti i messaggi» contiene anche gli altri.
    boxes.sort_by_key(rank);
    boxes
}

/// Cerca sul server in tutte le cartelle utili, tenendo una sola copia di ogni messaggio.
pub fn search(acc: &Account, auth: &Auth, query: &SearchQuery) -> Result<Vec<Message>> {
    let Some(criteria) = search_criteria(query) else { return Ok(Vec::new()) };
    let targets = search_targets(list_mailboxes(acc, auth)?);
    let mut s = connect(acc, auth)?;
    let mut out: Vec<Message> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut failure = None;
    let mut searched = false;
    for b in &targets {
        if out.len() >= SEARCH_LIMIT {
            break;
        }
        let folder = b.special.unwrap_or(Folder::Other);
        let found = s.select(&b.path).map_err(Into::into).and_then(|_| s.uid_search(&criteria).map_err(Into::into));
        let found: std::collections::HashSet<u32> = match found {
            Ok(found) => found,
            Err(e) => {
                failure = Some(e);
                continue;
            }
        };
        searched = true;
        for m in fetch_uids(&mut s, acc, folder, &b.path, &newest(found, SEARCH_PER_BOX))? {
            let wanted = !query.attachment || m.attachments.iter().any(|a| !a.inline);
            if wanted && m.message_id.as_ref().is_none_or(|id| seen.insert(id.clone())) {
                out.push(m);
            }
        }
    }
    let _ = s.logout();
    match failure {
        Some(e) if !searched => Err(e),
        _ => {
            out.sort_by(|a, b| b.date.cmp(&a.date));
            Ok(out)
        }
    }
}

/// Toglie dalla casella selezionata i messaggi con questo Message-ID; con `keep_newest` resta l'UID più alto.
fn drop_by_message_id(s: &mut Session, message_id: &str, keep_newest: bool) -> Result<()> {
    let id = message_id.trim().trim_start_matches('<').trim_end_matches('>');
    let mut uids: Vec<u32> = s.uid_search(format!("HEADER Message-ID {}", quoted(id)))?.into_iter().collect();
    uids.sort_unstable();
    if keep_newest {
        uids.pop();
    }
    if !uids.is_empty() {
        s.uid_store(uid_set(&uids), "+FLAGS.SILENT (\\Deleted)")?;
        s.expunge()?;
    }
    Ok(())
}

/// Salva una bozza in Bozze: la copia nuova sostituisce quelle con lo stesso Message-ID.
pub fn save_draft(acc: &Account, auth: &Auth, bytes: &[u8], message_id: &str) -> Result<()> {
    let mut s = connect(acc, auth)?;
    let Some(drafts) = resolve(&mut s, Folder::Drafts)? else {
        let _ = s.logout();
        return Err(msg("Nessuna cartella Bozze su questo account"));
    };
    s.append_with_flags(&drafts, bytes, &[Flag::Seen, Flag::Draft])?;
    s.select(&drafts)?;
    drop_by_message_id(&mut s, message_id, true)?;
    let _ = s.logout();
    Ok(())
}

/// Elimina la bozza con questo Message-ID, se c'è.
pub fn delete_draft(acc: &Account, auth: &Auth, message_id: &str) -> Result<()> {
    let mut s = connect(acc, auth)?;
    if let Some(drafts) = resolve(&mut s, Folder::Drafts)? {
        s.select(&drafts)?;
        drop_by_message_id(&mut s, message_id, false)?;
    }
    let _ = s.logout();
    Ok(())
}

/// Elimina definitivamente i messaggi indicati.
pub fn delete_forever(acc: &Account, auth: &Auth, mailbox: &str, uids: &[u32]) -> Result<()> {
    let mut s = connect(acc, auth)?;
    s.select(mailbox)?;
    s.uid_store(uid_set(uids), "+FLAGS.SILENT (\\Deleted)")?;
    s.expunge()?;
    let _ = s.logout();
    Ok(())
}

/// Svuota il Cestino dell'account, compresi i messaggi non scaricati.
pub fn empty_trash(acc: &Account, auth: &Auth) -> Result<()> {
    let mut s = connect(acc, auth)?;
    if let Some(trash) = resolve(&mut s, Folder::Trash)? {
        let mailbox = s.select(&trash)?;
        if mailbox.exists > 0 {
            s.store("1:*", "+FLAGS.SILENT (\\Deleted)")?;
            s.expunge()?;
        }
    }
    let _ = s.logout();
    Ok(())
}

/// Scarica solo i messaggi nuovi: di quelli già in cache basta aggiornare letto e contrassegno.
fn fetch_in(acc: &Account, mut s: Session, folder: Folder, mailbox: &str) -> Result<Vec<Message>> {
    let bucket = mail::bucket(folder, mailbox);
    let selected = s.select(mailbox)?;
    let since = (chrono::Local::now() - chrono::Duration::days(acc.sync_days as i64)).format("%d-%b-%Y");
    let uids = newest(s.uid_search(format!("SINCE {since}"))?, FETCH_LIMIT);
    let cached = if mail::check_uid_validity(&acc.id, &bucket, selected.uid_validity) { mail::read_cache(&acc.id, &bucket) } else { Vec::new() };
    if uids.is_empty() {
        mail::prune_raw(&acc.id, &bucket, &uids);
        let _ = s.logout();
        return Ok(Vec::new());
    }

    let flags = s.uid_fetch(uid_set(&uids), "(UID FLAGS)")?;
    let states: std::collections::HashMap<u32, (bool, bool)> = flags
        .iter()
        .filter_map(|f| Some((f.uid?, (!f.flags().contains(&Flag::Seen), f.flags().contains(&Flag::Flagged)))))
        .collect();
    let mut out: Vec<Message> = cached.into_iter().filter(|m| uids.contains(&m.uid)).collect();
    for m in &mut out {
        if let Some(&(unread, flagged)) = states.get(&m.uid) {
            m.unread = unread;
            m.flagged = flagged;
        }
    }

    let missing: Vec<u32> = uids.iter().copied().filter(|u| !out.iter().any(|m| m.uid == *u)).collect();
    if !missing.is_empty() {
        let fetches = s.uid_fetch(uid_set(&missing), FETCH_ITEMS)?;
        out.extend(fetches.iter().filter_map(|f| parse_fetch(acc, folder, mailbox, f)));
        // Copia completa su disco per HTML e allegati.
        for f in fetches.iter() {
            if let (Some(uid), Some(bytes)) = (f.uid, f.body()) {
                let _ = mail::store_raw(&acc.id, &bucket, uid, bytes);
            }
        }
    }
    mail::prune_raw(&acc.id, &bucket, &uids);
    out.sort_by(|a, b| b.date.cmp(&a.date));
    let _ = s.logout();
    Ok(out)
}

/// Esito di un'attesa in IDLE.
pub enum IdleOutcome {
    Changed,
    TimedOut,
    /// Il server non supporta IDLE: resta la sincronizzazione periodica.
    Unsupported,
}

/// Aspetta una novità nella posta in arrivo, al massimo per `wait`.
pub fn idle_once(acc: &Account, auth: &Auth, wait: std::time::Duration) -> Result<IdleOutcome> {
    let mut s = connect(acc, auth)?;
    if !s.capabilities()?.has_str("IDLE") {
        let _ = s.logout();
        return Ok(IdleOutcome::Unsupported);
    }
    s.select("INBOX")?;
    let outcome = s.idle()?.wait_with_timeout(wait)?;
    let _ = s.logout();
    Ok(match outcome {
        imap::extensions::idle::WaitOutcome::MailboxChanged => IdleOutcome::Changed,
        imap::extensions::idle::WaitOutcome::TimedOut => IdleOutcome::TimedOut,
    })
}

/// Nome di casella in UTF-7 modificato (RFC 3501): l'inverso di [`decode_utf7`].
pub fn encode_utf7(s: &str) -> String {
    let mut out = String::new();
    let mut pending: Vec<u16> = Vec::new();
    let flush = |pending: &mut Vec<u16>, out: &mut String| {
        if pending.is_empty() {
            return;
        }
        let bytes: Vec<u8> = pending.drain(..).flat_map(u16::to_be_bytes).collect();
        out.push('&');
        out.push_str(&STANDARD_NO_PAD.encode(bytes).replace('/', ","));
        out.push('-');
    };
    for c in s.chars() {
        if (' '..='~').contains(&c) {
            flush(&mut pending, &mut out);
            out.push(c);
            if c == '&' {
                out.push('-');
            }
        } else {
            let mut buf = [0u16; 2];
            pending.extend_from_slice(c.encode_utf16(&mut buf));
        }
    }
    flush(&mut pending, &mut out);
    out
}

/// Un nome scelto dall'utente: niente separatori, che creerebbero sottocartelle a sorpresa.
fn clean_box_name(name: &str, delimiter: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(msg("Scrivi un nome per la cartella"));
    }
    if !delimiter.is_empty() && name.contains(delimiter) {
        return Err(msg(format!("Il nome non può contenere «{delimiter}»")));
    }
    Ok(encode_utf7(name))
}

/// Crea una cartella, dentro `parent` se indicato. Restituisce il percorso IMAP.
pub fn create_mailbox(acc: &Account, auth: &Auth, parent: Option<&str>, name: &str, delimiter: &str) -> Result<String> {
    let leaf = clean_box_name(name, delimiter)?;
    let path = parent.map_or(leaf.clone(), |p| format!("{p}{delimiter}{leaf}"));
    let mut s = connect(acc, auth)?;
    s.create(&path)?;
    let _ = s.subscribe(&path);
    let _ = s.logout();
    Ok(path)
}

pub fn rename_mailbox(acc: &Account, auth: &Auth, path: &str, name: &str, delimiter: &str) -> Result<()> {
    let leaf = clean_box_name(name, delimiter)?;
    let target = match path.rsplit_once(delimiter).filter(|_| !delimiter.is_empty()) {
        Some((parent, _)) => format!("{parent}{delimiter}{leaf}"),
        None => leaf,
    };
    let mut s = connect(acc, auth)?;
    s.rename(path, &target)?;
    let _ = s.subscribe(&target);
    let _ = s.logout();
    Ok(())
}

/// Elimina una cartella dell'utente; quelle speciali non si toccano.
pub fn delete_mailbox(acc: &Account, auth: &Auth, path: &str) -> Result<()> {
    if list_mailboxes(acc, auth)?.iter().any(|b| b.path == path && b.special.is_some()) {
        return Err(msg("Le cartelle di sistema non si possono eliminare"));
    }
    let mut s = connect(acc, auth)?;
    s.delete(path)?;
    let _ = s.logout();
    Ok(())
}

/// Cartella dello spam: attributo \\Junk o nomi noti.
fn find_junk(list: &[Name]) -> Option<String> {
    if let Some(n) = list.iter().find(|n| has_attr(n, "\\Junk")) {
        return Some(n.name().to_string());
    }
    list.iter()
        .find(|n| ["Spam", "Junk", "Junk Email", "Junk E-mail", "Posta indesiderata"].iter().any(|x| leaf(n).eq_ignore_ascii_case(x)))
        .map(|n| n.name().to_string())
}

/// Sposta nello spam i messaggi di una casella.
pub fn move_to_junk(acc: &Account, auth: &Auth, mailbox: &str, uids: &[u32]) -> Result<()> {
    let mut s = connect(acc, auth)?;
    let list = s.list(Some(""), Some("*"))?;
    let Some(dest) = find_junk(&list) else {
        let _ = s.logout();
        return Err(msg("Nessuna cartella Spam su questo account"));
    };
    if dest != mailbox {
        s.select(mailbox)?;
        transfer(&mut s, &uid_set(uids), &dest)?;
    }
    let _ = s.logout();
    Ok(())
}

/// Su Gmail un'etichetta è una cartella: copiarci un messaggio gli applica l'etichetta.
pub fn gmail_add_label(acc: &Account, auth: &Auth, mailbox: &str, uids: &[u32], label: &str) -> Result<()> {
    let path = encode_utf7(label);
    let mut s = connect(acc, auth)?;
    // Se esiste già CREATE fallisce: è quello che ci serve sapere solo se poi fallisce anche COPY.
    let _ = s.create(&path);
    s.select(mailbox)?;
    s.uid_copy(uid_set(uids), quoted(&path))?;
    let _ = s.logout();
    Ok(())
}

/// Togliere un messaggio dalla cartella dell'etichetta su Gmail toglie solo l'etichetta.
pub fn gmail_remove_label(acc: &Account, auth: &Auth, message_id: &str, label: &str) -> Result<()> {
    let mut s = connect(acc, auth)?;
    if s.select(encode_utf7(label)).is_ok() {
        drop_by_message_id(&mut s, message_id, false)?;
    }
    let _ = s.logout();
    Ok(())
}

/// Message-ID dei messaggi con un'etichetta: `None` se l'etichetta non esiste sul server.
pub fn gmail_label_members(acc: &Account, auth: &Auth, label: &str) -> Result<Option<LabelMembers>> {
    let mut s = connect(acc, auth)?;
    let path = encode_utf7(label);
    if s.select(&path).is_err() {
        let _ = s.logout();
        return Ok(None);
    }
    let found = s.uid_search("ALL")?;
    let complete = found.len() <= LABEL_LIMIT;
    let uids = newest(found, LABEL_LIMIT);
    let mut ids = Vec::new();
    if !uids.is_empty() {
        for f in s.uid_fetch(uid_set(&uids), "(UID ENVELOPE)")?.iter() {
            if let Some(id) = f.envelope().and_then(|e| e.message_id) {
                ids.push(String::from_utf8_lossy(id).trim().trim_start_matches('<').trim_end_matches('>').to_string());
            }
        }
    }
    let _ = s.logout();
    Ok(Some(LabelMembers { ids, complete }))
}

#[derive(Debug, Serialize)]
pub struct LabelMembers {
    pub ids: Vec<String>,
    /// Falso se l'etichetta ha più messaggi di quelli letti: l'assenza non prova nulla.
    pub complete: bool,
}

/// Insieme di UID per i comandi IMAP: "12,15,40".
fn uid_set(uids: &[u32]) -> String {
    uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",")
}

/// Imposta o toglie un flag su uno o più messaggi della stessa casella, in una sola sessione.
pub fn set_flag(acc: &Account, auth: &Auth, mailbox: &str, uids: &[u32], flag: &str, on: bool) -> Result<()> {
    let mut s = connect(acc, auth)?;
    s.select(mailbox)?;
    let op = if on { "+FLAGS.SILENT" } else { "-FLAGS.SILENT" };
    s.uid_store(uid_set(uids), format!("{op} ({flag})"))?;
    let _ = s.logout();
    Ok(())
}

/// Trasferisce i messaggi della casella selezionata, con MOVE se il server lo supporta.
fn transfer(s: &mut Session, uid: &str, dest: &str) -> Result<()> {
    if s.capabilities()?.has_str("MOVE") {
        s.uid_mv(uid, dest)?;
    } else {
        // A differenza di uid_mv, uid_copy non mette il nome tra virgolette: «Deleted Items» si spezzerebbe.
        s.uid_copy(uid, quoted(dest))?;
        s.uid_store(uid, "+FLAGS.SILENT (\\Deleted)")?;
        s.expunge()?;
    }
    Ok(())
}

/// Sposta uno o più messaggi della stessa casella in una cartella speciale, in una sola sessione.
pub fn move_to(acc: &Account, auth: &Auth, mailbox: &str, uids: &[u32], target: Folder) -> Result<()> {
    let mut s = connect(acc, auth)?;
    let dest = resolve(&mut s, target)?;
    s.select(mailbox)?;
    let uid = uid_set(uids);
    match dest {
        Some(dest) if dest != mailbox => transfer(&mut s, &uid, &dest)?,
        // Già in posta in arrivo: non c'è niente da fare (e il ramo finale cancellerebbe).
        _ if target == Folder::Inbox => {}
        // Gmail senza cartella Archivio esposta: togliere dalla posta in arrivo equivale ad archiviare.
        None if target == Folder::Archive && acc.provider != Provider::Google => {
            let _ = s.logout();
            return Err(msg("Nessuna cartella Archivio su questo account"));
        }
        _ => {
            s.uid_store(&uid, "+FLAGS.SILENT (\\Deleted)")?;
            s.expunge()?;
        }
    }
    let _ = s.logout();
    Ok(())
}

/// Sposta uno o più messaggi in una cartella dell'utente dello stesso account.
pub fn move_to_mailbox(acc: &Account, auth: &Auth, mailbox: &str, uids: &[u32], dest: &str) -> Result<()> {
    if mailbox == dest {
        return Ok(());
    }
    let mut s = connect(acc, auth)?;
    s.select(mailbox)?;
    transfer(&mut s, &uid_set(uids), dest)?;
    let _ = s.logout();
    Ok(())
}

pub fn fetch_raw(acc: &Account, auth: &Auth, mailbox: &str, uid: u32) -> Result<Vec<u8>> {
    let mut s = connect(acc, auth)?;
    s.select(mailbox)?;
    let fetches = s.uid_fetch(uid.to_string(), "BODY.PEEK[]")?;
    let bytes = fetches
        .iter()
        .find_map(|f| f.body().map(<[u8]>::to_vec))
        .ok_or_else(|| msg("Messaggio non più presente sul server"))?;
    let _ = s.logout();
    Ok(bytes)
}

/// Salva una copia del messaggio inviato nella cartella Inviati.
pub fn append_sent(acc: &Account, auth: &Auth, bytes: &[u8]) -> Result<()> {
    let mut s = connect(acc, auth)?;
    if let Some(sent) = resolve(&mut s, Folder::Sent)? {
        s.append_with_flags(sent, bytes, &[Flag::Seen])?;
    }
    let _ = s.logout();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{decode_utf7, encode_utf7, newest, quoted, search_criteria, SearchQuery};

    fn words(q: &str) -> SearchQuery {
        SearchQuery { words: q.split_whitespace().map(str::to_string).collect(), ..Default::default() }
    }

    #[test]
    fn criteri_di_ricerca() {
        assert_eq!(search_criteria(&words("  fattura acme ")).unwrap(), "TEXT \"fattura\" TEXT \"acme\"");
        assert_eq!(search_criteria(&words("perché")).unwrap(), "CHARSET UTF-8 TEXT \"perché\"");
        assert_eq!(search_criteria(&words("a\"b\\c")).unwrap(), "TEXT \"a\\\"b\\\\c\"");
        assert!(search_criteria(&words("   ")).is_none());
    }

    #[test]
    fn filtri_di_ricerca() {
        let q = SearchQuery {
            words: vec!["fattura".into()],
            from: vec!["acme".into()],
            subject: vec!["maggio".into()],
            after: Some("2026-01-31".into()),
            before: Some("non-una-data".into()),
            unread: true,
            ..Default::default()
        };
        assert_eq!(search_criteria(&q).unwrap(), "TEXT \"fattura\" FROM \"acme\" SUBJECT \"maggio\" SENTSINCE 31-Jan-2026 UNSEEN");
        let only_files = SearchQuery { attachment: true, ..Default::default() };
        assert_eq!(search_criteria(&only_files).unwrap(), "ALL");
    }

    #[test]
    fn nomi_utf7_andata_e_ritorno() {
        for name in ["Fatture 2026", "Più & meno", "Città / sede", "日本語", "A&B"] {
            assert_eq!(decode_utf7(&encode_utf7(name)), name);
        }
        assert_eq!(encode_utf7("Posta inviata"), "Posta inviata");
        assert_eq!(encode_utf7("A&B"), "A&-B");
    }

    #[test]
    fn niente_comandi_iniettati() {
        assert_eq!(quoted("x\r\nA1 DELETE INBOX"), "\"xA1 DELETE INBOX\"");
    }

    #[test]
    fn solo_i_piu_recenti() {
        assert_eq!(newest([5, 1, 9, 3], 2), [5, 9]);
        assert_eq!(newest([2], 5), [2]);
    }

    #[test]
    fn nomi_utf7() {
        assert_eq!(decode_utf7("Posta &AOg- arrivata"), "Posta è arrivata");
        assert_eq!(decode_utf7("Fatture &- ricevute"), "Fatture & ricevute");
        assert_eq!(decode_utf7("&ZeVnLIqe-"), "日本語");
        assert_eq!(decode_utf7("Clienti"), "Clienti");
    }
}
