import { useEffect, useState } from "react";
import { formatRelativeTime } from "../core/format";
import { ProviderError } from "../core/provider";
import type { MarketBriefing as Briefing } from "../core/types";
import { useProvider } from "./providerContext";

interface Props {
  /** Rendered when AI briefing isn't configured (no key / non-backend provider). */
  fallback: React.ReactNode;
}

// Statuses that mean "AI isn't set up" rather than "it failed this time".
// 503: backend reports AI not configured. 501: FMP provider has no briefing.
const NOT_CONFIGURED_STATUSES = new Set([501, 503]);

// Upstream errors arrive as `Backend 500: 400 {"...":{"message":"..."}}`.
// Pull out the innermost human-readable message when one is embedded.
function cleanErrorMessage(raw: string): string {
  const match = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (match) {
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return match[1];
    }
  }
  return raw.replace(/^Backend \d+:\s*/, "");
}

// How long to wait before re-checking when the backend is still generating
// today's briefing in the background.
const PREPARING_RETRY_MS = 6000;

// A tab left open overnight would otherwise keep showing yesterday's briefing.
// Re-check when the tab regains focus (at most once a minute) and every 15 min.
const REFOCUS_MIN_MS = 60_000;
const POLL_MS = 15 * 60_000;

const EDITION_LABEL = {
  premarket: "Pre-Market Briefing",
  open: "Opening Bell",
  recap: "Market Recap",
} as const;

function formatPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

export function MarketBriefing({ fallback }: Props) {
  const provider = useProvider();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bump to re-run the fetch effect (used to poll while the briefing is preparing).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Background re-checks keep the current briefing on screen instead of a spinner.
    if (!briefing) setLoading(true);
    setNotConfigured(false);
    setError(null);
    provider
      .getBriefing()
      .then((b) => {
        if (cancelled) return;
        if (b.preparing) {
          // Backend is still building today's briefing — show a notice and poll.
          setPreparing(true);
          retry = setTimeout(() => setAttempt((n) => n + 1), PREPARING_RETRY_MS);
        } else {
          setPreparing(false);
          setBriefing(b);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const status = e instanceof ProviderError ? e.status : undefined;
        if (status && NOT_CONFIGURED_STATUSES.has(status)) {
          setNotConfigured(true);
        } else {
          setError(cleanErrorMessage(e instanceof Error ? e.message : "Unknown error"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [provider, attempt]);

  useEffect(() => {
    let last = Date.now();
    const recheck = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < REFOCUS_MIN_MS) return;
      last = Date.now();
      setAttempt((n) => n + 1);
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);
    const timer = setInterval(() => {
      last = 0;
      recheck();
    }, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
      clearInterval(timer);
    };
  }, []);

  if (notConfigured) return <>{fallback}</>;

  if (error !== null) {
    return (
      <div className="briefing">
        <div className="briefing-error">
          <h2>Market briefing unavailable</h2>
          <p>
            The briefing is configured but couldn't be generated right now.
            Reload the page to try again.
          </p>
          <p className="briefing-error-detail">{error}</p>
        </div>
      </div>
    );
  }

  if (loading || preparing) {
    return (
      <div className="briefing">
        <div className="briefing-loading">
          {preparing
            ? "Preparing today's market briefing… this updates automatically."
            : "Building today's market briefing…"}
        </div>
      </div>
    );
  }

  if (!briefing) return <>{fallback}</>;

  // Parse YYYY-MM-DD as local time (not UTC) so the weekday/day don't shift back.
  const dateLabel = new Date(`${briefing.date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const edition = briefing.payload?.edition ?? "recap";
  const moves = briefing.payload?.moves ?? [];
  const premarket = briefing.payload?.premarket_moves ?? [];
  const asOf = moves[0]?.as_of.replace(/^.*?(\d{1,2}:\d{2} [AP]M ET)$/, "$1");

  return (
    <div className="briefing">
      <div className="briefing-head">
        <div className="briefing-eyebrow">
          {EDITION_LABEL[edition]} · {dateLabel}
          {asOf && /ET$/.test(asOf) && ` · as of ${asOf}`}
        </div>
        <h1 className="briefing-headline">{briefing.headline}</h1>
        {moves.length > 0 && (
          <div className="briefing-moves">
            {moves.map((m) => {
              const pre = premarket.find((p) => p.symbol === m.symbol);
              return (
                <div className="briefing-move" key={m.symbol}>
                  <span className="briefing-move-name">
                    {m.symbol} <span className="briefing-move-tracks">{m.name}</span>
                  </span>
                  <span className={`change ${m.change_pct >= 0 ? "up" : "down"}`}>{formatPct(m.change_pct)}</span>
                  {pre && (
                    <span className="briefing-move-pre">
                      7am <span className={`change ${pre.change_pct >= 0 ? "up" : "down"}`}>{formatPct(pre.change_pct)}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {briefing.overview && <p className="briefing-overview">{briefing.overview}</p>}
      </div>

      <div className="briefing-items">
        {briefing.items.map((item, i) => (
          <div className="briefing-item" key={i}>
            <h3>{item.heading}</h3>
            <p>{item.summary}</p>
            {item.url && (
              <a className="briefing-item-link" href={item.url} target="_blank" rel="noreferrer">
                Read more at {hostOf(item.url)} →
              </a>
            )}
          </div>
        ))}
      </div>

      {briefing.sources && briefing.sources.length > 0 && (
        <details className="briefing-sources">
          <summary>Sources ({briefing.sources.length})</summary>
          <ul>
            {briefing.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="briefing-foot">
        Updates at 7:00 and 9:40 AM ET on trading days · SPY/QQQ/DIA quotes via Nasdaq (delayed) · prior
        closes from FRED and Nasdaq · news via CNBC, Investing.com and Seeking Alpha
        {briefing.model && briefing.model !== "template" && ` · written by ${briefing.model}`}{" "}
        {briefing.generatedAt && `· updated ${formatRelativeTime(briefing.generatedAt)}`}.
        Informational only — not investment advice.
      </div>
    </div>
  );
}
