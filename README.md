# Missiva

Client email per Linux con posta in arrivo unificata: più account Google, Microsoft e IMAP/SMTP in un'unica finestra. Interfaccia "Inchiostro & Carta" ricavata dal design su Claude Design.

Stack: [Tauri 2](https://tauri.app) (backend Rust) + React 19 + TypeScript + Vite.

## Avvio

```sh
npm install
npm run tauri dev      # app desktop
npm run dev            # solo interfaccia nel browser, con i dati demo del design
npm run tauri build    # pacchetti .deb, .rpm e AppImage
```

Dipendenze di sistema (Arch): `webkit2gtk-4.1`, `libsoup3`, `openssl` e un servizio Secret Service attivo (GNOME Keyring o KWallet).

## Account

- **IMAP / SMTP**: email e password (o password per app). I server vengono cercati in automatico nel database ISPDB di Thunderbird e restano modificabili.
- **Google e Microsoft**: accesso OAuth 2.0 nel browser (PKCE, redirect su porta locale). Servono client ID registrati da te:
  - Google Cloud Console → credenziali OAuth di tipo *App desktop*, con l'API Gmail abilitata (scope `https://mail.google.com/`).
  - Microsoft Entra → registrazione app *client pubblico*, redirect `http://localhost`, permessi delegati `IMAP.AccessAsUser.All` e `SMTP.Send`.

  Imposta le variabili `MISSIVA_GOOGLE_CLIENT_ID`, `MISSIVA_GOOGLE_CLIENT_SECRET` e `MISSIVA_MICROSOFT_CLIENT_ID`, oppure crea `~/.config/missiva/oauth.json`:

  ```json
  {
    "google": { "clientId": "…apps.googleusercontent.com", "clientSecret": "…" },
    "microsoft": { "clientId": "…" }
  }
  ```

## Dove finiscono i dati

| Cosa | Dove |
|---|---|
| Configurazione account (senza segreti) | `~/.config/missiva/accounts.json` |
| Password e token | portachiavi di sistema, servizio `missiva` |
| Cache dei messaggi | `~/.cache/missiva/<account>-<cartella>.json` |
| Allegati aperti | cartella Scaricati |
| Preferenze di aspetto | localStorage della webview |

## Limiti attuali

- I messaggi si leggono come testo: l'HTML viene convertito in testo semplice e l'invio è sempre in testo semplice.
- Ogni sincronizzazione scarica al massimo gli ultimi 60 messaggi per cartella nel periodo scelto. Non c'è IMAP IDLE: la posta si aggiorna ogni 5 minuti, con F5 o con il pulsante di sincronizzazione.
- Le bozze si leggono ma non si salvano. Gli allegati non vengono inoltrati.

## Scorciatoie

`C` scrivi · `Ctrl K` cerca · `F5` sincronizza · `Ctrl ↵` invia · `Esc` chiude le finestre
