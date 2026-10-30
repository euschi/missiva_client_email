//! Operazioni IMAP sincrone: da chiamare dentro `spawn_blocking`.

use std::net::TcpStream;

use imap::types::{Flag, NameAttribute};
use native_tls::TlsStream;

use crate::accounts::{Account, Provider, Security};
use crate::error::{msg, Result};
use crate::mail::{self, Folder, Message, Raw};

type Session = imap::Session<TlsStream<TcpStream>>;

/// Massimo di messaggi scaricati per cartella a ogni sincronizzazione.
const FETCH_LIMIT: usize = 60;

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

/// Trova la casella IMAP di una cartella: prima per attributo SPECIAL-USE, poi per nome comune.
pub fn resolve(session: &mut Session, folder: Folder) -> Result<Option<String>> {
    let (special, names): (&str, &[&str]) = match folder {
        Folder::Inbox => return Ok(Some("INBOX".into())),
        Folder::Drafts => ("\\Drafts", &["Drafts", "Bozze", "Draft"]),
        Folder::Sent => ("\\Sent", &["Sent", "Sent Items", "Sent Messages", "Sent Mail", "Inviati", "Posta inviata"]),
        Folder::Archive => ("\\Archive", &["Archive", "Archivio", "All Mail"]),
        Folder::Trash => ("\\Trash", &["Trash", "Deleted Items", "Deleted Messages", "Cestino", "Bin"]),
    };
    let list = session.list(Some(""), Some("*"))?;
    let by_attr = list.iter().find(|n| {
        n.attributes()
            .iter()
            .any(|a| matches!(a, NameAttribute::Custom(c) if c.eq_ignore_ascii_case(special)))
    });
    if let Some(n) = by_attr {
        return Ok(Some(n.name().to_string()));
    }
    let by_name = list.iter().find(|n| {
        let delim = n.delimiter().unwrap_or("/");
        let leaf = n.name().rsplit(delim).next().unwrap_or(n.name());
        names.iter().any(|x| leaf.eq_ignore_ascii_case(x))
    });
    Ok(by_name.map(|n| n.name().to_string()))
}

pub fn fetch_folder(acc: &Account, auth: &Auth, folder: Folder) -> Result<Vec<Message>> {
    let mut s = connect(acc, auth)?;
    let Some(mailbox) = resolve(&mut s, folder)? else {
        let _ = s.logout();
        return Ok(Vec::new());
    };
    s.select(&mailbox)?;
    let since = (chrono::Local::now() - chrono::Duration::days(acc.sync_days as i64)).format("%d-%b-%Y");
    let mut uids: Vec<u32> = s.uid_search(format!("SINCE {since}"))?.into_iter().collect();
    uids.sort_unstable();
    let uids = &uids[uids.len().saturating_sub(FETCH_LIMIT)..];
    if uids.is_empty() {
        let _ = s.logout();
        return Ok(Vec::new());
    }
    let set = uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let fetches = s.uid_fetch(set, "(UID FLAGS INTERNALDATE BODY.PEEK[])")?;
    let mut out: Vec<Message> = fetches
        .iter()
        .filter_map(|f| {
            let flags = f.flags();
            mail::parse(Raw {
                account_id: &acc.id,
                folder,
                mailbox: &mailbox,
                uid: f.uid?,
                unread: !flags.contains(&Flag::Seen),
                flagged: flags.contains(&Flag::Flagged),
                internal_date: f.internal_date().map(|d| d.timestamp()),
                bytes: f.body()?,
            })
        })
        .collect();
    out.sort_by(|a, b| b.date.cmp(&a.date));
    let _ = s.logout();
    Ok(out)
}

pub fn set_flag(acc: &Account, auth: &Auth, mailbox: &str, uid: u32, flag: &str, on: bool) -> Result<()> {
    let mut s = connect(acc, auth)?;
    s.select(mailbox)?;
    let op = if on { "+FLAGS.SILENT" } else { "-FLAGS.SILENT" };
    s.uid_store(uid.to_string(), format!("{op} ({flag})"))?;
    let _ = s.logout();
    Ok(())
}

/// Sposta un messaggio in Archivio o Cestino.
pub fn move_to(acc: &Account, auth: &Auth, mailbox: &str, uid: u32, target: Folder) -> Result<()> {
    let mut s = connect(acc, auth)?;
    let dest = resolve(&mut s, target)?;
    s.select(mailbox)?;
    let uid = uid.to_string();
    match dest {
        Some(dest) if dest != mailbox => {
            if s.capabilities()?.has_str("MOVE") {
                s.uid_mv(&uid, &dest)?;
            } else {
                s.uid_copy(&uid, &dest)?;
                s.uid_store(&uid, "+FLAGS.SILENT (\\Deleted)")?;
                s.expunge()?;
            }
        }
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
