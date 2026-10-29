use serde::{Serialize, Serializer};

/// Errore unico dell'app: arriva al frontend come stringa leggibile.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Msg(String),
    #[error("IMAP: {0}")]
    Imap(#[from] imap::Error),
    #[error("SMTP: {0}")]
    Smtp(#[from] lettre::transport::smtp::Error),
    #[error("Messaggio non valido: {0}")]
    Email(#[from] lettre::error::Error),
    #[error("Indirizzo non valido: {0}")]
    Address(#[from] lettre::address::AddressError),
    #[error("TLS: {0}")]
    Tls(#[from] native_tls::Error),
    #[error("Portachiavi di sistema: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Rete: {0}")]
    Http(#[from] reqwest::Error),
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("URL: {0}")]
    Url(#[from] url::ParseError),
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub fn msg(s: impl Into<String>) -> Error {
    Error::Msg(s.into())
}
