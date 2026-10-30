//! Modello dei messaggi, parsing MIME e cache locale in ~/.cache/missiva/.

use std::fs;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use mail_parser::decoders::html::html_to_text;
use mail_parser::{Address, MessageParser, MessagePart, MimeHeaders, PartType};
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
    /// Cartella creata dall'utente: la casella IMAP vera è in `Message::mailbox`.
    Other,
}

impl Folder {
    pub fn key(self) -> &'static str {
        match self {
            Folder::Inbox => "inbox",
            Folder::Drafts => "drafts",
            Folder::Sent => "sent",
            Folder::Archive => "archive",
            Folder::Trash => "trash",
            Folder::Other => "other",
        }
    }
}

/// Chiave di cache e id di una cartella: le speciali per nome, le altre dalla casella IMAP
/// (caratteri sicuri per un nome di file più un hash che evita collisioni).
pub fn bucket(folder: Folder, mailbox: &str) -> String {
    if folder != Folder::Other {
        return folder.key().to_string();
    }
    let safe: String = mailbox.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).take(40).collect();
    let hash = mailbox.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ b as u64).wrapping_mul(0x0100_0000_01b3));
    format!("box-{safe}-{hash:016x}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMeta {
    pub index: usize,
    pub name: String,
    pub size: usize,
    /// Estensione breve mostrata sulla miniatura (PDF, PNG…).
    pub kind: String,
    /// Tipo MIME, per scegliere l'anteprima.
    #[serde(default)]
    pub mime: String,
    /// Immagine richiamata dall'HTML con `cid:`: si vede già nel messaggio.
    #[serde(default)]
    pub inline: bool,
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
    /// Message-ID a cui risponde: lega il messaggio alla sua conversazione.
    #[serde(default)]
    pub in_reply_to: Option<String>,
    /// Catena della conversazione (header References).
    #[serde(default)]
    pub references: Vec<String>,
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
    /// Il messaggio ha una parte HTML da mostrare al posto del testo.
    #[serde(default)]
    pub has_html: bool,
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

    let body = match m.text_bodies().next().map(|p| &p.body) {
        Some(PartType::Html(html)) => html_to_text(&strip_hidden_html(html)),
        _ => m.body_text(0).map(|b| b.into_owned()).unwrap_or_default(),
    };
    let body = normalize_body(&body);
    let snippet: String = body.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(180).collect();

    let html = html_source(&m);
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
            let inline = html.zip(content_id(part)).is_some_and(|(h, cid)| h.contains(&format!("cid:{cid}")));
            AttachmentMeta {
                index,
                size: part.contents().len(),
                kind: kind.chars().take(4).collect(),
                mime: mime_of(part, &name),
                inline,
                name,
            }
        })
        .collect();

    Some(Message {
        id: format!("{}:{}:{}", raw.account_id, bucket(raw.folder, raw.mailbox), raw.uid),
        account_id: raw.account_id.to_string(),
        folder: raw.folder,
        mailbox: raw.mailbox.to_string(),
        uid: raw.uid,
        message_id: m.message_id().map(str::to_string),
        in_reply_to: ids(m.in_reply_to()).pop(),
        references: ids(m.references()),
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
        has_html: html.is_some(),
    })
}

/// Id di un'intestazione In-Reply-To o References, senza parentesi angolari.
fn ids(h: &mail_parser::HeaderValue) -> Vec<String> {
    h.as_text_list()
        .unwrap_or_default()
        .iter()
        .flat_map(|v| v.split_whitespace())
        .map(|id| id.trim_start_matches('<').trim_end_matches('>').to_string())
        .filter(|id| !id.is_empty())
        .collect()
}

/// Sorgente HTML vera del messaggio (non quella ricavata da una parte di solo testo).
fn html_source<'a>(m: &'a mail_parser::Message) -> Option<&'a str> {
    m.html_bodies().find_map(|p| match &p.body {
        PartType::Html(h) => Some(h.as_ref()),
        _ => None,
    })
}

fn content_id<'a>(part: &'a MessagePart) -> Option<&'a str> {
    part.content_id().map(|c| c.trim().trim_start_matches('<').trim_end_matches('>')).filter(|c| !c.is_empty())
}

