//! Operazioni IMAP sincrone: da chiamare dentro `spawn_blocking`.

use std::net::TcpStream;

use base64::engine::general_purpose::STANDARD_NO_PAD;
use base64::Engine;
use imap::types::{Flag, Name, NameAttribute};
use serde::{Deserialize, Serialize};
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

fn fetch_in(acc: &Account, mut s: Session, folder: Folder, mailbox: &str) -> Result<Vec<Message>> {
    let bucket = mail::bucket(folder, mailbox);
    s.select(mailbox)?;
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
                mailbox,
                uid: f.uid?,
                unread: !flags.contains(&Flag::Seen),
                flagged: flags.contains(&Flag::Flagged),
                internal_date: f.internal_date().map(|d| d.timestamp()),
                bytes: f.body()?,
            })
        })
        .collect();
    // Copia completa su disco per HTML e allegati; quelli non più presenti si eliminano.
    for f in fetches.iter() {
        if let (Some(uid), Some(bytes)) = (f.uid, f.body()) {
            let _ = mail::store_raw(&acc.id, &bucket, uid, bytes);
        }
    }
    mail::prune_raw(&acc.id, &bucket, uids);
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

#[cfg(test)]
mod tests {
    use super::decode_utf7;

    #[test]
    fn nomi_utf7() {
        assert_eq!(decode_utf7("Posta &AOg- arrivata"), "Posta è arrivata");
        assert_eq!(decode_utf7("Fatture &- ricevute"), "Fatture & ricevute");
        assert_eq!(decode_utf7("&ZeVnLIqe-"), "日本語");
        assert_eq!(decode_utf7("Clienti"), "Clienti");
    }
}
