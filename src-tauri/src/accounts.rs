//! Configurazione degli account (senza segreti) in ~/.config/missiva/accounts.json.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{msg, Result};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Google,
    Microsoft,
    Imap,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Security {
    Tls,
    Starttls,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub host: String,
    pub port: u16,
    pub security: Security,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// Etichetta mostrata nella barra laterale ("Lavoro", "Personale"…).
    pub name: String,
    pub email: String,
    /// Nome del mittente nei messaggi inviati.
    pub display_name: String,
    pub provider: Provider,
    pub color: String,
    pub imap: Server,
    pub smtp: Server,
    pub username: String,
    pub sync_days: u32,
    #[serde(default)]
    pub signature: String,
}

/// Colori assegnati in ordine ai nuovi account, come nel design.
const PALETTE: [&str; 6] = ["#F2A65A", "#7AB0FF", "#C7B5FF", "#7EE0B5", "#FF8F7A", "#8FD3FF"];

fn config_dir() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| msg("Cartella di configurazione non trovata"))?
        .join("missiva");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn config_file(name: &str) -> Result<PathBuf> {
    Ok(config_dir()?.join(name))
}

pub fn load() -> Result<Vec<Account>> {
    let path = config_file("accounts.json")?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

pub fn save(accounts: &[Account]) -> Result<()> {
    let path = config_file("accounts.json")?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(accounts)?)?;
    fs::rename(tmp, path)?;
    Ok(())
}

pub fn get(id: &str) -> Result<Account> {
    load()?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| msg("Account non trovato"))
}

pub fn next_color(existing: &[Account]) -> String {
    PALETTE[existing.len() % PALETTE.len()].to_string()
}

pub fn default_name(provider: Provider, email: &str) -> String {
    match provider {
        Provider::Google => "Google".into(),
        Provider::Microsoft => "Microsoft".into(),
        Provider::Imap => email.rsplit('@').next().unwrap_or(email).to_string(),
    }
}
