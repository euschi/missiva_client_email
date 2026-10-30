//! Messaggi programmati ("Invia più tardi") in ~/.config/missiva/outbox.json.

use std::fs;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::accounts::config_file;
use crate::error::Result;
use crate::smtp::Outgoing;

/// Tentativi di invio prima di fermarsi e mostrare l'errore.
pub const MAX_ATTEMPTS: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scheduled {
    pub id: String,
    /// Secondi Unix.
    pub at: i64,
    pub outgoing: Outgoing,
    #[serde(default)]
    pub attempts: u32,
    /// Ultimo errore, valorizzato quando i tentativi sono esauriti.
    #[serde(default)]
    pub error: Option<String>,
}

// Comandi e ciclo di invio leggono e riscrivono lo stesso file.
static FILE: Mutex<()> = Mutex::new(());

fn load_unlocked() -> Result<Vec<Scheduled>> {
    let path = config_file("outbox.json")?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

pub fn load() -> Result<Vec<Scheduled>> {
    let _g = FILE.lock().unwrap_or_else(|e| e.into_inner());
    load_unlocked()
}

/// Legge, modifica e salva la coda in un'unica operazione.
pub fn update<T>(f: impl FnOnce(&mut Vec<Scheduled>) -> T) -> Result<T> {
    let _g = FILE.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load_unlocked()?;
    let out = f(&mut all);
    let path = config_file("outbox.json")?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(&all)?)?;
    fs::rename(tmp, path)?;
    Ok(out)
}
