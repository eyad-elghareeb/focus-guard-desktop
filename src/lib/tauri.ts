// FocusGuard Desktop — Tauri bridge.
//
// Wraps @tauri-apps/api so the rest of the frontend doesn't sprinkle
// `typeof window !== 'undefined' && '__TAURI__' in window` everywhere. Also
// degrades gracefully in the browser (dev mode without Tauri) by returning
// null/empty results instead of throwing.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** True when running inside the Tauri webview (i.e. the packaged desktop app). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Invoke a Tauri command, returning null when not in Tauri (browser/dev mode).
 * This keeps component code free of feature-detection boilerplate.
 */
export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    return (await invoke(cmd, args)) as T;
  } catch (e) {
    console.warn(`[focusguard] tauri command "${cmd}" failed`, e);
    return null;
  }
}

/** Subscribe to a Tauri event. Returns an unsubscribe function (no-op in browser). */
export async function tauriListen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn | null> {
  if (!isTauri()) return null;
  try {
    return await listen<T>(event, (e) => handler(e.payload));
  } catch (e) {
    console.warn(`[focusguard] failed to listen to "${event}"`, e);
    return null;
  }
}
