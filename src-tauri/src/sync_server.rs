//! Embedded HTTP broker served on localhost:9472.
//!
//! Browser extensions (Firefox/Chrome) talk to the desktop through this broker.
//! Endpoints:
//!   GET  /health              → {"ok": true, "version": "1.7.2"}
//!   GET  /state               → latest extension payload + desktop usage
//!   POST /state               → extension pushes its full state blob
//!   GET  /desktop-app-usage   → desktop-only usage data (extensions don't have this)
//!
//! The broker is intentionally minimal: it forwards state changes into the
//! shared `AppState` and emits Tauri events so the frontend can react. No
//! database, no persistence beyond what the frontend already does.

use std::sync::Arc;
use tauri::async_runtime;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Response, Server};

use crate::state::AppState;

const SYNC_PORT: u16 = 9472;
const APP_VERSION: &str = "1.7.2";

/// Start the sync broker in a detached thread. Owned by the Tauri runtime.
pub fn spawn(app_handle: AppHandle) {
    let server = match Server::http(format!("127.0.0.1:{}", SYNC_PORT)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "[focusguard] sync broker failed to bind :{} — {}",
                SYNC_PORT, e
            );
            return;
        }
    };

    // Move the server into an Arc so the handler task can own one handle while
    // the accept loop owns another.
    let server = Arc::new(server);
    let pool = async_runtime::TokioHandle::try_current().map(|_| ());

    let app = app_handle.clone();
    let server_for_handler = server.clone();

    // Spawn the accept loop on a dedicated thread (tiny_http is sync).
    std::thread::spawn(move || {
        loop {
            let request = match server_for_handler.recv() {
                Ok(r) => r,
                Err(_) => break,
            };

            let app = app.clone();
            // tiny_http requests are not Send, so we handle them inline.
            if let Err(e) = handle_request(request, &app) {
                eprintln!("[focusguard] sync broker error: {}", e);
            }
        }
        let _ = pool; // suppress unused warning
    });
}

fn handle_request(
    mut request: tiny_http::Request,
    app: &AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let url = request.url().to_string();
    let method = request.method().clone();

    match (&method, url.as_str()) {
        (Method::Get, "/health") => {
            respond_json(
                request,
                &serde_json::json!({
                    "ok": true,
                    "version": APP_VERSION,
                    "desktop": true,
                }),
            )?;
        }

        (Method::Get, "/state") => {
            let state = app.state::<AppState>();
            let guard = state.sync.lock().map_err(|e| e.to_string())?;
            respond_json(
                request,
                &serde_json::json!({
                    "extension": guard.extension_payload,
                    "extensionUpdatedAt": guard.extension_updated_at,
                    "extensionConnected": guard.extension_connected,
                }),
            )?;
        }

        (Method::Get, "/desktop-app-usage") => {
            let state = app.state::<AppState>();
            let tracking = state.tracking.lock().map_err(|e| e.to_string())?;
            let usage_json: serde_json::Map<String, serde_json::Value> = tracking
                .usage_by_date
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        serde_json::to_value(v).unwrap_or(serde_json::Value::Null),
                    )
                })
                .collect();
            respond_json(request, &serde_json::Value::Object(usage_json))?;
        }

        (Method::Post, "/state") => {
            let body = read_body(&mut request.as_reader())?;
            let parsed: serde_json::Value =
                serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);

            // Store and notify the frontend so it can merge.
            {
                let state = app.state::<AppState>();
                let mut guard = state.sync.lock().map_err(|e| e.to_string())?;
                guard.extension_payload = Some(parsed.clone());
                guard.extension_updated_at = chrono::Utc::now().timestamp_millis() as u64;
                guard.extension_connected = true;
            }

            let _ = app.emit("extension-state-push", parsed);
            respond_json(request, &serde_json::json!({ "ok": true }))?;
        }

        _ => {
            let response = Response::empty(404).with_header(access_control_header());
            request.respond(response)?;
        }
    }

    Ok(())
}

fn read_body<R: std::io::Read>(reader: &mut R) -> Result<Vec<u8>, std::io::Error> {
    let mut buf = Vec::new();
    reader.read_to_end(&mut buf)?;
    Ok(buf)
}

fn respond_json(
    request: tiny_http::Request,
    value: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let body = serde_json::to_string(value).unwrap_or_else(|_| "{}".into());
    let content_type = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .map_err(|_| "invalid header")?;
    let response = Response::from_string(body)
        .with_header(access_control_header())
        .with_header(content_type);
    request.respond(response)?;
    Ok(())
}

/// Extensions run from `moz-extension://` and `chrome-extension://` origins,
/// which count as cross-origin to `http://localhost`. Allow them explicitly.
fn access_control_header() -> Header {
    // Header::from_bytes returns Result<Header, ()>. We've validated these
    // constants, so the unwrap is safe.
    Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).expect("valid header bytes")
}
