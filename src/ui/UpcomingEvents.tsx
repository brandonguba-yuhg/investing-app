import { useEffect, useMemo, useState } from "react";
import type { UpcomingEvent } from "../core/types";
import { useProvider } from "./providerContext";
import { useWatchlist } from "./useWatchlist";

const WEEK = 7;
const SIX_WEEKS = 42;

function formatDay(date: string): { weekday: string; day: string } {
  const d = new Date(`${date}T00:00:00`);
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
    day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

function daysUntil(date: string): number {
  const d = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function relativeDay(date: string): string {
  const days = daysUntil(date);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  const weeks = Math.round(days / 7);
  return weeks === 1 ? "In 1 week" : `In ${weeks} weeks`;
}

export function UpcomingEvents() {
  const provider = useProvider();
  const { tickers, has } = useWatchlist();
  const [eventList, setEventList] = useState<UpcomingEvent[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);

  // Refetch only when the watchlist changes — the backend needs it to include
  // those companies' earnings. Horizon and the watchlist-only toggle are pure
  // client-side display filters and never trigger a refetch.
  useEffect(() => {
    let cancelled = false;
    setHidden(false);
    provider
      .getUpcomingEvents(tickers)
      .then((res) => {
        if (!cancelled) setEventList(res.events);
      })
      .catch(() => {
        // Hide on any failure — this is a secondary section; a broken feed
        // shouldn't push an error card onto the home page.
        if (!cancelled) setHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, tickers]);

  const horizonDays = expanded ? SIX_WEEKS : WEEK;

  const visible = useMemo(() => {
    if (!eventList) return [];
    return eventList.filter((e) => {
      if (daysUntil(e.date) > horizonDays) return false;
      if (watchlistOnly && e.category === "earnings" && !(e.symbol && has(e.symbol))) {
        return false;
      }
      return true;
    });
  }, [eventList, horizonDays, watchlistOnly, has]);

  if (hidden || !eventList || eventList.length === 0) return null;

  return (
    <section className="events">
      <div className="events-head">
        <div>
          <h2 className="events-title">Upcoming Events</h2>
          <p className="events-sub">Scheduled releases and earnings that could move markets.</p>
        </div>
        <div className="events-controls">
          <label className="events-toggle">
            <input
              type="checkbox"
              checked={watchlistOnly}
              onChange={(e) => setWatchlistOnly(e.target.checked)}
            />
            Watchlist earnings only
          </label>
          <select
            className="events-range"
            value={expanded ? "6w" : "1w"}
            onChange={(e) => setExpanded(e.target.value === "6w")}
            aria-label="Time range"
          >
            <option value="1w">Next week</option>
            <option value="6w">Next 6 weeks</option>
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="events-empty">
          {watchlistOnly && tickers.length === 0
            ? "Add companies to your watchlist to see their earnings here."
            : "Nothing scheduled in this range."}
        </p>
      ) : (
        <ul className="events-list">
          {visible.map((e, i) => {
            const { weekday, day } = formatDay(e.date);
            return (
              <li className={`event-row event-${e.category}`} key={`${e.date}-${e.title}-${i}`}>
                <div className="event-date">
                  <span className="event-weekday">{weekday}</span>
                  <span className="event-day">{day}</span>
                </div>
                <div className="event-body">
                  <div className="event-head">
                    <span className="event-name">{e.title}</span>
                    <span className={`event-tag event-tag-${e.category}`}>
                      {e.category === "macro" ? "Macro" : "Earnings"}
                    </span>
                  </div>
                  {e.detail && <p className="event-detail">{e.detail}</p>}
                </div>
                <span className="event-when">{relativeDay(e.date)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="events-foot">
        Macro dates from official BLS &amp; Federal Reserve schedules. Informational only.
      </div>
    </section>
  );
}
