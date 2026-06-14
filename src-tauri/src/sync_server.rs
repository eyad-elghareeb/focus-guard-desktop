//! Embedded HTTP broker served on localhost:9472.
//!
//! Browser extensions (Firefox/Chrome) talk to the desktop through this broker.
//! Endpoints:
//!   GET  /health              → {"ok": true, "version": "1.7.3"}
//!   GET  /state               → merged extension + desktop state
//!   POST /state               → extension pushes its full state blob
//!   POST /desktop-state       → desktop frontend pushes its full state blob
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
const APP_VERSION: &str = "1.7.4";

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

    // CORS preflight — respond with the headers we'd send on the real request.
    if method == Method::Options {
        let response = Response::empty(204)
            .with_header(access_control_header())
            .with_header(access_control_methods_header())
            .with_header(access_control_headers_allowed());
        request.respond(response)?;
        return Ok(());
    }

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
            let merged = merged_state(app);
            respond_json(request, &merged)?;
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

        // Extension → desktop: store + emit for the frontend to merge.
        (Method::Post, "/state") => {
            let body = read_body(&mut request.as_reader())?;
            let parsed: serde_json::Value =
                serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
            let hash = canonical_json(&parsed);

            let changed = {
                let state = app.state::<AppState>();
                let mut guard = state.sync.lock().map_err(|e| e.to_string())?;
                if guard.extension_payload_hash.as_deref() == Some(hash.as_str()) {
                    // Byte-identical to what we already have (e.g. the
                    // extension's per-second timer tick produced the same
                    // blob). Skip the store + emit to avoid a feedback loop.
                    false
                } else {
                    guard.extension_payload = Some(parsed.clone());
                    guard.extension_payload_hash = Some(hash);
                    guard.extension_updated_at = chrono::Utc::now().timestamp_millis() as u64;
                    guard.extension_connected = true;
                    true
                }
            };

            if changed {
                let _ = app.emit("extension-state-push", parsed);
            }
            respond_json(request, &serde_json::json!({ "ok": true }))?;
        }

        // Desktop frontend → broker: store so the merged `GET /state` (and
        // therefore the browser extension) can see desktop-side changes in
        // realtime. No emit back to the frontend (it already has this state).
        (Method::Post, "/desktop-state") => {
            let body = read_body(&mut request.as_reader())?;
            let parsed: serde_json::Value =
                serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
            let hash = canonical_json(&parsed);

            {
                let state = app.state::<AppState>();
                let mut guard = state.sync.lock().map_err(|e| e.to_string())?;
                // Same dedup as the extension path — skip the store + bump
                // when the desktop re-pushes an identical blob.
                if guard.desktop_payload_hash.as_deref() != Some(hash.as_str()) {
                    guard.desktop_payload = Some(parsed);
                    guard.desktop_payload_hash = Some(hash);
                    guard.desktop_updated_at = chrono::Utc::now().timestamp_millis() as u64;
                }
            }

            respond_json(request, &serde_json::json!({ "ok": true }))?;
        }

        _ => {
            let response = Response::empty(404).with_header(access_control_header());
            request.respond(response)?;
        }
    }

    Ok(())
}

/// Build the merged view served at `GET /state`.
///
/// `extension` and `desktop` are kept side-by-side so the consumer (extension
/// *or* the desktop frontend itself) can do last-write-wins per section.
/// `merged` is a convenience shallow-merge that prefers the more-recently
/// updated side for the top-level `timer` field (the highest-churn section).
fn merged_state(app: &AppHandle) -> serde_json::Value {
    let state = app.state::<AppState>();
    let Ok(guard) = state.sync.lock() else {
        return serde_json::json!({
            "extension": serde_json::Value::Null,
            "extensionUpdatedAt": 0,
            "extensionConnected": false,
            "desktop": serde_json::Value::Null,
            "desktopUpdatedAt": 0,
        });
    };

    let extension = guard.extension_payload.clone();
    let desktop = guard.desktop_payload.clone();

    // Shallow-merge timer: whichever side last wrote wins.
    let merged_timer = match (extension.as_ref(), desktop.as_ref()) {
        (Some(ext), Some(dsk)) => {
            let ext_ts = ext.get("timer").and_then(|t| t.get("lastTick")).and_then(|v| v.as_u64()).unwrap_or(0);
            let dsk_ts = dsk.get("timer").and_then(|t| t.get("lastTick")).and_then(|v| v.as_u64()).unwrap_or(0);
            if dsk_ts >= ext_ts {
                dsk.get("timer").cloned()
            } else {
                ext.get("timer").cloned()
            }
        }
        (Some(ext), None) => ext.get("timer").cloned(),
        (None, Some(dsk)) => dsk.get("timer").cloned(),
        _ => None,
    };

    serde_json::json!({
        "extension": extension,
        "extensionUpdatedAt": guard.extension_updated_at,
        "extensionConnected": guard.extension_connected,
        "desktop": desktop,
        "desktopUpdatedAt": guard.desktop_updated_at,
        "mergedTimer": merged_timer,
    })
}

fn read_body<R: std::io::Read>(reader: &mut R) -> Result<Vec<u8>, std::io::Error> {
    let mut buf = Vec::new();
    reader.read_to_end(&mut buf)?;
    Ok(buf)
}

/// Produce a stable, canonical string form of a JSON payload so two payloads
/// with the same content but different key ordering hash the same. Used for
/// the broker's dedup of identical `POST /state` and `POST /desktop-state`
/// bodies — without it, the extension's per-second timer ticks would
/// re-trigger a store + emit + frontend merge on every poll.
fn canonical_json(value: &serde_json::Value) -> String {
    // serde_json already sorts object keys when serializing with these flags.
    serde_json::to_string(value).unwrap_or_default()
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
        .with_header(access_control_methods_header())
        .with_header(access_control_headers_allowed())
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

fn access_control_methods_header() -> Header {
    Header::from_bytes(
        &b"Access-Control-Allow-Methods"[..],
        &b"GET, POST, OPTIONS"[..],
    )
    .expect("valid header bytes")
}

fn access_control_headers_allowed() -> Header {
    Header::from_bytes(
        &b"Access-Control-Allow-Headers"[..],
        &b"Content-Type"[..],
    )
    .expect("valid header bytes")
}
