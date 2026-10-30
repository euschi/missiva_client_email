// Niente console aggiuntiva su Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    missiva_lib::run()
}
