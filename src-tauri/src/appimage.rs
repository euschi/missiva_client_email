//! Integrazione con il desktop quando Missiva gira da AppImage: nessun pacchetto installa la voce
//! del menu applicazioni, quindi la crea l'app al primo avvio, solo nel profilo dell'utente.

use crate::error::{msg, Result};
use std::path::Path;

const DESKTOP_TEMPLATE: &str = include_str!("../../packaging/arch/missiva.desktop");
const ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");

/// Crea o riallinea voce di menu e icona. Fuori da un'AppImage non fa nulla.
pub fn integrate() -> Result<()> {
    let Some(appimage) = std::env::var_os("APPIMAGE") else {
        return Ok(());
    };
    let data = dirs::data_dir().ok_or_else(|| msg("Cartella dei dati utente non trovata"))?;
    let entry = desktop_entry(DESKTOP_TEMPLATE, Path::new(&appimage));
    write_if_changed(&data.join("applications/missiva.desktop"), entry.as_bytes())?;
    write_if_changed(&data.join("icons/hicolor/256x256/apps/missiva.png"), ICON)
}

/// Il file viene riscritto solo se cambia, per esempio perché l'AppImage è stata spostata.
fn write_if_changed(path: &Path, content: &[u8]) -> Result<()> {
    if std::fs::read(path).is_ok_and(|current| current == content) {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

/// Voce di menu che punta a questa AppImage. `TryExec` la nasconde se il file viene cancellato.
fn desktop_entry(template: &str, appimage: &Path) -> String {
    let path = appimage.to_string_lossy();
    let exec = format!("Exec=\"{}\" %u\nTryExec={path}", escape_exec(&path));
    template.replace("Exec=missiva %u", &exec)
}

/// Regole di quoting della riga `Exec` nella specifica Desktop Entry.
fn escape_exec(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            '%' => out.push_str("%%"),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_voce_punta_all_appimage_anche_con_spazi_nel_percorso() {
        let entry = desktop_entry(DESKTOP_TEMPLATE, Path::new("/home/io/Le mie app/Missiva.AppImage"));
        assert!(entry.contains("Exec=\"/home/io/Le mie app/Missiva.AppImage\" %u\n"));
        assert!(entry.contains("TryExec=/home/io/Le mie app/Missiva.AppImage\n"));
        assert!(!entry.contains("Exec=missiva"));
    }

    #[test]
    fn i_caratteri_speciali_del_percorso_vengono_protetti() {
        assert_eq!(escape_exec("/a$b/c\"d/100%"), "/a\\$b/c\\\"d/100%%");
    }
}
