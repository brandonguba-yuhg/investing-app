import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "../core/types";
import { useProvider } from "./providerContext";

interface Props {
  onSelect: (symbol: string) => void;
}

export function SearchBar({ onSelect }: Props) {
  const provider = useProvider();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await provider.search(query.trim());
        setResults(r);
        setOpen(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, provider]);

  const handleSelect = (symbol: string) => {
    onSelect(symbol);
    setOpen(false);
    setQuery("");
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && query.trim()) {
      if (results.length > 0) handleSelect(results[0].symbol);
      else handleSelect(query.trim().toUpperCase());
    }
  };

  return (
    <div className="search">
      <input
        type="text"
        placeholder="Search by company name or ticker (e.g. Apple, AAPL)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKey}
        className="search-input"
      />
      {loading && <div className="search-status">Searching…</div>}
      {error && <div className="search-status error">{error}</div>}
      {open && results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={`${r.symbol}-${r.exchange ?? ""}`}>
              <button onMouseDown={() => handleSelect(r.symbol)}>
                <span className="symbol">{r.symbol}</span>
                <span className="name">{r.name}</span>
                {r.exchange && <span className="exchange">{r.exchange}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
