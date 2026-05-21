import { useCallback, useSyncExternalStore } from "react";
import { tokensFor, type ThemeMode, type ThemeTokens } from "../core/theme";

const KEY = "investing.theme.v1";

/** Read the OS-level preference. Defaults to dark when unsupported. */
function osPreference(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

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
//   1. Explicit user override (localStorage) — if set, always wins
//   2. OS `prefers-color-scheme` — followed live until user overrides
//
// We don't snapshot the OS value at startup; we read it on each render so the
// app follows OS changes (e.g. macOS auto dark mode at sunset) for users who
// haven't picked a theme.

const listeners = new Set<() => void>();

function getCurrentMode(): ThemeMode {
  return readStoredOverride() ?? osPreference();
}

let currentMode: ThemeMode = getCurrentMode();
applyTheme(currentMode); // apply on import to avoid first-paint flash

function recomputeAndNotify() {
  const next = getCurrentMode();
  if (next === currentMode) return;
  currentMode = next;
  applyTheme(next);
  listeners.forEach((l) => l());
}

function setMode(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // ignore
  }
  recomputeAndNotify();
}

function clearOverride() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  recomputeAndNotify();
}

// Track OS preference changes — only matters when user hasn't overridden.
if (typeof window !== "undefined" && window.matchMedia) {
  const mql = window.matchMedia("(prefers-color-scheme: light)");
  const onChange = () => {
    if (readStoredOverride() === null) recomputeAndNotify();
  };
  if (mql.addEventListener) mql.addEventListener("change", onChange);
  else mql.addListener?.(onChange);
}

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

// -----------------------------------------------------------------------------

export function useTheme(): {
  mode: ThemeMode;
  tokens: ThemeTokens;
  /** True when the user has explicitly picked a theme (vs following the OS). */
  isOverridden: boolean;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  /** Drop the explicit override and follow the OS again. */
  resetToOS: () => void;
} {
  const mode = useSyncExternalStore(subscribe, () => currentMode, () => "dark");
  const setModeCb = useCallback((m: ThemeMode) => setMode(m), []);
  const toggle = useCallback(() => setMode(currentMode === "dark" ? "light" : "dark"), []);
  const resetToOS = useCallback(() => clearOverride(), []);
  const isOverridden = useSyncExternalStore(
    subscribe,
    () => readStoredOverride() !== null,
    () => false,
  );
  return { mode, tokens: tokensFor(mode), isOverridden, setMode: setModeCb, toggle, resetToOS };
}
