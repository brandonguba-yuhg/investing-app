import { useMemo, useState } from "react";
import "./App.css";
import { FmpProvider } from "./core/providers/fmp";
import { HttpProvider } from "./core/providers/http";
import type { FinancialDataProvider } from "./core/provider";
import { CompanyView } from "./ui/CompanyView";
import { CompareView } from "./ui/CompareView";
import { Dashboard } from "./ui/Dashboard";
import { MarketBriefing } from "./ui/MarketBriefing";
import { ProviderContext } from "./ui/providerContext";
import { SearchBar } from "./ui/SearchBar";
import { useTheme } from "./ui/useTheme";

type Page = "home" | "dashboard" | "compare";

function App() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const fmpKey = import.meta.env.VITE_FMP_API_KEY as string | undefined;

  const provider = useMemo<FinancialDataProvider | null>(() => {
    if (apiBaseUrl) return new HttpProvider(apiBaseUrl);
    if (fmpKey) return new FmpProvider(fmpKey);
    return null;
  }, [apiBaseUrl, fmpKey]);

  const [page, setPage] = useState<Page>("home");
  const [symbol, setSymbol] = useState<string | null>(null);
  const { mode: themeMode, toggle: toggleTheme } = useTheme();

  if (!provider) {
    return (
      <div className="setup">
        <h1>Setup needed</h1>
        <p>Configure a data source. Two options:</p>
        <ol>
          <li>
            <strong>Recommended for multi-user / production:</strong> point at your
            own backend by setting{" "}
            <code>VITE_API_BASE_URL=https://your-backend</code> in{" "}
            <code>.env.local</code>.
          </li>
          <li>
            <strong>Solo / local:</strong> set{" "}
            <code>VITE_FMP_API_KEY=...</code> to use Financial Modeling Prep
            directly (250 calls/day limit, key exposed in the browser).
          </li>
        </ol>
        <p>Then restart <code>npm run dev</code>.</p>
      </div>
    );
  }

  const openCompany = (s: string) => {
    setSymbol(s);
    setPage("home");
  };

  return (
    <ProviderContext.Provider value={provider}>
      <div className="app">
        <header className="app-header">
          <h1 className="logo">Investing</h1>
          <nav className="page-nav">
            <button
              className={page === "home" ? "page-link on" : "page-link"}
              onClick={() => setPage("home")}
            >
              Home
            </button>
            <button
              className={page === "dashboard" ? "page-link on" : "page-link"}
              onClick={() => setPage("dashboard")}
            >
              Dashboard
            </button>
            <button
              className={page === "compare" ? "page-link on" : "page-link"}
              onClick={() => setPage("compare")}
            >
              Compare
            </button>
          </nav>
          {page === "home" && <SearchBar onSelect={openCompany} />}
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${themeMode === "dark" ? "light" : "dark"} theme`}
            aria-label="Toggle theme"
          >
            {themeMode === "dark" ? "☀" : "☾"}
          </button>
        </header>
        <main className="app-main">
          {page === "home" ? (
            symbol ? (
              <CompanyView key={symbol} symbol={symbol} />
            ) : (
              <MarketBriefing
                fallback={
                  <div className="empty">
                    <p>Search for a company by name or ticker symbol to get started.</p>
                    <p className="hint">Try: AAPL, MSFT, GOOGL, Tesla, Amazon</p>
                  </div>
                }
              />
            )
          ) : page === "dashboard" ? (
            <Dashboard onSelect={openCompany} />
          ) : (
            <CompareView />
          )}
        </main>
      </div>
    </ProviderContext.Provider>
  );
}

export default App;
