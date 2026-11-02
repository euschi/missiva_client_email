//! Composizione e invio dei messaggi via SMTP.

use lettre::message::header::ContentType;
use lettre::message::{Attachment, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::{Message, SmtpTransport, Transport};
use serde::{Deserialize, Serialize};

use crate::accounts::{Account, Security};
use crate::error::Result;
use crate::imap_client::Auth;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Outgoing {
    pub account_id: String,
    pub to: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    #[serde(default)]
    pub bcc: Vec<String>,
    pub subject: String,
    pub body: String,
    /// Versione HTML del corpo, presente solo se il testo usa la formattazione.
    #[serde(default)]
    pub html: Option<String>,
    /// Percorsi locali dei file da allegare.
    #[serde(default)]
    pub attachments: Vec<String>,
    pub in_reply_to: Option<String>,
    /// Catena della conversazione (header References), dal messaggio più vecchio.
    #[serde(default)]
    pub references: Vec<String>,
    /// Message-ID scelto da Missiva, per riconoscere subito la risposta nella conversazione.
    #[serde(default)]
    pub message_id: Option<String>,
}

/// Gli id nelle intestazioni vanno tra parentesi angolari (RFC 5322).
fn angle(id: &str) -> String {
    let id = id.trim().trim_start_matches('<').trim_end_matches('>');
    format!("<{id}>")
}

/// Messaggio da spedire: gli indirizzi devono essere validi e la firma va in fondo al testo.
pub fn build(acc: &Account, out: &Outgoing) -> Result<Message> {
    let mut b = Message::builder();
    for to in &out.to {
        b = b.to(to.parse()?);
    }
    for cc in &out.cc {
        b = b.cc(cc.parse()?);
    }
    for bcc in &out.bcc {
        b = b.bcc(bcc.parse()?);
    }
    assemble(b, acc, out, !acc.signature.trim().is_empty())
}

/// Bozza da salvare: può non avere destinatari o averne di incompleti (si tengono solo i validi).
/// Senza firma, che verrebbe duplicata alla riapertura: la aggiunge l'invio.
pub fn build_draft(acc: &Account, out: &Outgoing) -> Result<Message> {
    let mut b = Message::builder();
    for to in out.to.iter().filter_map(|a| a.parse().ok()) {
        b = b.to(to);
    }
    for cc in out.cc.iter().filter_map(|a| a.parse().ok()) {
        b = b.cc(cc);
    }
    // L'envelope serve solo a lettre, che altrimenti rifiuta un messaggio senza destinatari.
    let own: lettre::Address = acc.email.parse()?;
    let b = b.envelope(lettre::address::Envelope::new(Some(own.clone()), vec![own])?);
    assemble(b, acc, out, false)
}

fn assemble(b: lettre::message::MessageBuilder, acc: &Account, out: &Outgoing, signed: bool) -> Result<Message> {
    let mut b = b.from(Mailbox::new(Some(acc.display_name.clone()), acc.email.parse()?)).subject(&out.subject);
    if let Some(id) = &out.message_id {
        b = b.message_id(Some(angle(id)));
    }
    let mut refs: Vec<String> = out.references.iter().map(|r| angle(r)).collect();
    if let Some(id) = &out.in_reply_to {
        b = b.in_reply_to(angle(id));
        if !refs.contains(&angle(id)) {
            refs.push(angle(id));
        }
    }
    if !refs.is_empty() {
        b = b.references(refs.join(" "));
    }

    let body = if signed { format!("{}\n\n-- \n{}", out.body, acc.signature) } else { out.body.clone() };
    let html = out.html.as_ref().map(|h| {
        let sig = if signed { format!("<p style=\"color:#666\">-- <br>{}</p>", escape_html(&acc.signature).replace('\n', "<br>")) } else { String::new() };
        format!("<!doctype html><html><body style=\"font-family:sans-serif;line-height:1.5\">{h}{sig}</body></html>")
    });

    if out.attachments.is_empty() {
        return Ok(match html {
            Some(h) => b.multipart(MultiPart::alternative_plain_html(body, h))?,
            None => b.header(ContentType::TEXT_PLAIN).body(body)?,
        });
    }
    let mut parts = match html {
        Some(h) => MultiPart::mixed().multipart(MultiPart::alternative_plain_html(body, h)),
        None => MultiPart::mixed().singlepart(SinglePart::plain(body)),
    };
    for path in &out.attachments {
        let bytes = std::fs::read(path)?;
        let name = std::path::Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "allegato".into());
        let ctype = ContentType::parse("application/octet-stream").expect("content type valido");
        parts = parts.singlepart(Attachment::new(name).body(bytes, ctype));
    }
    Ok(b.multipart(parts)?)
}

pub fn send(acc: &Account, auth: &Auth, message: &Message) -> Result<()> {
    let builder = match acc.smtp.security {
        Security::Tls => SmtpTransport::relay(&acc.smtp.host)?,
        Security::Starttls => SmtpTransport::starttls_relay(&acc.smtp.host)?,
    }
    .port(acc.smtp.port);
    let builder = match auth {
        Auth::Password(p) => builder.credentials(Credentials::new(acc.username.clone(), p.clone())),
        Auth::Token(t) => builder
            .credentials(Credentials::new(acc.username.clone(), t.clone()))
            .authentication(vec![Mechanism::Xoauth2]),
    };
    builder.build().send(message)?;
    Ok(())
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::{Provider, Server};

    fn account() -> Account {
        let server = Server { host: "h".into(), port: 993, security: Security::Tls };
        Account {
            id: "a".into(),
            name: "A".into(),
            email: "io@esempio.it".into(),
            display_name: "Io".into(),
            provider: Provider::Imap,
            color: "#fff".into(),
            imap: server.clone(),
            smtp: server,
            username: "io".into(),
            sync_days: 30,
            signature: "La mia firma".into(),
        }
    }

    fn outgoing(to: &[&str]) -> Outgoing {
        Outgoing {
            account_id: "a".into(),
            to: to.iter().map(|s| s.to_string()).collect(),
            cc: vec![],
            bcc: vec![],
            subject: "Oggetto".into(),
            body: "Testo".into(),
            html: None,
            attachments: vec![],
            in_reply_to: None,
            references: vec![],
            message_id: Some("id@esempio.it".into()),
        }
    }

    #[test]
    fn bozza_senza_destinatari_e_senza_firma() {
        let raw = String::from_utf8(build_draft(&account(), &outgoing(&[])).unwrap().formatted()).unwrap();
        assert!(raw.contains("Message-ID: <id@esempio.it>"));
        assert!(!raw.contains("La mia firma"));
        assert!(!raw.contains("\nTo:"));
    }

    #[test]
    fn bozza_scarta_gli_indirizzi_incompleti() {
        let raw = String::from_utf8(build_draft(&account(), &outgoing(&["mar", "a@b.it"])).unwrap().formatted()).unwrap();
        assert!(raw.contains("To: a@b.it"));
        assert!(!raw.contains("mar,"));
    }

    #[test]
    fn invio_con_firma_e_indirizzi_validi() {
        let raw = String::from_utf8(build(&account(), &outgoing(&["a@b.it"])).unwrap().formatted()).unwrap();
        assert!(raw.contains("La mia firma"));
        assert!(build(&account(), &outgoing(&["mar"])).is_err());
    }
}
