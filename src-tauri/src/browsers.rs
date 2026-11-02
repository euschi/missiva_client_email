//! Apertura dei link: browser predefinito del sistema e, se non funziona, elenco dei browser
//! installati (voci `.desktop` che gestiscono http/https) tra cui scegliere.

use std::collections::HashSet;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{msg, Result};

/// Oltre questa attesa xdg-open è considerato riuscito: alcuni restano vivi quanto il browser.
const OPEN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Browser {
    /// Nome del file `.desktop`.
    pub id: String,
    pub name: String,
}

struct Entry {
    name: String,
    exec: String,
}

/// Accetta solo http(s): l'indirizzo arriva dal mittente e finisce tra gli argomenti di un programma.
pub fn checked_url(raw: &str) -> Result<String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| msg("Indirizzo del link non valido"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(msg("Si possono aprire solo link http e https"));
    }
    Ok(url.into())
}

/// Comando senza le variabili dell'AppImage, che romperebbero i programmi di sistema.
fn command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    if std::env::var_os("APPIMAGE").is_some() {
        for var in ["LD_LIBRARY_PATH", "GIO_EXTRA_MODULES", "GTK_PATH", "GDK_PIXBUF_MODULE_FILE"] {
            cmd.env_remove(var);
        }
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    cmd
}

/// Il processo può durare a lungo: un thread lo raccoglie quando finisce, senza lasciare zombie.
fn reap(mut child: Child) {
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

/// Apre il link nel browser predefinito. Errore se il sistema non riesce ad aprirlo.
pub fn open_default(url: &str) -> Result<()> {
    let mut child = command("xdg-open").arg(url).spawn().map_err(|e| msg(format!("xdg-open non disponibile: {e}")))?;
    let start = Instant::now();
    while start.elapsed() < OPEN_TIMEOUT {
        match child.try_wait()? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => return Err(msg(format!("xdg-open ha restituito {status}"))),
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }
    reap(child);
    Ok(())
}

/// Apre il link con un browser scelto dall'utente tra quelli di `list`.
pub fn open_with(id: &str, url: &str) -> Result<()> {
    // L'id è il nome di un file: niente percorsi.
    if id.contains('/') {
        return Err(msg("Browser non trovato"));
    }
    let entry = application_dirs()
        .into_iter()
        .find_map(|dir| std::fs::read_to_string(dir.join(id)).ok())
        .and_then(|text| parse_entry(&text))
        .ok_or_else(|| msg("Browser non trovato"))?;
    let args = exec_args(&entry.exec, url);
    let (program, rest) = args.split_first().ok_or_else(|| msg("Voce del browser non valida"))?;
    let child = command(program).args(rest).spawn().map_err(|e| msg(format!("{} non si avvia: {e}", entry.name)))?;
    reap(child);
    Ok(())
}

/// Browser installati, in ordine alfabetico.
pub fn list() -> Vec<Browser> {
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for dir in application_dirs() {
        let Ok(files) = std::fs::read_dir(dir) else { continue };
        for file in files.flatten() {
            let id = file.file_name().to_string_lossy().into_owned();
            // A parità di nome vale la prima cartella, come da specifica XDG, anche se la voce è nascosta.
            if !id.ends_with(".desktop") || !seen.insert(id.clone()) {
                continue;
            }
            let entry = std::fs::read_to_string(file.path()).ok().and_then(|text| parse_entry(&text));
            if let Some(entry) = entry {
                found.push(Browser { id, name: entry.name });
            }
        }
    }
    found.sort_by_key(|b| b.name.to_lowercase());
    found
}

fn application_dirs() -> Vec<PathBuf> {
    let home = dirs::data_dir();
    let system = std::env::var("XDG_DATA_DIRS").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    home.into_iter().chain(system.split(':').map(PathBuf::from)).map(|d| d.join("applications")).collect()
}

/// Legge una voce `.desktop`: `None` se è nascosta o non gestisce i link web.
fn parse_entry(text: &str) -> Option<Entry> {
    let (mut name, mut exec, mut web) = (None, None, false);
    let mut in_main = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_main = line == "[Desktop Entry]";
            continue;
        }
        let Some((key, value)) = line.split_once('=').filter(|_| in_main) else { continue };
        match key.trim() {
            "Name" => name = Some(value.trim().to_string()),
            "Exec" => exec = Some(value.trim().to_string()),
            "MimeType" => web = value.split(';').any(|m| m == "x-scheme-handler/https" || m == "x-scheme-handler/http"),
            "Hidden" | "NoDisplay" if value.trim() == "true" => return None,
            _ => {}
        }
    }
    if !web {
        return None;
    }
    Some(Entry { name: name?, exec: exec? })
}

