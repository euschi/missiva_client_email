//! Inviti di calendario (iCalendar) dentro i messaggi: lettura e risposta al mittente.

use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use mail_parser::{MessageParser, MimeHeaders};
use serde::Serialize;

use crate::error::{msg, Result};

/// Invito come lo mostra il frontend.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub summary: String,
    /// Secondi Unix. Gli orari con fuso nominato si leggono come ora locale.
    pub start: Option<i64>,
    pub end: Option<i64>,
    pub all_day: bool,
    pub location: Option<String>,
    pub organizer: Option<String>,
    /// REQUEST (si può rispondere), CANCEL, PUBLISH…
    pub method: String,
}

/// Testo iCalendar del messaggio, in una parte `text/calendar` o in un allegato `.ics`.
pub fn ics_of(bytes: &[u8]) -> Option<String> {
    let m = MessageParser::default().parse(bytes)?;
    m.parts.iter().find_map(|part| {
        let calendar = part.content_type().is_some_and(|c| c.c_type.eq_ignore_ascii_case("text") && c.subtype().is_some_and(|s| s.eq_ignore_ascii_case("calendar")));
        let named = part.attachment_name().is_some_and(|n| n.to_lowercase().ends_with(".ics"));
        (calendar || named).then(|| String::from_utf8_lossy(part.contents()).into_owned())
    })
}

/// Righe logiche: una riga che inizia con spazio o tab continua la precedente.
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for line in text.lines() {
        match (line.strip_prefix([' ', '\t']), lines.last_mut()) {
            (Some(rest), Some(last)) => last.push_str(rest),
            _ => lines.push(line.to_string()),
        }
    }
    lines
}

/// Proprietà di una riga: nome in maiuscolo, parametri e valore grezzo.
fn property(line: &str) -> Option<(String, &str, &str)> {
    // I due punti dentro un parametro tra virgolette non chiudono il nome.
    let mut quoted = false;
    let colon = line.char_indices().find_map(|(i, c)| {
        if c == '"' {
            quoted = !quoted;
        }
        (c == ':' && !quoted).then_some(i)
    })?;
    let (head, value) = (&line[..colon], &line[colon + 1..]);
    let (name, params) = head.split_once(';').unwrap_or((head, ""));
    Some((name.to_ascii_uppercase(), params, value))
}

/// Parametro `NOME=valore`, senza le eventuali virgolette.
fn param<'a>(params: &'a str, name: &str) -> Option<&'a str> {
    params.split(';').find_map(|p| {
        let (k, v) = p.split_once('=')?;
        k.eq_ignore_ascii_case(name).then(|| v.trim_matches('"'))
    })
}

fn unescape(value: &str) -> String {
    value.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
}

fn parse_time(value: &str) -> (Option<i64>, bool) {
    if let Ok(day) = NaiveDate::parse_from_str(value, "%Y%m%d") {
        let start = day.and_hms_opt(0, 0, 0).and_then(|d| Local.from_local_datetime(&d).earliest());
        return (start.map(|d| d.timestamp()), true);
    }
    let (clock, utc) = match value.strip_suffix('Z') {
        Some(v) => (v, true),
        None => (value, false),
    };
    let Ok(when) = NaiveDateTime::parse_from_str(clock, "%Y%m%dT%H%M%S") else { return (None, false) };
    let unix = if utc { Some(Utc.from_utc_datetime(&when).timestamp()) } else { Local.from_local_datetime(&when).earliest().map(|d| d.timestamp()) };
    (unix, false)
}

/// Solo le proprietà del primo evento e il METHOD del calendario.
struct Raw {
    method: String,
    props: Vec<(String, String, String)>,
}

fn raw_event(text: &str) -> Option<Raw> {
    let mut method = String::new();
    let mut props = Vec::new();
    let mut inside = false;
    let mut found = false;
    for line in unfold(text) {
        let Some((name, params, value)) = property(&line) else { continue };
        match name.as_str() {
            "BEGIN" if value.trim().eq_ignore_ascii_case("VEVENT") && !found => {
                inside = true;
                found = true;
            }
            "END" if value.trim().eq_ignore_ascii_case("VEVENT") => inside = false,
            "METHOD" => method = value.trim().to_ascii_uppercase(),
            _ if inside => props.push((name, params.to_string(), value.trim().to_string())),
            _ => {}
        }
    }
    found.then_some(Raw { method, props })
}

impl Raw {
    fn value(&self, name: &str) -> Option<&str> {
        self.props.iter().find(|(n, _, _)| n == name).map(|(_, _, v)| v.as_str())
    }

    /// Indirizzo dell'organizzatore, senza il prefisso `mailto:`, e il suo nome.
    fn organizer(&self) -> Option<(String, Option<String>)> {
        let (_, params, value) = self.props.iter().find(|(n, _, _)| n == "ORGANIZER")?;
        let email = value.strip_prefix("mailto:").or_else(|| value.strip_prefix("MAILTO:")).unwrap_or(value).trim().to_string();
        email.contains('@').then(|| (email, param(params, "CN").map(str::to_string)))
    }
}

