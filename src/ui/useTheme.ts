import { useCallback, useSyncExternalStore } from "react";
import { tokensFor, type ThemeMode, type ThemeTokens } from "../core/theme";

const KEY = "investing.theme.v1";

/** Read explicit user choice from localStorage, if any. */
function readStoredOverride(): ThemeMode | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(KEY);
  if (v === "light" || v === "dark") return v;
  return null;
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = mode;
}

// --- single shared store -----------------------------------------------------
//
// Resolution order:
//   1. Explicit user choice (localStorage) — wins if set
//   2. Default: dark
// (We intentionally do NOT follow the OS preference — dark is the house default.)

const listeners = new Set<() => void>();

function getCurrentMode(): ThemeMode {
  return readStoredOverride() ?? "dark";
}

let currentMode: ThemeMode = getCurrentMode();
applyTheme(currentMode); // apply on import to avoid first-paint flash

function notify() {
  currentMode = getCurrentMode();
  applyTheme(currentMode);
  listeners.forEach((l) => l());
}

function setMode(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // ignore
  }
  notify();
}

function resetDefault() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  notify();
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

// -----------------------------------------------------------------------------

export function useTheme(): {
  mode: ThemeMode;
  tokens: ThemeTokens;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  /** Clear the saved choice and fall back to the dark default. */
  reset: () => void;
} {
  const mode = useSyncExternalStore<ThemeMode>(
    subscribe,
    () => currentMode,
    () => "dark",
  );
  const setModeCb = useCallback((m: ThemeMode) => setMode(m), []);
  const toggle = useCallback(
    () => setMode(currentMode === "dark" ? "light" : "dark"),
    [],
  );
  const reset = useCallback(() => resetDefault(), []);
  return { mode, tokens: tokensFor(mode), setMode: setModeCb, toggle, reset };
}
