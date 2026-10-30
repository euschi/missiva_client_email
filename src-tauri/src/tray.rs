//! Icona nell'area di notifica: menu con Apri, Sincronizza ed Esci, più il conteggio dei non letti.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, Manager};

const TRAY_ID: &str = "main";

/// Vero se l'icona è stata creata (su alcuni desktop manca il supporto AppIndicator).
pub struct TrayState(pub AtomicBool);

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Apri Missiva", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Sincronizza ora", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &sync, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Missiva")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "sync" => {
                show_main(app);
                let _ = app.emit("tray-sync", ());
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.state::<TrayState>().0.store(true, Ordering::Relaxed);
    Ok(())
}

pub fn available(app: &AppHandle) -> bool {
    app.state::<TrayState>().0.load(Ordering::Relaxed)
}

pub fn set_unread(app: &AppHandle, count: usize) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let tip = match count {
        0 => "Missiva".to_string(),
        1 => "Missiva · 1 non letto".to_string(),
        n => format!("Missiva · {n} non letti"),
    };
    let _ = tray.set_tooltip(Some(tip));
    // Su Linux il titolo compare accanto all'icona nel pannello.
    let _ = tray.set_title(if count > 0 { Some(count.to_string()) } else { None::<String> });
}
