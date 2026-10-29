//! Accesso OAuth 2.0 (PKCE + redirect su loopback) per Google e Microsoft.
//!
//! I client ID vanno registrati dall'utente e letti da variabili d'ambiente
//! (`MISSIVA_GOOGLE_CLIENT_ID`, `MISSIVA_GOOGLE_CLIENT_SECRET`, `MISSIVA_MICROSOFT_CLIENT_ID`)
//! oppure da ~/.config/missiva/oauth.json.

use std::collections::HashMap;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::accounts::{self, Account, Provider};
use crate::error::{msg, Result};
use crate::secrets::{self, Secret};

struct OAuthApp {
    auth_url: &'static str,
    token_url: &'static str,
    scopes: &'static str,
    redirect_host: &'static str,
    client_id: String,
    client_secret: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientIds {
    google: Option<ClientId>,
    microsoft: Option<ClientId>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientId {
    client_id: String,
    client_secret: Option<String>,
}

fn client_id(provider: Provider) -> Result<ClientId> {
    let (id_var, secret_var) = match provider {
        Provider::Google => ("MISSIVA_GOOGLE_CLIENT_ID", "MISSIVA_GOOGLE_CLIENT_SECRET"),
        Provider::Microsoft => ("MISSIVA_MICROSOFT_CLIENT_ID", "MISSIVA_MICROSOFT_CLIENT_SECRET"),
        Provider::Imap => return Err(msg("Gli account IMAP non usano OAuth")),
    };
    if let Ok(client_id) = std::env::var(id_var) {
        return Ok(ClientId { client_id, client_secret: std::env::var(secret_var).ok() });
    }
    let path = accounts::config_file("oauth.json")?;
    let ids: ClientIds = if path.exists() {
        serde_json::from_str(&std::fs::read_to_string(&path)?)?
    } else {
        ClientIds::default()
    };
    let found = match provider {
        Provider::Google => ids.google,
        _ => ids.microsoft,
    };
    found.ok_or_else(|| {
        msg(format!(
            "Manca il client ID OAuth: imposta {id_var} oppure compila {}",
            path.display()
        ))
    })
}

fn app(provider: Provider) -> Result<OAuthApp> {
    let id = client_id(provider)?;
    Ok(match provider {
        Provider::Google => OAuthApp {
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
            token_url: "https://oauth2.googleapis.com/token",
            scopes: "https://mail.google.com/ openid email profile",
            redirect_host: "127.0.0.1",
            client_id: id.client_id,
            client_secret: id.client_secret,
        },
        _ => OAuthApp {
            auth_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            scopes: "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access openid email profile",
            redirect_host: "localhost",
            client_id: id.client_id,
            client_secret: id.client_secret,
        },
    })
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: i64,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

pub struct Authorized {
    pub email: String,
    pub name: Option<String>,
    pub secret: Secret,
}

fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// Apre il browser, attende il redirect sulla porta locale e scambia il codice con i token.
pub async fn authorize(handle: &AppHandle, provider: Provider) -> Result<Authorized> {
    let app = app(provider)?;
    let verifier = random_token(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_token(16);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let redirect_uri = format!("http://{}:{}", app.redirect_host, listener.local_addr()?.port());

    let mut url = url::Url::parse(app.auth_url)?;
    url.query_pairs_mut()
        .append_pair("client_id", &app.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", app.scopes)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    if provider == Provider::Google {
        url.query_pairs_mut()
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
    }
    handle
        .opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| msg(format!("Impossibile aprire il browser: {e}")))?;

    let params = tokio::time::timeout(Duration::from_secs(300), wait_redirect(listener))
        .await
        .map_err(|_| msg("Tempo scaduto: accesso nel browser non completato"))??;
    if let Some(err) = params.get("error") {
        return Err(msg(format!("Accesso negato: {err}")));
    }
    if params.get("state") != Some(&state) {
        return Err(msg("Risposta OAuth non valida (state diverso)"));
    }
    let code = params.get("code").ok_or_else(|| msg("Codice di autorizzazione mancante"))?;

    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("client_id", app.client_id.as_str()),
        ("code_verifier", verifier.as_str()),
    ];
    if let Some(secret) = &app.client_secret {
        form.push(("client_secret", secret.as_str()));
    }
    let token = post_token(app.token_url, &form).await?;
    let refresh_token = token
        .refresh_token
        .ok_or_else(|| msg("Il provider non ha restituito un refresh token"))?;

    let claims = token.id_token.as_deref().map(decode_claims).unwrap_or_default();
    let email = claims
        .get("email")
        .or_else(|| claims.get("preferred_username"))
        .cloned()
        .ok_or_else(|| msg("Indirizzo email non presente nella risposta del provider"))?;

    Ok(Authorized {
        email,
        name: claims.get("name").cloned(),
        secret: Secret::Oauth {
            refresh_token,
            access_token: token.access_token,
            expires_at: chrono::Utc::now().timestamp() + token.expires_in,
        },
    })
}

async fn wait_redirect(listener: tokio::net::TcpListener) -> Result<HashMap<String, String>> {
    loop {
        let (mut sock, _) = listener.accept().await?;
        let mut buf = vec![0u8; 8192];
        let n = sock.read(&mut buf).await?;
        let req = String::from_utf8_lossy(&buf[..n]);
        let path = req.split_whitespace().nth(1).unwrap_or("/");
        let url = url::Url::parse(&format!("http://localhost{path}"))?;
        let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
        if params.contains_key("code") || params.contains_key("error") {
            let page = "<!doctype html><meta charset=utf-8><title>Missiva</title>\
                <body style=\"font-family:sans-serif;background:#0C0D10;color:#ECEDEF;display:grid;place-items:center;height:100vh;margin:0\">\
                <p>Accesso completato. Puoi chiudere questa scheda e tornare a Missiva.</p>";
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                page.len()
            );
            sock.write_all(resp.as_bytes()).await?;
            return Ok(params);
        }
        sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
    }
}

async fn post_token(url: &str, form: &[(&str, &str)]) -> Result<TokenResponse> {
    let resp = reqwest::Client::new().post(url).form(form).send().await?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(msg(format!("Errore dal server OAuth: {body}")));
    }
    Ok(resp.json().await?)
}

/// Legge i claim dell'id_token, ricevuto direttamente dal token endpoint via TLS.
fn decode_claims(jwt: &str) -> HashMap<String, String> {
    jwt.split('.')
        .nth(1)
        .and_then(|p| URL_SAFE_NO_PAD.decode(p).ok())
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v.as_object().cloned())
        .map(|o| {
            o.into_iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

/// Access token valido per l'account, rinnovato se scade entro un minuto.
pub async fn access_token(account: &Account) -> Result<String> {
    let Secret::Oauth { refresh_token, access_token, expires_at } = secrets::load(&account.id)? else {
        return Err(msg("L'account non usa OAuth"));
    };
    if expires_at - 60 > chrono::Utc::now().timestamp() {
        return Ok(access_token);
    }
    let app = app(account.provider)?;
    let mut form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token.as_str()),
        ("client_id", app.client_id.as_str()),
    ];
    if let Some(secret) = &app.client_secret {
        form.push(("client_secret", secret.as_str()));
    }
    let token = post_token(app.token_url, &form).await?;
    secrets::store(
        &account.id,
        &Secret::Oauth {
            refresh_token: token.refresh_token.unwrap_or(refresh_token),
            access_token: token.access_token.clone(),
            expires_at: chrono::Utc::now().timestamp() + token.expires_in,
        },
    )?;
    Ok(token.access_token)
}
