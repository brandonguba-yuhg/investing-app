import type { InvestorProfile } from "./types";

const KEY = "investing.profile.v1";

export interface ProfileStorage {
  read(): InvestorProfile | null;
  write(profile: InvestorProfile | null): void;
  subscribe(listener: () => void): () => void;
}

const VALID = {
  riskTolerance: new Set(["conservative", "balanced", "aggressive"]),
  horizon: new Set(["short", "medium", "long"]),
  focus: new Set(["income", "growth", "mixed"]),
  diversification: new Set(["concentrated", "balanced", "diversified"]),
};

function parse(raw: string | null): InvestorProfile | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as InvestorProfile;
    if (
      !p ||
      typeof p !== "object" ||
      !VALID.riskTolerance.has(p.riskTolerance) ||
      !VALID.horizon.has(p.horizon) ||
      !VALID.focus.has(p.focus) ||
      !VALID.diversification.has(p.diversification)
    ) {
      return null;
    }
    return {
      riskTolerance: p.riskTolerance,
      horizon: p.horizon,
      focus: p.focus,
      diversification: p.diversification,
      preferredSectors: Array.isArray(p.preferredSectors)
        ? p.preferredSectors.filter((s): s is string => typeof s === "string")
        : [],
      createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function createLocalStorageProfile(
  storage: Storage = typeof localStorage !== "undefined" ? localStorage : memoryStorage(),
): ProfileStorage {
  const listeners = new Set<() => void>();
  let cached: InvestorProfile | null = null;
  let cachedRaw: string | null = null;

  const read = (): InvestorProfile | null => {
    const raw = storage.getItem(KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    cached = parse(raw);
    return cached;
  };

  const write = (profile: InvestorProfile | null): void => {
    if (profile === null) {
      storage.removeItem(KEY);
      cachedRaw = null;
      cached = null;
    } else {
      const raw = JSON.stringify(profile);
      storage.setItem(KEY, raw);
      cachedRaw = raw;
      cached = profile;
    }
    listeners.forEach((l) => l());
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { read, write, subscribe };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}
