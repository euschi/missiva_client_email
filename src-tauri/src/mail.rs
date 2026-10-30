//! Modello dei messaggi, parsing MIME e cache locale in ~/.cache/missiva/.

use std::fs;
use std::path::PathBuf;

use mail_parser::{Address, MessageParser, MimeHeaders};
use serde::{Deserialize, Serialize};

use crate::error::{msg, Result};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Folder {
    Inbox,
    Drafts,
    Sent,
    Archive,
    Trash,
}

impl Folder {
    pub fn key(self) -> &'static str {
        match self {
            Folder::Inbox => "inbox",
            Folder::Drafts => "drafts",
            Folder::Sent => "sent",
            Folder::Archive => "archive",
            Folder::Trash => "trash",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMeta {
    pub index: usize,
    pub name: String,
    pub size: usize,
    /// Estensione breve mostrata sulla miniatura (PDF, PNG…).
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub account_id: String,
    pub folder: Folder,
    pub mailbox: String,
    pub uid: u32,
    pub message_id: Option<String>,
    pub from_name: String,
    pub from_email: String,
    pub to: Vec<Contact>,
    pub cc: Vec<Contact>,
    pub subject: String,
    pub snippet: String,
    pub body: String,
    /// Secondi Unix.
    pub date: i64,
    pub unread: bool,
    pub flagged: bool,
    pub attachments: Vec<AttachmentMeta>,
}

fn addr_list(a: Option<&Address>) -> Vec<Contact> {
    a.map(|a| {
        a.iter()
            .filter_map(|x| {
                let email = x.address()?.to_string();
                let name = x.name().filter(|n| !n.trim().is_empty()).unwrap_or(&email).to_string();
                Some(Contact { name, email })
            })
            .collect()
    })
    .unwrap_or_default()
}

pub struct Raw<'a> {
    pub account_id: &'a str,
    pub folder: Folder,
    pub mailbox: &'a str,
    pub uid: u32,
    pub unread: bool,
    pub flagged: bool,
    pub internal_date: Option<i64>,
    pub bytes: &'a [u8],
}

pub fn parse(raw: Raw) -> Option<Message> {
    let m = MessageParser::default().parse(raw.bytes)?;
    let from = m.from().and_then(|a| a.first());
    let from_email = from.and_then(|a| a.address()).unwrap_or_default().to_string();
    let from_name = from
        .and_then(|a| a.name())
        .filter(|n| !n.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| from_email.clone());

    let body = m.body_text(0).map(|b| b.into_owned()).unwrap_or_default();
    let body = normalize_body(&body);
    let snippet: String = body.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(180).collect();

    let attachments = m
        .attachments()
        .enumerate()
        .map(|(index, part)| {
            let name = part.attachment_name().unwrap_or("allegato").to_string();
            let kind = name
                .rsplit_once('.')
                .map(|(_, ext)| ext.to_uppercase())
                .filter(|e| e.len() <= 4)
                .or_else(|| part.content_type().and_then(|c| c.subtype()).map(|s| s.to_uppercase()))
                .unwrap_or_else(|| "FILE".into());
            AttachmentMeta { index, name, size: part.contents().len(), kind: kind.chars().take(4).collect() }
        })
        .collect();

    Some(Message {
        id: format!("{}:{}:{}", raw.account_id, raw.folder.key(), raw.uid),
        account_id: raw.account_id.to_string(),
        folder: raw.folder,
        mailbox: raw.mailbox.to_string(),
        uid: raw.uid,
        message_id: m.message_id().map(str::to_string),
        from_name,
        from_email,
        to: addr_list(m.to()),
        cc: addr_list(m.cc()),
        subject: m.subject().filter(|s| !s.trim().is_empty()).unwrap_or("(nessun oggetto)").to_string(),
        snippet,
        body,
        date: m.date().map(|d| d.to_timestamp()).or(raw.internal_date).unwrap_or_default(),
        unread: raw.unread,
        flagged: raw.flagged,
        attachments,
    })
}

/// Rimuove spazi finali e righe vuote multiple, così i paragrafi si separano con una riga vuota.
fn normalize_body(s: &str) -> String {
    let mut out = String::new();
    let mut blank = 0;
    for line in s.replace("\r\n", "\n").lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blank += 1;
            continue;
        }
        if !out.is_empty() {
            out.push_str(if blank > 0 { "\n\n" } else { "\n" });
        }
        blank = 0;
        out.push_str(line);
    }
    out
}

/// Estrae il contenuto dell'allegato `index` da un messaggio grezzo.
pub fn attachment(bytes: &[u8], index: usize) -> Result<(String, Vec<u8>)> {
    let m = MessageParser::default().parse(bytes).ok_or_else(|| msg("Messaggio illeggibile"))?;
    let part = m.attachments().nth(index).ok_or_else(|| msg("Allegato non trovato"))?;
    Ok((part.attachment_name().unwrap_or("allegato").to_string(), part.contents().to_vec()))
}

fn cache_path(account_id: &str, folder: Folder) -> Result<PathBuf> {
    let dir = dirs::cache_dir().ok_or_else(|| msg("Cartella cache non trovata"))?.join("missiva");
    fs::create_dir_all(&dir)?;
    Ok(dir.join(format!("{account_id}-{}.json", folder.key())))
}

pub fn read_cache(account_id: &str, folder: Folder) -> Vec<Message> {
    cache_path(account_id, folder)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write_cache(account_id: &str, folder: Folder, msgs: &[Message]) -> Result<()> {
    fs::write(cache_path(account_id, folder)?, serde_json::to_string(msgs)?)?;
    Ok(())
}

pub fn update_cache(account_id: &str, folder: Folder, f: impl FnOnce(&mut Vec<Message>)) -> Result<()> {
    let mut msgs = read_cache(account_id, folder);
    f(&mut msgs);
    write_cache(account_id, folder, &msgs)
}

pub fn clear_cache(account_id: &str) {
    for f in [Folder::Inbox, Folder::Drafts, Folder::Sent, Folder::Archive, Folder::Trash] {
        if let Ok(p) = cache_path(account_id, f) {
            let _ = fs::remove_file(p);
        }
    }
}
