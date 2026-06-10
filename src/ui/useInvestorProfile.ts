import { useCallback, useSyncExternalStore } from "react";
import {
  createLocalStorageProfile,
  type ProfileStorage,
} from "../core/investorProfile";
import type { InvestorProfile } from "../core/types";

const store: ProfileStorage = createLocalStorageProfile();

export function useInvestorProfile() {
  const profile = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.read(),
    () => null,
  );

  const save = useCallback((next: Omit<InvestorProfile, "createdAt" | "updatedAt">) => {
    const prev = store.read();
    store.write({
      ...next,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
      updatedAt: prev ? new Date().toISOString() : undefined,
    });
  }, []);

  const clear = useCallback(() => {
    store.write(null);
  }, []);

  return { profile, save, clear };
}
