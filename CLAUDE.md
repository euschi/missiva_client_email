# Missiva: regole di progetto

## Versione

Ogni rilascio (merge su `main`, build del pacchetto da installare) **deve avere una versione nuova**: mai ricompilare e reinstallare con il numero di quella già installata.

- Incremento: patch per i soli fix, minor per le nuove funzioni, major solo su richiesta esplicita.
- Formato semver senza zeri iniziali (`0.2.0`, non `0.02.00`): Tauri e Cargo non accettano altro.
- L'aggiornamento va fatto prima del merge su `main`, così la build parte da un commit già con il numero giusto.
- Il numero va cambiato insieme in tutti questi file:
  - `src-tauri/tauri.conf.json` (da qui lo legge il `pkgver()` del PKGBUILD)
  - `src-tauri/Cargo.toml` e `src-tauri/Cargo.lock`
  - `package.json` e `package-lock.json`
  - `packaging/arch/PKGBUILD`
