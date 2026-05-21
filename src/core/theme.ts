export type ThemeMode = "dark" | "light";

export interface ThemeTokens {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  up: string;
  down: string;
}

export const DARK: ThemeTokens = {
  bg: "#0f1115",
  surface: "#181b22",
  surface2: "#1f232c",
  border: "#2a2f3a",
  text: "#e6e8eb",
  muted: "#8a93a6",
  accent: "#5b8def",
  up: "#22c55e",
  down: "#ef4444",
};

export const LIGHT: ThemeTokens = {
  bg: "#f6f8fb",
  surface: "#ffffff",
  surface2: "#eef1f6",
  border: "#dbe0e8",
  text: "#1a1d23",
  muted: "#5d6878",
  accent: "#2563eb",
  up: "#15803d",
  down: "#b91c1c",
};

export function tokensFor(mode: ThemeMode): ThemeTokens {
  return mode === "light" ? LIGHT : DARK;
}
