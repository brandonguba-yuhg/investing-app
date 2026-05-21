import { useEffect, useState } from "react";
import { formatRelativeTime } from "../core/format";
import type { NewsItem, Ticker } from "../core/types";
import { useProvider } from "./providerContext";

interface Props {
  symbol: Ticker;
}

export function NewsFeed({ symbol }: Props) {
  const provider = useProvider();
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    provider
      .getNews(symbol, 10)
      .then((r) => {
        if (!cancelled) setItems(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, provider]);

  // Hide entirely if the provider doesn't support news or there's nothing to show.
  if (error) return null;
  if (!loading && (!items || items.length === 0)) return null;

  const count = items?.length ?? 0;

  return (
    <details className="collapsible news">
      <summary>
        <span className="collapsible-title">
          Recent News {count > 0 && <span className="news-count">({count})</span>}
        </span>
        <span className="collapsible-icon" aria-hidden>▾</span>
      </summary>
      <div className="collapsible-body">
      {loading && !items ? (
        <div className="news-loading">Loading news…</div>
      ) : (
        <ul className="news-list">
          {items?.map((n) => (
            <li key={n.id} className="news-item">
              <a href={n.link} target="_blank" rel="noreferrer" className="news-link">
                {n.thumbnail && (
                  <img
                    className="news-thumb"
                    src={n.thumbnail}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <div className="news-content">
                  <div className="news-headline">{n.title}</div>
                  <div className="news-meta">
                    <span>{n.publisher}</span>
                    <span className="news-dot">·</span>
                    <span>{formatRelativeTime(n.publishedAt)}</span>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
      </div>
    </details>
  );
}
