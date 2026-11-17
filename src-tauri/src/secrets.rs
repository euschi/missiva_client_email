//! Password e token nel portachiavi di sistema (Secret Service: GNOME Keyring o KWallet).

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::Result;

const SERVICE: &str = "missiva";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Secret {
    Password {
        password: String,
    },
    #[serde(rename_all = "camelCase")]
    Oauth {
        refresh_token: String,
        access_token: String,
        /// Scadenza dell'access token, in secondi Unix.
        expires_at: i64,
    },
}

fn entry(account_id: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, account_id)?)
}

/// Tentativi verso il portachiavi: la libreria rinuncia dopo 2 secondi senza risposta da D-Bus,
/// e GNOME Keyring a volte è più lento (ad esempio subito dopo lo sblocco).
const ATTEMPTS: usize = 3;

fn retry<T>(mut op: impl FnMut() -> keyring::Result<T>) -> keyring::Result<T> {
    let mut attempt = 1;
    loop {
        match op() {
            Err(keyring::Error::PlatformFailure(_)) if attempt < ATTEMPTS => {
                std::thread::sleep(Duration::from_millis(500));
                attempt += 1;
            }
            other => return other,
        }
    }
}

pub fn store(account_id: &str, secret: &Secret) -> Result<()> {
    store_raw(account_id, &serde_json::to_string(secret)?)
}

/// Salva un testo qualsiasi sotto `key` (es. i segreti dei collegamenti MCP).
pub fn store_raw(key: &str, value: &str) -> Result<()> {
    let entry = entry(key)?;
    let value = value.to_string();
    // Dopo un timeout la scrittura può essere andata a buon fine: se il valore c'è già, basta così.
    retry(|| match entry.set_password(&value) {
        Err(keyring::Error::PlatformFailure(e)) => match entry.get_password() {
            Ok(saved) if saved == value => Ok(()),
            _ => Err(keyring::Error::PlatformFailure(e)),
        },
        other => other,
    })?;
    Ok(())
}

pub fn load(account_id: &str) -> Result<Secret> {
    Ok(serde_json::from_str(&load_raw(account_id)?)?)
}

pub fn load_raw(key: &str) -> Result<String> {
    let entry = entry(key)?;
    Ok(retry(|| entry.get_password())?)
}

pub fn delete(account_id: &str) -> Result<()> {
    match entry(account_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
