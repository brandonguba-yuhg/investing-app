import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatLargeNumber } from "../core/format";
import type { Financials, Period } from "../core/types";

interface Props {
  financials: Financials;
  period: Period;
}

export function CompanyCharts({ financials, period }: Props) {
  const incomeData = [...financials.income]
    .reverse()
    .map((r) => ({
      label: shortDate(r.date),
      Revenue: r.revenue,
      "Net Income": r.netIncome,
      "Operating Income": r.operatingIncome,
    }));

  const balanceData = [...financials.balance]
    .reverse()
    .map((r) => ({
      label: shortDate(r.date),
      Assets: r.totalAssets,
      Liabilities: r.totalLiabilities,
      Equity: r.totalEquity,
    }));

  const cashData = [...financials.cashFlow]
    .reverse()
    .map((r) => ({
      label: shortDate(r.date),
      Operating: r.operatingCashFlow,
      Investing: r.investingCashFlow,
      Financing: r.financingCashFlow,
      "Free Cash Flow": r.freeCashFlow,
    }));

  const subtitle = period === "annual" ? "Annual" : "Quarterly";

  return (
    <div className="charts">
      <ChartCard title={`Revenue, Operating Income & Net Income (${subtitle})`}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={incomeData} margin={{ top: 16, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis dataKey="label" stroke="#8a93a6" fontSize={12} />
            <YAxis stroke="#8a93a6" fontSize={12} tickFormatter={formatLargeNumber} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number) => formatLargeNumber(v)}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Revenue" fill="#5b8def" />
            <Bar dataKey="Operating Income" fill="#22c55e" />
            <Bar dataKey="Net Income" fill="#a855f7" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Balance Sheet (${subtitle})`}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={balanceData} margin={{ top: 16, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis dataKey="label" stroke="#8a93a6" fontSize={12} />
            <YAxis stroke="#8a93a6" fontSize={12} tickFormatter={formatLargeNumber} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number) => formatLargeNumber(v)}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Assets" fill="#5b8def" />
            <Bar dataKey="Liabilities" fill="#ef4444" />
            <Bar dataKey="Equity" fill="#22c55e" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Cash Flow (${subtitle})`}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={cashData} margin={{ top: 16, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis dataKey="label" stroke="#8a93a6" fontSize={12} />
            <YAxis stroke="#8a93a6" fontSize={12} tickFormatter={formatLargeNumber} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number) => formatLargeNumber(v)}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Operating" fill="#22c55e" />
            <Bar dataKey="Investing" fill="#5b8def" />
            <Bar dataKey="Financing" fill="#a855f7" />
            <Bar dataKey="Free Cash Flow" >
              {cashData.map((d, i) => (
                <Cell key={i} fill={d["Free Cash Flow"] >= 0 ? "#22c55e" : "#ef4444"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="chart-card">
      <h3 className="chart-title">{title}</h3>
      {children}
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const year = d.getFullYear();
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${month} ${year}`;
}

const tooltipStyle = {
  background: "#181b22",
  border: "1px solid #2a2f3a",
  borderRadius: "6px",
  fontSize: "12px",
};
