import { useEffect, useState } from "react";
import type { Ticker } from "../core/types";
import { useWatchlist } from "./useWatchlist";

interface Props {
  symbol: Ticker;
}

/**
 * Free-text notes for the open ticker. Auto-saves on blur.
 * Shown as a collapsible (closed by default).
 */
export function CompanyNotes({ symbol }: Props) {
  const watchlist = useWatchlist();
  const entry = watchlist.getEntry(symbol);
  const [draft, setDraft] = useState(entry?.notes ?? "");
  const [saved, setSaved] = useState(false);

  // Sync local draft when the underlying ticker or stored notes change.
  useEffect(() => {
    setDraft(entry?.notes ?? "");
  }, [symbol, entry?.notes]);

  const persist = () => {
    if (draft === (entry?.notes ?? "")) return;
    watchlist.setNotes(symbol, draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const hasContent = (entry?.notes ?? "").trim().length > 0;

  return (
    <details className="collapsible">
      <summary>
        <span className="collapsible-title">
          My Notes {hasContent && <span className="news-count">✎</span>}
        </span>
        <span className="collapsible-icon" aria-hidden>▾</span>
      </summary>
      <div className="collapsible-body notes-body">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={persist}
          placeholder="Why are you watching this stock? Thesis, price targets, anything you want to remember…"
          rows={5}
        />
        <div className="notes-footer">
          {saved ? (
            <span className="notes-saved">Saved</span>
          ) : (
            <span className="notes-hint">Auto-saves when you click away</span>
          )}
        </div>
      </div>
    </details>
  );
}
