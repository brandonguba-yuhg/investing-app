import { createContext, useContext } from "react";
import type { FinancialDataProvider } from "../core/provider";

export const ProviderContext = createContext<FinancialDataProvider | null>(null);

export function useProvider(): FinancialDataProvider {
  const p = useContext(ProviderContext);
  if (!p) throw new Error("ProviderContext not set");
  return p;
}