fn mime_of(part: &MessagePart, name: &str) -> String {
    let declared = part
        .content_type()
        .map(|c| format!("{}/{}", c.ctype(), c.subtype().unwrap_or("")).to_ascii_lowercase())
        .filter(|m| m != "application/octet-stream" && !m.ends_with('/'));
    declared.unwrap_or_else(|| {
        let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        match ext.as_str() {
            "pdf" => "application/pdf",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "txt" | "log" | "md" => "text/plain",
            "csv" => "text/csv",
            "json" => "application/json",
            _ => "application/octet-stream",
        }
        .to_string()
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HtmlView {
    pub html: String,
    /// Ci sono immagini o stili caricati da internet.
    pub remote: bool,
}

/// HTML del messaggio pronto da mostrare: immagini `cid:` incorporate come data URI,
/// senza `<meta>` (un refresh caricherebbe pagine esterne) né `<base>`.
pub fn html_view(bytes: &[u8]) -> Result<Option<HtmlView>> {
    let m = MessageParser::default().parse(bytes).ok_or_else(|| msg("Messaggio illeggibile"))?;
    let Some(src) = html_source(&m) else { return Ok(None) };
    let mut html = remove_tags(src, &["meta", "base"]);
    for part in &m.parts {
        let Some(cid) = content_id(part) else { continue };
        let needle = format!("cid:{cid}");
        if html.contains(&needle) {
            let mime = mime_of(part, part.attachment_name().unwrap_or_default());
            html = html.replace(&needle, &format!("data:{mime};base64,{}", STANDARD.encode(part.contents())));
        }
    }
    let lower = html.to_ascii_lowercase();
    let remote = lower.contains("<link")
        || ["src=\"http", "src='http", "src=http", "url(http", "url('http", "url(\"http", "background=\"http"]
            .iter()
            .any(|p| lower.contains(p));
    Ok(Some(HtmlView { html, remote }))
}

/// Toglie i tag vuoti indicati (`<meta …>`, `<base …>`), maiuscole comprese.
fn remove_tags(html: &str, tags: &[&str]) -> String {
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut pos = 0;
    while let Some(rel) = lower[pos..].find('<') {
        let start = pos + rel;
        let rest = &lower[start + 1..];
        let hit = tags
            .iter()
            .any(|t| rest.starts_with(*t) && rest[t.len()..].starts_with(|c: char| c == '>' || c == '/' || c.is_ascii_whitespace()));
        match lower[start..].find('>').filter(|_| hit) {
            Some(e) => {
                out.push_str(&html[pos..start]);
                pos = start + e + 1;
            }
            None => {
                out.push_str(&html[pos..=start]);
                pos = start + 1;
            }
        }
    }
    out.push_str(&html[pos..]);
    out
}

/// Toglie commenti e blocchi `<head>`, `<style>` e `<script>` prima della conversione in testo:
/// mail-parser li riconosce solo se il tag non ha attributi (`<style type="text/css">` gli sfugge)
/// e il CSS finirebbe nel corpo del messaggio.
fn strip_hidden_html(html: &str) -> String {
    // Solo lettere ASCII cambiano: gli indici di `lower` valgono anche per `html`.
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len());
    let mut pos = 0;
    while let Some(rel) = lower[pos..].find('<') {
        let start = pos + rel;
        let rest = &lower[start + 1..];
        let end = if rest.starts_with("!--") {
            lower[start..].find("-->").map(|e| start + e + 3)
        } else {
            ["head", "style", "script"]
                .iter()
                .find(|t| rest.starts_with(**t) && rest[t.len()..].starts_with(|c: char| c == '>' || c == '/' || c.is_ascii_whitespace()))
                .map(|t| match lower[start..].find(&format!("</{t}")) {
                    Some(e) => lower[start + e..].find('>').map_or(lower.len(), |g| start + e + g + 1),
                    // Blocco mai chiuso: il resto non è testo leggibile.
                    None => lower.len(),
                })
        };
        match end {
            Some(end) => {
                out.push_str(&html[pos..start]);
                pos = end;
            }
            None => {
                out.push_str(&html[pos..=start]);
                pos = start + 1;
            }
        }
    }
    out.push_str(&html[pos..]);
    out
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

fn cache_dir() -> Result<PathBuf> {
    let dir = dirs::cache_dir().ok_or_else(|| msg("Cartella cache non trovata"))?.join("missiva");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// File di cache di un account: `bucket` è una chiave di [`bucket`] oppure un nome come "mailboxes".
pub fn cache_path(account_id: &str, bucket: &str) -> Result<PathBuf> {
    Ok(cache_dir()?.join(format!("{account_id}-{bucket}.json")))
}

pub fn read_cache(account_id: &str, bucket: &str) -> Vec<Message> {
    cache_path(account_id, bucket)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write_cache(account_id: &str, bucket: &str, msgs: &[Message]) -> Result<()> {
    fs::write(cache_path(account_id, bucket)?, serde_json::to_string(msgs)?)?;
    Ok(())
}

pub fn update_cache(account_id: &str, bucket: &str, f: impl FnOnce(&mut Vec<Message>)) -> Result<()> {
    let mut msgs = read_cache(account_id, bucket);
    f(&mut msgs);
    write_cache(account_id, bucket, &msgs)
}

/// Elimina tutta la cache dell'account: cartelle, elenco delle caselle e messaggi completi.
pub fn clear_cache(account_id: &str) {
    let Ok(dir) = cache_dir() else { return };
    let prefix = format!("{account_id}-");
    for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            let _ = fs::remove_file(entry.path());
        }
    }
    let _ = fs::remove_dir_all(dir.join("raw").join(account_id));
}

/// Messaggi completi (.eml) in ~/.cache/missiva/raw/<account>/<cartella>/<uid>.eml:
/// servono per HTML e allegati senza riscaricarli dal server.
fn raw_dir(account_id: &str, bucket: &str) -> Result<PathBuf> {
    let dir = cache_dir()?.join("raw").join(account_id).join(bucket);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn store_raw(account_id: &str, bucket: &str, uid: u32, bytes: &[u8]) -> Result<()> {
    let path = raw_dir(account_id, bucket)?.join(format!("{uid}.eml"));
    if !path.exists() {
        fs::write(path, bytes)?;
    }
    Ok(())
}

pub fn read_raw(account_id: &str, bucket: &str, uid: u32) -> Option<Vec<u8>> {
    fs::read(raw_dir(account_id, bucket).ok()?.join(format!("{uid}.eml"))).ok()
}

/// Elimina i messaggi grezzi che non sono più nella cartella.
pub fn prune_raw(account_id: &str, bucket: &str, keep: &[u32]) {
    let Ok(entries) = raw_dir(account_id, bucket).and_then(|d| Ok(fs::read_dir(d)?)) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let uid = path.file_stem().and_then(|s| s.to_str()).and_then(|s| s.parse::<u32>().ok());
        if uid.is_none_or(|u| !keep.contains(&u)) {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_senza_css_e_script() {
        let html = r#"<html><head lang="it"><title>T</title></head><body>
            <style type="text/css">* { font-family: Arial; } .footer { color: #fff; }</style>
            <!-- commento <p>nascosto</p> -->
            <SCRIPT type="text/javascript">alert(1)</SCRIPT>
            <p>Gentile Eugenio,</p><p>grazie per la candidatura.</p></body></html>"#;
        let text = normalize_body(&html_to_text(&strip_hidden_html(html)));
        assert!(text.starts_with("Gentile Eugenio,"), "{text}");
        assert!(text.contains("grazie per la candidatura."));
        for hidden in ["font-family", "footer", "alert", "nascosto"] {
            assert!(!text.contains(hidden), "{hidden} in {text}");
        }
    }

    const MULTIPART: &str = "From: a@b.it\r\nTo: c@d.it\r\nSubject: Prova\r\nMIME-Version: 1.0\r\n\
Content-Type: multipart/related; boundary=\"XX\"\r\n\r\n\
--XX\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
<html><head><META http-equiv=\"refresh\" content=\"0;url=https://x.it\"><style type=\"text/css\">p{color:red}</style></head>\
<body><p>Ciao</p><img src=\"cid:logo@x\"><img src=\"https://tracker.it/p.gif\"></body></html>\r\n\
--XX\r\nContent-Type: image/png\r\nContent-ID: <logo@x>\r\nContent-Disposition: inline; filename=\"logo.png\"\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n\
--XX\r\nContent-Type: application/pdf; name=\"doc.pdf\"\r\nContent-Disposition: attachment; filename=\"doc.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0=\r\n\
--XX--\r\n";

    #[test]
    fn vista_html_con_immagini_incorporate() {
        let view = html_view(MULTIPART.as_bytes()).unwrap().expect("ha HTML");
        assert!(view.html.contains("src=\"data:image/png;base64,iVBORw0KGgo=\""), "{}", view.html);
        assert!(!view.html.to_ascii_lowercase().contains("<meta"));
        assert!(view.html.contains("p{color:red}"), "gli stili restano");
        assert!(view.remote);

        let m = parse(Raw {
            account_id: "a",
            folder: Folder::Inbox,
            mailbox: "INBOX",
            uid: 1,
            unread: true,
            flagged: false,
            internal_date: None,
            bytes: MULTIPART.as_bytes(),
        })
        .unwrap();
        assert!(m.has_html);
        assert_eq!(m.body, "Ciao");
        let logo = m.attachments.iter().find(|a| a.name == "logo.png").unwrap();
        assert!(logo.inline && logo.mime == "image/png");
        let pdf = m.attachments.iter().find(|a| a.name == "doc.pdf").unwrap();
        assert!(!pdf.inline && pdf.mime == "application/pdf");
    }

    #[test]
    fn intestazioni_della_conversazione() {
        let raw = "From: a@b.it\r\nTo: c@d.it\r\nSubject: Re: Prova\r\nMessage-ID: <3@x>\r\n\
In-Reply-To: <2@x>\r\nReferences: <1@x> <2@x>\r\n\r\nCiao\r\n";
        let m = parse(Raw {
            account_id: "a",
            folder: Folder::Inbox,
            mailbox: "INBOX",
            uid: 3,
            unread: false,
            flagged: false,
            internal_date: None,
            bytes: raw.as_bytes(),
        })
        .unwrap();
        assert_eq!(m.message_id.as_deref(), Some("3@x"));
        assert_eq!(m.in_reply_to.as_deref(), Some("2@x"));
        assert_eq!(m.references, ["1@x", "2@x"]);
    }

    #[test]
    fn tag_simili_restano() {
        // <styled> e <header> non sono blocchi da togliere; un "<" isolato resta testo.
        let html = "<header>Titolo</header><p>a < b</p><styled>ok</styled>";
        assert_eq!(strip_hidden_html(html), html);
    }
}
