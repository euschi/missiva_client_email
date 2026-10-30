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

## Build per Arch Linux

```sh
cp .env.example .env          # una volta: inserisci i client ID OAuth dell'app
scripts/build-arch.sh         # crea dist-arch/missiva-<versione>-1-x86_64.pkg.tar.zst
scripts/build-arch.sh --install   # come sopra, poi lo installa con pacman
```

Lo script usa `makepkg` con `packaging/arch/PKGBUILD`: installa le dipendenze mancanti, compila in release e crea un pacchetto con binario `/usr/bin/missiva`, voce nel menu applicazioni e icone. Si disinstalla con `sudo pacman -R missiva`.

I client ID presenti in `.env` al momento della build finiscono nel binario: chi installa il pacchetto accede con il proprio account Google o Microsoft senza configurare nulla. Variabili d'ambiente e `~/.config/missiva/oauth.json` restano un override a runtime.

## Account

- **IMAP / SMTP**: email e password (o password per app). I server vengono cercati in automatico nel database ISPDB di Thunderbird e restano modificabili.
- **Google e Microsoft**: accesso OAuth 2.0 nel browser (PKCE, redirect su porta locale). Servono client ID dell'app, registrati una volta sola da chi la distribuisce e validi per qualsiasi utente:
  - Google Cloud Console → credenziali OAuth di tipo *App desktop*, con l'API Gmail abilitata (scope `https://mail.google.com/`).
  - Microsoft Entra → registrazione app *client pubblico*, redirect `http://localhost`, permessi delegati `IMAP.AccessAsUser.All` e `SMTP.Send`.

  Imposta le variabili `MISSIVA_GOOGLE_CLIENT_ID`, `MISSIVA_GOOGLE_CLIENT_SECRET` e `MISSIVA_MICROSOFT_CLIENT_ID`, oppure crea `~/.config/missiva/oauth.json`:

  ```json
  {
    "google": { "clientId": "…apps.googleusercontent.com", "clientSecret": "…" },
    "microsoft": { "clientId": "…" }
  }
  ```

Barra laterale ad albero: ogni account è una radice richiudibile con dentro le cartelle vere del server (Posta in arrivo, Bozze, Inviati, Archivio, Cestino e tutte quelle create dall'utente, con le sottocartelle), importate da sole. In cima la radice «Tutti gli account» raccoglie le viste unificate (posta in arrivo di tutti gli account, Contrassegnati, Posticipati, Programmati…). I rami chiusi restano chiusi al riavvio.

Account nella barra laterale: con il pulsante ⋯ o il tasto destro si rinomina un account o lo si risincronizza (riscarica le cartelle aperte solo per quell'account). L'ordine si cambia trascinando gli account o dallo stesso menu, e viene salvato in `accounts.json`.

## Dove finiscono i dati

| Cosa | Dove |
|---|---|
| Configurazione account (senza segreti) | `~/.config/missiva/accounts.json` |
| Password e token | portachiavi di sistema, servizio `missiva` |
| Cache dei messaggi | `~/.cache/missiva/<account>-<cartella>.json` |
| Elenco delle cartelle del server | `~/.cache/missiva/<account>-folders.json` |
| Messaggi completi (HTML e allegati) | `~/.cache/missiva/raw/<account>/<cartella>/<uid>.eml` |
| Messaggi programmati | `~/.config/missiva/outbox.json` |
| Posticipi ed etichette | `~/.config/missiva/snoozed.json`, `labels.json` |
| Allegati aperti | cartella Scaricati |
| Preferenze di aspetto | localStorage della webview |

## Limiti attuali

- I messaggi HTML si vedono come li ha impaginati il mittente, in un riquadro isolato senza script; le immagini remote restano bloccate finché non premi «Mostra» (o attivi «Carica le immagini remote» in Privacy). Cliccando un allegato si apre l'anteprima di immagini, PDF e testo; gli altri formati si aprono con l'app predefinita. In scrittura **grassetto**, _corsivo_, link ed elenchi si scrivono in stile Markdown e partono come HTML insieme alla versione in testo semplice.
- "Invia più tardi" spedisce dal computer: Missiva deve essere aperta, anche solo nell'area di notifica, all'ora scelta. Se è chiusa, il messaggio parte alla riapertura. Dopo 3 tentativi falliti resta in Programmati con l'errore.
- Posticipi ed etichette sono locali: non si sincronizzano con il server né con altri computer.
- Ogni sincronizzazione scarica al massimo gli ultimi 60 messaggi per cartella nel periodo scelto. Non c'è IMAP IDLE: la posta in arrivo e la cartella aperta si aggiornano ogni minuto, quando torni sulla finestra, con F5 o con il pulsante di sincronizzazione; Inviati ogni 5 minuti (serve alle conversazioni).
- Le bozze si leggono ma non si salvano. Gli allegati non vengono inoltrati.

## Scorciatoie

`C` scrivi · `Ctrl K` cerca · `F5` sincronizza · `J`/`K` o `↓`/`↑` messaggio successivo/precedente · `Ctrl`+clic, `Maiusc`+clic, `Maiusc ↓/↑` e `Ctrl A` selezione multipla (poi `Canc`, `E`, `S`, `U` valgono per tutti) · `R`/`A`/`F` rispondi, a tutti, inoltra · `E` archivia · `B` posticipa · `L` etichetta · `F2` rinomina l'account · `Alt ↑`/`Alt ↓` sposta l'account · `Ctrl ↵` invia · `Esc` chiude le finestre (elenco completo in Impostazioni → Scorciatoie)