pub fn parse(text: &str) -> Option<Invite> {
    let raw = raw_event(text)?;
    let (start, all_day) = raw.value("DTSTART").map(parse_time).unwrap_or((None, false));
    let end = raw.value("DTEND").and_then(|v| parse_time(v).0);
    Some(Invite {
        summary: raw.value("SUMMARY").map(unescape).unwrap_or_else(|| "(senza titolo)".into()),
        start,
        end,
        all_day,
        location: raw.value("LOCATION").map(unescape).filter(|l| !l.trim().is_empty()),
        organizer: raw.organizer().map(|(email, name)| name.unwrap_or(email)),
        method: raw.method,
    })
}

/// Risposta da mandare all'organizzatore: destinatario, oggetto e testo iCalendar METHOD:REPLY.
pub fn reply(text: &str, me: &str, status: &str) -> Result<(String, String, String)> {
    let (partstat, word) = match status {
        "accepted" => ("ACCEPTED", "Accettato"),
        "tentative" => ("TENTATIVE", "Forse"),
        "declined" => ("DECLINED", "Rifiutato"),
        _ => return Err(msg("Risposta all'invito non valida")),
    };
    let raw = raw_event(text).ok_or_else(|| msg("Invito illeggibile"))?;
    let (organizer, _) = raw.organizer().ok_or_else(|| msg("L'invito non indica un organizzatore"))?;
    let uid = raw.value("UID").ok_or_else(|| msg("L'invito non ha un identificativo"))?;
    let summary = raw.value("SUMMARY").unwrap_or_default();
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ");

    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "PRODID:-//Missiva//IT".into(),
        "VERSION:2.0".into(),
        "METHOD:REPLY".into(),
        "BEGIN:VEVENT".into(),
        format!("UID:{uid}"),
        format!("DTSTAMP:{stamp}"),
        format!("ORGANIZER:mailto:{organizer}"),
        format!("ATTENDEE;PARTSTAT={partstat}:mailto:{me}"),
        format!("SUMMARY:{summary}"),
    ];
    // Data e sequenza identificano l'occorrenza: si rimandano come sono arrivate.
    for name in ["DTSTART", "DTEND", "SEQUENCE", "RECURRENCE-ID"] {
        if let Some((_, params, value)) = raw.props.iter().find(|(n, _, _)| n == name) {
            lines.push(if params.is_empty() { format!("{name}:{value}") } else { format!("{name};{params}:{value}") });
        }
    }
    lines.extend(["END:VEVENT".to_string(), "END:VCALENDAR".to_string()]);
    Ok((organizer, format!("{word}: {}", unescape(summary)), lines.join("\r\n") + "\r\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const INVITE: &str = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Rome\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:abc-1\r\nSEQUENCE:2\r\nDTSTART:20261105T090000Z\r\nDTEND:20261105T100000Z\r\nSUMMARY:Riunione\\, gateway\r\nLOCATION:Sala\r\n  Blu\r\nORGANIZER;CN=\"Giulia: Ferri\":mailto:giulia@azienda.it\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn legge_l_invito() {
        let i = parse(INVITE).unwrap();
        assert_eq!(i.summary, "Riunione, gateway");
        assert_eq!(i.location.as_deref(), Some("Sala Blu"));
        assert_eq!(i.organizer.as_deref(), Some("Giulia: Ferri"));
        assert_eq!(i.method, "REQUEST");
        assert_eq!(i.start, Some(Utc.with_ymd_and_hms(2026, 11, 5, 9, 0, 0).unwrap().timestamp()));
        assert_eq!(i.end.unwrap() - i.start.unwrap(), 3600);
        assert!(!i.all_day);
    }

    #[test]
    fn giornata_intera() {
        let i = parse("BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261105\nSUMMARY:Ferie\nEND:VEVENT\n").unwrap();
        assert!(i.all_day);
        assert!(i.start.is_some());
    }

    #[test]
    fn risposta_all_organizzatore() {
        let (to, subject, ics) = reply(INVITE, "io@esempio.it", "accepted").unwrap();
        assert_eq!(to, "giulia@azienda.it");
        assert_eq!(subject, "Accettato: Riunione, gateway");
        for needed in ["METHOD:REPLY", "UID:abc-1", "SEQUENCE:2", "ATTENDEE;PARTSTAT=ACCEPTED:mailto:io@esempio.it", "DTSTART:20261105T090000Z"] {
            assert!(ics.contains(needed), "{needed}");
        }
        assert!(reply(INVITE, "io@esempio.it", "boh").is_err());
    }

    #[test]
    fn senza_evento() {
        assert!(parse("BEGIN:VCALENDAR\nEND:VCALENDAR\n").is_none());
    }
}
