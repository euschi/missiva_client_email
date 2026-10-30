//! Password e token nel portachiavi di sistema (Secret Service: GNOME Keyring o KWallet).

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

pub fn store(account_id: &str, secret: &Secret) -> Result<()> {
    entry(account_id)?.set_password(&serde_json::to_string(secret)?)?;
    Ok(())
}

pub fn load(account_id: &str) -> Result<Secret> {
    Ok(serde_json::from_str(&entry(account_id)?.get_password()?)?)
}

pub fn delete(account_id: &str) -> Result<()> {
    match entry(account_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
