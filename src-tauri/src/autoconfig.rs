//! Ricerca automatica dei server IMAP/SMTP tramite il database ISPDB di Thunderbird.

use serde::Serialize;

use crate::accounts::{Security, Server};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Guess {
    pub found: bool,
    pub imap: Server,
    pub smtp: Server,
}

pub async fn lookup(email: &str) -> Guess {
    let domain = email.rsplit('@').next().unwrap_or_default().trim().to_lowercase();
    let fallback = Guess {
        found: false,
        imap: Server { host: format!("imap.{domain}"), port: 993, security: Security::Tls },
        smtp: Server { host: format!("smtp.{domain}"), port: 465, security: Security::Tls },
    };
    if domain.is_empty() {
        return fallback;
    }
    let url = format!("https://autoconfig.thunderbird.net/v1.1/{domain}");
    let Ok(resp) = reqwest::get(&url).await else { return fallback };
    if !resp.status().is_success() {
        return fallback;
    }
    let Ok(xml) = resp.text().await else { return fallback };
    let imap = block(&xml, "<incomingServer type=\"imap\">", "</incomingServer>").and_then(|b| server(b, &domain));
    let smtp = block(&xml, "<outgoingServer type=\"smtp\">", "</outgoingServer>").and_then(|b| server(b, &domain));
    match (imap, smtp) {
        (Some(imap), Some(smtp)) => Guess { found: true, imap, smtp },
        _ => fallback,
    }
}

fn block<'a>(xml: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = xml.find(open)? + open.len();
    let end = xml[start..].find(close)? + start;
    Some(&xml[start..end])
}

fn tag<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    block(xml, &format!("<{name}>"), &format!("</{name}>")).map(str::trim)
}

fn server(xml: &str, domain: &str) -> Option<Server> {
    let host = tag(xml, "hostname")?.replace("%EMAILDOMAIN%", domain);
    let port = tag(xml, "port")?.parse().ok()?;
    let security = match tag(xml, "socketType")? {
        "SSL" => Security::Tls,
        "STARTTLS" => Security::Starttls,
        _ => return None,
    };
    Some(Server { host, port, security })
}
