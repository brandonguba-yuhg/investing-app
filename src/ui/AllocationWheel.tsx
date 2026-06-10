import { useState } from "react";
import type { AllocationSlice } from "../core/portfolio";

interface Props {
  slices: AllocationSlice[];
  /** Center label, e.g. number of holdings. */
  centerLabel: string;
  centerSub?: string;
}

// Dark-theme friendly palette; cycles if there are more slices than colors.
const COLORS = [
  "#4f8ef7",
  "#34c98e",
  "#f7b84f",
  "#e36bae",
  "#9b7df7",
  "#4fd2f7",
  "#f7794f",
  "#8ef74f",
  "#f74f6e",
  "#4ff7c4",
];

const SIZE = 180;
const RADIUS = 70;
const STROKE = 26;
const CENTER = SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Donut chart of portfolio weights. Pure SVG (stroke-dash segments), recomputed
 * from props on every render, so it auto-updates the moment a position changes.
 */
export function AllocationWheel({ slices, centerLabel, centerSub }: Props) {
  const [active, setActive] = useState<number | null>(null);

  if (slices.length === 0) return null;

  // Build stroke-dash segments, each starting where the previous ended.
  let offset = 0;
  const segments = slices.map((s, i) => {
    const frac = Math.max(s.pct, 0) / 100;
    const seg = {
      slice: s,
      color: COLORS[i % COLORS.length],
      dash: frac * CIRCUMFERENCE,
      offset,
    };
    offset += frac * CIRCUMFERENCE;
    return seg;
  });

  const shown = active != null ? slices[active] : null;

  return (
    <div className="alloc-wheel">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="alloc-wheel-svg"
        role="img"
        aria-label="Portfolio allocation"
      >
        <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          {segments.map((seg, i) => (
            <circle
              key={seg.slice.key}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={seg.color}
              strokeWidth={active === i ? STROKE + 4 : STROKE}
              strokeDasharray={`${seg.dash} ${CIRCUMFERENCE - seg.dash}`}
              strokeDashoffset={-seg.offset}
              opacity={active == null || active === i ? 1 : 0.35}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onClick={() => setActive(active === i ? null : i)}
            />
          ))}
        </g>
        <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="alloc-center-label">
          {shown ? shown.key : centerLabel}
        </text>
        <text x={CENTER} y={CENTER + 16} textAnchor="middle" className="alloc-center-sub">
          {shown ? `${shown.pct.toFixed(1)}%` : centerSub ?? ""}
        </text>
      </svg>

      <ul className="alloc-legend">
        {segments.map((seg, i) => (
          <li
            key={seg.slice.key}
            className={active == null || active === i ? "alloc-legend-row" : "alloc-legend-row dim"}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="alloc-dot" style={{ background: seg.color }} />
            <span className="alloc-name">{seg.slice.key}</span>
            <span className="alloc-pct">{seg.slice.pct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
