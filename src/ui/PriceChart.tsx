import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "../core/format";
import type { History, HistoryRange, Ticker } from "../core/types";
import { useProvider } from "./providerContext";
import { useTheme } from "./useTheme";

interface Props {
  symbol: Ticker;
  currency?: string;
}

const RANGES: HistoryRange[] = ["1d", "1m", "6m", "1y", "5y"];
const RANGE_LABELS: Record<HistoryRange, string> = {
  "1d": "1D",
  "1m": "1M",
  "6m": "6M",
  "1y": "1Y",
  "5y": "5Y",
};

export function PriceChart({ symbol, currency = "USD" }: Props) {
  const provider = useProvider();
  const { tokens } = useTheme();
  const [range, setRange] = useState<HistoryRange>("1y");
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    provider
      .getHistory(symbol, range)
      .then((h) => {
        if (!cancelled) setHistory(h);
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
  }, [symbol, range, provider]);

  // Empty/unavailable: hide the section entirely so we don't show broken UI.
  if (error || (history && history.points.length === 0)) {
    return null;
  }

  const points = history?.points ?? [];
  const first = points[0]?.close;
  const last = points[points.length - 1]?.close;
  const change = first && last ? last - first : 0;
  const changePct = first && last ? ((last - first) / first) * 100 : 0;
  const up = change >= 0;
  const cur = history?.currency ?? currency;
  const lineColor = up ? tokens.up : tokens.down;

  return (
    <section className="price-chart">
      <div className="price-chart-header">
        <div className="price-chart-summary">
          {last != null && (
            <>
              <span className="pc-last">{formatCurrency(last, cur)}</span>
              <span className={up ? "pc-change up" : "pc-change down"}>
                {up ? "+" : ""}
                {change.toFixed(2)} ({changePct.toFixed(2)}%) · {RANGE_LABELS[range]}
              </span>
            </>
          )}
        </div>
        <div className="range-toggle">
          {RANGES.map((r) => (
            <button
              key={r}
              className={r === range ? "on" : ""}
              onClick={() => setRange(r)}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="price-chart-body">
        {loading && !points.length ? (
          <div className="pc-loading">Loading price history…</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart
              data={points}
              margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
            >
              <defs>
                <linearGradient id="pc-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={tokens.border} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => formatTick(d, range)}
                stroke={tokens.muted}
                fontSize={11}
                minTickGap={40}
              />
              <YAxis
                domain={["auto", "auto"]}
                stroke={tokens.muted}
                fontSize={11}
                tickFormatter={(v) => `$${v.toFixed(0)}`}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  background: tokens.surface,
                  border: `1px solid ${tokens.border}`,
                  borderRadius: "6px",
                  fontSize: "12px",
                  color: tokens.text,
                }}
                labelFormatter={(d) => formatTooltipLabel(d as string, range)}
                formatter={(v: number) => [formatCurrency(v, cur), "Close"]}
                cursor={{ stroke: tokens.muted, strokeWidth: 1 }}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={lineColor}
                strokeWidth={2}
                fill="url(#pc-fill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function formatTick(iso: string, range: HistoryRange): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (range === "1d") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (range === "5y") {
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTooltipLabel(iso: string, range: HistoryRange): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (range === "1d") {
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