/// Argomenti della riga `Exec` di una voce `.desktop`, con il link al posto dei segnaposto.
fn exec_args(exec: &str, url: &str) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    let (mut word, mut quoted, mut started) = (String::new(), false, false);
    let mut chars = exec.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            '\\' if quoted => word.extend(chars.next()),
            c if c.is_whitespace() && !quoted => {
                if started {
                    words.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            c => {
                word.push(c);
                started = true;
            }
        }
    }
    if started {
        words.push(word);
    }

    let mut has_url = false;
    let mut args = Vec::with_capacity(words.len() + 1);
    for w in words {
        if matches!(w.as_str(), "%u" | "%U" | "%f" | "%F") {
            has_url = true;
            args.push(url.to_string());
            continue;
        }
        // Gli altri segnaposto (%i, %c, %k…) non servono: si tolgono; %% è un % letterale.
        let clean = expand_percent(&w);
        if !clean.is_empty() {
            args.push(clean);
        }
    }
    if !has_url {
        args.push(url.to_string());
    }
    args
}

fn expand_percent(word: &str) -> String {
    let mut out = String::with_capacity(word.len());
    let mut chars = word.chars();
    while let Some(c) = chars.next() {
        if c != '%' {
            out.push(c);
        } else if chars.next() == Some('%') {
            out.push('%');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_solo_http() {
        assert_eq!(checked_url(" https://esempio.it/a?b=1 ").unwrap(), "https://esempio.it/a?b=1");
        assert!(checked_url("HTTP://esempio.it").is_ok());
        for bad in ["file:///etc/passwd", "javascript:alert(1)", "--version", "smb://x/y", ""] {
            assert!(checked_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn voce_browser() {
        let e = parse_entry(
            "[Desktop Entry]\nName=Firefox\nExec=firefox %u\nMimeType=text/html;x-scheme-handler/https;\n\n[Desktop Action new]\nName=Nuova finestra\nExec=firefox --new-window\n",
        )
        .unwrap();
        assert_eq!(e.name, "Firefox");
        assert_eq!(e.exec, "firefox %u");
    }

    #[test]
    fn voci_scartate() {
        assert!(parse_entry("[Desktop Entry]\nName=Editor\nExec=ed %f\nMimeType=text/plain;\n").is_none());
        assert!(parse_entry("[Desktop Entry]\nName=X\nExec=x\nNoDisplay=true\nMimeType=x-scheme-handler/http;\n").is_none());
    }

    #[test]
    fn riga_exec() {
        let u = "https://e.it/?a=1&b=2";
        assert_eq!(exec_args("/usr/bin/google-chrome-stable %U", u), ["/usr/bin/google-chrome-stable", u]);
        assert_eq!(exec_args("firefox --name=\"Il mio browser\" %u", u), ["firefox", "--name=Il mio browser", u]);
        assert_eq!(exec_args("\"/opt/My Browser/run\" --icon %i %k", u), ["/opt/My Browser/run", "--icon", u]);
        assert_eq!(exec_args("env A=100%% br", u), ["env", "A=100%", "br", u]);
    }
}
