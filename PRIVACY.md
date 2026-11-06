# Informativa sulla privacy di Missiva

*Ultimo aggiornamento: 6 novembre 2026*

Missiva è un client email desktop per Linux, open source. Funziona interamente sul tuo computer: non ha server propri, non crea account e non raccoglie dati.

## Quali dati usa

- **Email, cartelle ed etichette** dei tuoi account: Missiva le scarica dal server della tua casella (Gmail, Microsoft 365 o un server IMAP) per mostrarle, e invia i messaggi che scrivi tramite il server SMTP del tuo provider.
- **Indirizzo email e nome** del profilo, ricevuti dal provider al momento dell'accesso, per identificare l'account nell'app.
- **Credenziali**: password IMAP e token OAuth (access token e refresh token).

## Dove restano

- Credenziali e token sono salvati nel **portachiavi di sistema** (GNOME Keyring o KWallet).
- Impostazioni degli account in `~/.config/missiva/`, cache dei messaggi e degli allegati in `~/.cache/missiva/`.
- Nulla viene inviato a server di Missiva o di terzi: lo sviluppatore non riceve né vede i tuoi dati.

## Con chi si collega

Missiva comunica solo con:

- i server del tuo provider di posta (IMAP e SMTP);
- i servizi di accesso di Google (`accounts.google.com`, `oauth2.googleapis.com`) e Microsoft (`login.microsoftonline.com`), solo per l'accesso OAuth e il rinnovo dei token;
- `autoconfig.thunderbird.net` e il dominio della tua email, per suggerire le impostazioni di un account IMAP (viene inviato solo il dominio, non l'indirizzo completo né la password);
- i siti indicati in un messaggio, solo quando lo chiedi tu: aprendo un link, mostrando le immagini remote (bloccate di default) o usando la disiscrizione da una newsletter.

## Dati Google

L'uso delle informazioni ricevute dalle API di Google rispetta le [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), compresi i requisiti di Limited Use. L'accesso a Gmail (`https://mail.google.com/`) serve solo a leggere, organizzare e inviare la posta dall'app; i dati non vengono trasferiti a terzi, né usati per pubblicità o per addestrare modelli.

## Revocare l'accesso e cancellare i dati

- Rimuovendo un account da Missiva si cancellano le sue credenziali dal portachiavi e la sua cache.
- Puoi revocare l'accesso in qualsiasi momento da [myaccount.google.com/permissions](https://myaccount.google.com/permissions) (Google) o da [myapps.microsoft.com](https://myapps.microsoft.com) (Microsoft).
- Disinstallando l'app e cancellando `~/.config/missiva/` e `~/.cache/missiva/` non resta nulla sul computer.

## Contatti

Per domande apri una issue su [github.com/euschi/missiva_client_email](https://github.com/euschi/missiva_client_email/issues).

---

## English summary

Missiva is an open-source desktop email client for Linux that runs entirely on your computer. It has no backend and collects no data. Your mail is downloaded from and sent through your own provider's servers (Gmail, Microsoft 365 or IMAP/SMTP). Passwords and OAuth tokens are stored in the system keyring, and messages are cached locally in `~/.cache/missiva/`. Nothing is sent to the developer or to third parties. Missiva's use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Removing an account deletes its credentials and cache. You can revoke access at any time from your Google or Microsoft account settings.
